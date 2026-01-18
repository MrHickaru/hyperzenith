use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::process::Command;
use std::path::Path;
use tauri::Emitter;
use std::sync::{Arc, Mutex};
use chrono::Local;

#[derive(serde::Deserialize, Clone)]
pub struct MacConfig {
    pub ip: String,
    pub username: String,
    pub password: Option<String>,
    pub ssh_key_path: Option<String>,  // For MacinCloud 2FA or key-based auth
}

/// Helper to parse IP:PORT from the ip field. Defaults to port 22.
fn parse_ip_and_port(input: &str) -> (&str, &str) {
    if let Some((ip, port)) = input.split_once(':') {
        (ip, port)
    } else {
        (input, "22")
    }
}

/// Helper to construct SSH options string for Command-based operations
fn get_ssh_options(port: &str, key_path: &Option<String>) -> String {
    let mut opts = format!(
        "-p {} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30",
        port
    );
    if let Some(path) = key_path {
        if !path.is_empty() {
            opts.push_str(&format!(" -i \"{}\"", path));
        }
    }
    opts
}

/// Helper to establish SSH connection with detailed error reporting
fn create_session(config: &MacConfig) -> Result<Session, String> {
    let (ip, port) = parse_ip_and_port(&config.ip);
    
    // Validate IP early
    if ip.is_empty() {
        return Err("Connection failed: IP address is empty".to_string());
    }
    if config.username.is_empty() {
        return Err("Connection failed: Username is empty".to_string());
    }
    
    // Set connection timeout for cloud connections
    let addr = format!("{}:{}", ip, port);
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| format!("Connection failed: Cannot reach '{}' - {} (Check IP/Port)", addr, e))?;
    
    // Set read/write timeout to prevent hanging (Increased to 10m for slow cloud builds)
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(600))).ok();
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(600))).ok();
    
    let mut sess = Session::new().unwrap();
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH Handshake failed with '{}' - {}", ip, e))?;

    // AUTHENTICATION LOGIC - Support both Key and Password auth
    // Robust checks: treat empty strings as "not provided"
    let has_key = config.ssh_key_path.as_ref().map(|k| !k.is_empty()).unwrap_or(false);
    let has_password = config.password.as_ref().map(|p| !p.is_empty()).unwrap_or(false);

    if has_key {
        let key_path = config.ssh_key_path.as_ref().unwrap();
        // Validate key file exists before attempting auth
        if !Path::new(key_path).exists() {
            return Err(format!("SSH Key file not found: '{}' (Check path)", key_path));
        }
        sess.userauth_pubkey_file(&config.username, None, Path::new(key_path), None)
            .map_err(|e| format!("SSH Key auth failed for user '{}': {} (Check username, key path, and permissions)", config.username, e))?;
    } else if has_password {
        let pwd = config.password.as_ref().unwrap();
        sess.userauth_password(&config.username, pwd)
            .map_err(|e| format!("Password auth failed for user '{}': {} (Check username and password)", config.username, e))?;
    } else {
        return Err("No credentials provided: Enter either SSH Key Path OR Password".to_string());
    }

    if !sess.authenticated() {
        return Err(format!("Authentication failed for user '{}' at '{}' (Credentials rejected)", config.username, ip));
    }

    Ok(sess)
}

/// Executing a remote command and streaming stdout/stderr to the frontend
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
    
    // SSH options string with optional key support
    let ssh_opts_str = format!("ssh {}", get_ssh_options(port, &config.ssh_key_path));
    let destination = format!("{}@{}:{}", config.username, ip, remote_path);

    let output = Command::new("wsl")
        .args(&[
            "rsync",
            "-avz",
            "--timeout=120",  // Fail if transfer stalls for 2 minutes
            "-e", &ssh_opts_str,
            "--exclude", "node_modules", 
            "--exclude", ".git", 
            "--exclude", "android",
            "--exclude", "ios/Pods",        // Save bandwidth: let remote 'pod install' handle this
            "--exclude", "ios/build",       // Don't sync local build artifacts
            "--exclude", "ios/DerivedData", // Don't sync intermediate build files
            "--exclude", "ios/.xcode.env.local", // Machine-specific config
            local_path, 
            &destination
        ])
        .output()
        .map_err(|e| format!("Rsync (via WSL) failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// The "Turbo" Build Logic for iOS with Pre-flight Checks & Resilient Install
pub fn execute_turbo_ios(
    app: tauri::AppHandle, 
    config: MacConfig, 
    remote_path: String,
    scheme: String,
    build_type: String
) -> Result<String, String> {
    let sess = create_session(&config)?;

    // --- FEATURE 2: RESTRICTED SHELL DETECTION (Pre-flight Check) ---
    let _ = app.emit("build-output", "🔍 Running pre-flight environment check...".to_string());
    
    let pre_flight_cmd = "which xcodebuild || echo 'XCODE_NOT_FOUND'";
    let mut channel = sess.channel_session()
        .map_err(|e| format!("Pre-flight check failed: {}", e))?;
    channel.exec(pre_flight_cmd)
        .map_err(|e| format!("Pre-flight exec failed: {}", e))?;
    
    let mut pre_flight_output = String::new();
    std::io::Read::read_to_string(&mut channel, &mut pre_flight_output).ok();
    channel.wait_close().ok();
    
    if pre_flight_output.contains("XCODE_NOT_FOUND") {
        let _ = app.emit("build-output", "❌ Pre-flight FAILED: 'xcodebuild' not found in PATH".to_string());
        return Err("Remote environment invalid: 'xcodebuild' not found in PATH. Check if Xcode is installed and CLI tools are configured.".to_string());
    }
    let _ = app.emit("build-output", "✅ Pre-flight passed: xcodebuild found".to_string());

    // Set destination based on build type
    let destination = if build_type == "device" {
        "generic/platform=iOS"
    } else {
        "platform=iOS Simulator,name=iPhone 15"
    };

    // --- FEATURE 3: RESILIENT NPM INSTALL (SMART FALLBACK) ---
    // 1. If package-lock.json exists: Use 'npm ci --prefer-offline' (Best for CI/speed/stability)
    // 2. If NO package-lock.json: Fallback to 'npm install' (Compatible with "simple" hacking)
    // 3. EXPLICIT POD INSTALL: Ensure native bindings are linked before Xcode build
    let hydration_cmd = "if [ ! -d 'node_modules' ]; then \
        if [ -f 'package-lock.json' ]; then \
            echo '>> Hydrating with npm ci (Strict)...'; \
            npm ci --prefer-offline; \
        else \
            echo '>> Hydrating with npm install (Fallback)...'; \
            npm install; \
        fi \
    fi; \
    if [ -d 'ios' ]; then \
        cd ios; \
        echo '>> verifying pods...'; \
        if [ ! -d 'Pods' ]; then \
           echo '>> Initializing Pods...'; \
           pod install; \
        fi; \
        cd ..; \
    fi";

    // Construct the "Turbo" Command with Pre-Hydration & High-Performance Flags
    let build_cmd = format!(
        "cd {path} && {hydration} && cd ios && \
        xcodebuild -workspace {scheme}.xcworkspace \
        -scheme {scheme} \
        -configuration Debug \
        -destination '{destination}' \
        COMPILER_INDEX_STORE_ENABLE=NO \
        DEBUG_INFORMATION_FORMAT=dwarf \
        RCT_NO_LAUNCH_PACKAGER=1",
        path = remote_path,
        hydration = hydration_cmd,
        scheme = scheme,
        destination = destination
    );

    let _ = app.emit("build-output", format!("🚀 Initializing Resilient Turbo Build on Remote Mac: {}\n", config.ip));
    
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
