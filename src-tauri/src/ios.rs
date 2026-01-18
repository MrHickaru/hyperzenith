use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::process::Command;
use tauri::Emitter;
use std::fs::OpenOptions;
use std::sync::{Arc, Mutex};
use std::io::Write;
use chrono::Local;

#[derive(serde::Deserialize, Clone)]
pub struct MacConfig {
    pub ip: String,
    pub username: String,
    pub password: Option<String>,
}

/// Helper to parse IP:PORT from the ip field. Defaults to port 22.
fn parse_ip_and_port(input: &str) -> (&str, &str) {
    if let Some((ip, port)) = input.split_once(':') {
        (ip, port)
    } else {
        (input, "22")
    }
}

/// Helper to establish SSH connection
fn create_session(config: &MacConfig) -> Result<Session, String> {
    let (ip, port) = parse_ip_and_port(&config.ip);
    let tcp = TcpStream::connect(format!("{}:{}", ip, port))
        .map_err(|e| format!("Failed to connect to Mac at {}:{} - {}", ip, port, e))?;
    
    let mut sess = Session::new().unwrap();
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("Handshake failed: {}", e))?;

    if let Some(pwd) = &config.password {
        sess.userauth_password(&config.username, pwd)
            .map_err(|e| format!("Auth failed: {}", e))?;
    } else {
        return Err("SSH Password required (Keys not yet supported in this build)".to_string());
    }

    Ok(sess)
}

/// Executes a remote command and streams stdout/stderr to the frontend
fn run_remote_command(
    sess: &Session, 
    command: &str, 
    app: &tauri::AppHandle, 
    event_name: &str,
    log_buffer: Option<&Arc<Mutex<String>>>
) -> Result<(), String> {
    let mut channel = sess.channel_session()
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    
    channel.exec(command)
        .map_err(|e| format!("Failed to exec command: {}", e))?;

    let mut buffer = [0u8; 1024];
    loop {
        let bytes_read = channel.read(&mut buffer).unwrap_or(0);
        if bytes_read == 0 { break; }
        
        let output = String::from_utf8_lossy(&buffer[..bytes_read]);
        let _ = app.emit(event_name, output.to_string());
        
        // Capture log if buffer is provided
        if let Some(buf) = log_buffer {
            if let Ok(mut lock) = buf.lock() {
                lock.push_str(&output);
            }
        }
    }

    channel.wait_close().ok();
    let exit_status = channel.exit_status().unwrap_or(-1);

    if exit_status != 0 {
        return Err(format!("Command failed with exit code: {}", exit_status));
    }
    Ok(())
}

/// Synchronize files using rsync (Expects rsync in Windows PATH)
pub fn sync_files(local_path: &str, config: &MacConfig, remote_path: &str) -> Result<(), String> {
    let (ip, port) = parse_ip_and_port(&config.ip);
    
    // Construct SSH options with custom port and host key bypass
    let ssh_opts = format!(
        "ssh -p {} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null",
        port
    );

    let output = Command::new("wsl")
        .args(&[
            "rsync",
            "-avz",
            "-e", &ssh_opts,
            "--exclude", "node_modules", 
            "--exclude", ".git", 
            "--exclude", "android",
            local_path, 
            &format!("{}@{}:{}", config.username, ip, remote_path)
        ])
        .output()
        .map_err(|e| format!("Rsync (via WSL) failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// The "Turbo" Build Logic for iOS
pub fn execute_turbo_ios(
    app: tauri::AppHandle, 
    config: MacConfig, 
    remote_path: String,
    scheme: String,
    build_type: String
) -> Result<String, String> {
    let sess = create_session(&config)?;

    // Set destination based on build type
    let destination = if build_type == "device" {
        "generic/platform=iOS"
    } else {
        "platform=iOS Simulator,name=iPhone 15"
    };

    // Construct the "Turbo" Command with High-Performance Flags
    let build_cmd = format!(
        "cd {path}/ios && \
        xcodebuild -workspace {scheme}.xcworkspace \
        -scheme {scheme} \
        -configuration Debug \
        -destination '{destination}' \
        COMPILER_INDEX_STORE_ENABLE=NO \
        DEBUG_INFORMATION_FORMAT=dwarf \
        RCT_NO_LAUNCH_PACKAGER=1",
        path = remote_path,
        scheme = scheme,
        destination = destination
    );

    let _ = app.emit("build-output", format!("🚀 Initializing Turbo Build on Remote Mac: {}\n", config.ip));
    
    let log_buffer = Arc::new(Mutex::new(String::new()));
    
    let result = run_remote_command(&sess, &build_cmd, &app, "build-output", Some(&log_buffer));

    // ALWAYS write logs, regardless of success or failure
    if let Some(home_dir) = dirs::home_dir() {
        let log_dir = home_dir.join(".hyperzenith").join("ios_logs");
        let _ = std::fs::create_dir_all(&log_dir);
        
        let prefix = if result.is_ok() { "ios_build_success" } else { "ios_build_fail" };
        let log_path = log_dir.join(format!("{}_{}.log", prefix, Local::now().format("%Y-%m-%d_%H-%M-%S")));
        
        if let Ok(content) = log_buffer.lock() {
            let _ = std::fs::write(&log_path, content.clone());
            let _ = app.emit("build-output", format!("📄 Log saved to: {}", log_path.display()));
        }
    }

    match result {
        Ok(_) => Ok("iOS Build Completed Successfully via Satellite".to_string()),
        Err(e) => Err(e),
    }
}

/// The "Nuclear" Recovery Sequence for iOS
pub fn nuke_ios_remote(
    app: tauri::AppHandle, 
    config: MacConfig,
    remote_path: String
) -> Result<String, String> {
    let sess = create_session(&config)?;
    let _ = app.emit("build-output", "☢️ Initiating NUCLEAR iOS Recovery Sequence...\n".to_string());

    let nuke_cmd = format!(
        "set -e; \
        echo 'Step 1: Killing Processes...'; \
        killall Xcode xcodebuild CoreSimulatorBridge || true; \
        
        echo 'Step 2: Cleaning Project...'; \
        cd {path}/ios && xcodebuild clean; \
        
        echo 'Step 3: Purging DerivedData...'; \
        rm -rf ~/Library/Developer/Xcode/DerivedData/*; \
        
        echo 'Step 4: Purging CocoaPods Caches (Global & Local)...'; \
        rm -rf ~/Library/Caches/CocoaPods; \
        rm -rf Pods Podfile.lock; \
        
        echo 'Step 5: Resetting Simulators...'; \
        xcrun simctl erase all; \
        
        echo 'Step 6: Cleaning React Native Temp...'; \
        rm -rf $TMPDIR/react-* $TMPDIR/metro-*; \
        watchman watch-del-all || true; \

        echo 'Step 7: Re-Hydrating...'; \
        pod install --repo-update; \
        echo '✅ NUKE COMPLETE';",
        path = remote_path
    );

    run_remote_command(&sess, &nuke_cmd, &app, "build-output", None)?;

    Ok("Recovery Sequence Finished".to_string())
}
