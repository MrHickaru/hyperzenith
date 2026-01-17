use std::sync::{Mutex, Arc};
use std::process::{Command, Child, Stdio};
use tauri::Emitter;
use lazy_static::lazy_static;
use chrono::Local;
// use sysinfo::System; // Removed unused import

lazy_static! {
    static ref ACTIVE_BUILD_HANDLE: Mutex<Option<Child>> = Mutex::new(None);
    static ref SYSTEM_MONITOR: Mutex<sysinfo::System> = Mutex::new(sysinfo::System::new_all());
}

#[derive(serde::Serialize, Clone)]
pub struct SystemStats {
    pub cpu_usage: Vec<f32>,
    pub total_memory: u64,
    pub used_memory: u64,
    pub available_memory: u64,
    pub cpu_count: usize,
}

#[derive(serde::Serialize, Clone)]
pub struct HardwareProfile {
    pub max_workers: usize,
    pub jvm_heap_gb: usize,
    pub cpu_cores: usize,
    pub total_ram_gb: usize,
}

#[tauri::command]
fn get_system_stats() -> SystemStats {
    let mut sys = SYSTEM_MONITOR.lock().unwrap();
    sys.refresh_cpu();
    sys.refresh_memory();
    
    SystemStats {
        cpu_usage: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        total_memory: sys.total_memory(),
        used_memory: sys.used_memory(),
        available_memory: sys.available_memory(),
        cpu_count: sys.cpus().len(),
    }
}

#[tauri::command]
fn get_hardware_profile() -> HardwareProfile {
    // Only needs static info, no refresh needed really but we'll use the shared one
    let sys = SYSTEM_MONITOR.lock().unwrap();
    calculate_profile(sys.cpus().len(), sys.total_memory())
}

/// Pure logic for resource allocation (Separate for testing)
fn calculate_profile(cpu_cores: usize, total_ram_bytes: u64) -> HardwareProfile {
    let total_ram_gb = (total_ram_bytes / 1024 / 1024 / 1024) as usize;
    
    // Use 90% of cores
    let max_workers = ((cpu_cores as f64) * 0.9).floor() as usize;
    // Use 50% of RAM for JVM
    let jvm_heap_gb = ((total_ram_gb as f64) * 0.5).floor() as usize; 
    
    HardwareProfile {
        max_workers: max_workers.max(4),
        jvm_heap_gb: jvm_heap_gb.max(4).min(16), // Clamp between 4-16GB
        cpu_cores,
        total_ram_gb,
    }
}

#[tauri::command]
fn abort_build() -> Result<String, String> {
    let mut handle = ACTIVE_BUILD_HANDLE.lock().map_err(|_| "Failed to acquire lock")?;
    if let Some(mut child) = handle.take() {
        let _ = child.kill();
        Ok("Build Aborted".to_string())
    } else {
        Ok("No active build".to_string())
    }
}

#[tauri::command]
fn purge_wsl() -> Result<String, String> {
    Command::new("wsl").args(&["--shutdown"]).output()
        .map_err(|e| format!("Failed: {}", e))?;
    Ok("WSL Purged".to_string())
}

/// Convert Windows path to WSL path (handles any drive letter)
fn windows_to_wsl_path(win_path: &str) -> String {
    // Handle drive letters like C:\, D:\, E:\ etc.
    if win_path.len() >= 2 && win_path.chars().nth(1) == Some(':') {
        let drive = win_path.chars().next().unwrap().to_lowercase().next().unwrap();
        let rest = &win_path[2..].replace("\\", "/");
        format!("/mnt/{}{}", drive, rest)
    } else {
        win_path.replace("\\", "/")
    }
}

#[tauri::command]
fn prewarm_engine(working_dir: String) -> Result<String, String> {
    let wsl_path = windows_to_wsl_path(&working_dir);

    std::thread::spawn(move || {
        println!("🔥 [SYSTEM] PRE-WARMING GRADLE DAEMON...");
        if let Ok(mut child) = Command::new("wsl")
            .args(&["-e", "bash", "-c", &format!("cd '{}/android' && ./gradlew --version", wsl_path)])
            .stdout(Stdio::null()).stderr(Stdio::null()).spawn() 
        {
            let _ = child.wait();
            println!("✅ [SYSTEM] ENGINE WARMED.");
        }
    });
    Ok("Pre-heating...".to_string())
}

#[tauri::command]
async fn execute_build(
    app: tauri::AppHandle,
    working_dir: String, 
    _build_type: String,
    turbo_mode: bool
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    
    // Auto-detect hardware for optimal settings
    let hw = get_hardware_profile();
    println!("🖥️ [HARDWARE] {} cores, {}GB RAM → {} workers, {}GB heap", 
             hw.cpu_cores, hw.total_ram_gb, hw.max_workers, hw.jvm_heap_gb);
    
    let wsl_path = windows_to_wsl_path(&working_dir);

    // Get LOCALAPPDATA for dynamic Android SDK path (Failsafe included)
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:/Users/Default/AppData/Local".to_string());
    let win_sdk_path = format!("{}/Android/Sdk", local_app_data.replace("\\", "/"));
    let android_sdk_path = windows_to_wsl_path(&win_sdk_path);


    let wsl_cmd = if turbo_mode {
        // V1.2 SUPER-SONIC EDITION: Configuration Cache + Parallel GC + High Throughput
        format!(
            r#"export NODE_ENV=development && \
             export ANDROID_HOME={} && \
             export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH && \
             export GRADLE_OPTS="-Xmx{}g -XX:+UseParallelGC -XX:MaxMetaspaceSize=1g -Dorg.gradle.daemon.idletimeout=3600000" && \
             cd '{}/android' && chmod +x ./gradlew && \
             ./gradlew assembleDebug \
               --parallel \
               --build-cache \
               --configuration-cache \
               --configuration-cache-problems=warn \
               --max-workers={} \
               -Dorg.gradle.caching=true \
               -Dorg.gradle.parallel=true \
               -Dorg.gradle.vfs.watch=true \
               -Dkotlin.incremental=true \
               -x lint -x test \
               2>&1"#,
            android_sdk_path, hw.jvm_heap_gb, wsl_path, hw.max_workers
        )


    } else {
        format!(
            "export NODE_ENV=development && cd '{}' && npx eas build --platform android --local --profile preview --non-interactive 2>&1",
            wsl_path
        )
    };

    // Kill orphans
    if let Ok(mut handle) = ACTIVE_BUILD_HANDLE.lock() {
        if let Some(mut existing) = handle.take() { let _ = existing.kill(); }
    }

    let mut child = Command::new("wsl")
        .args(&["-e", "bash", "-c", &wsl_cmd])
        .current_dir(&working_dir)
        .stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let log_buffer = Arc::new(Mutex::new(String::new()));

    let app1 = app.clone();
    let buf1 = Arc::clone(&log_buffer);
    let t1 = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = app1.emit("build-output", &line);
            buf1.lock().unwrap().push_str(&format!("{}\n", line));
        }
    });

    let app2 = app.clone();
    let buf2 = Arc::clone(&log_buffer);
    let t2 = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = app2.emit("build-output", &line);
            buf2.lock().unwrap().push_str(&format!("{}\n", line));
        }
    });

    t1.join().ok(); t2.join().ok();
    let status = child.wait().map_err(|e| e.to_string())?;

    if status.success() {
        Ok("Build completed!".to_string())
    } else {
        let logs_dir = std::path::Path::new(&working_dir).join("hyperzenith_logs");
        let _ = std::fs::create_dir_all(&logs_dir);
        let log_path = logs_dir.join(format!("build_fail_{}.log", Local::now().format("%Y-%m-%d_%H-%M-%S")));
        let _ = std::fs::write(&log_path, log_buffer.lock().unwrap().clone());
        Err(format!("Build failed. Log: {}", log_path.display()))
    }
}

#[tauri::command]
fn nuke_build(working_dir: String) -> Result<String, String> {
    let android_dir = std::path::Path::new(&working_dir).join("android");
    let build_dirs = [
        android_dir.join("app").join("build"),
        android_dir.join("build"),
        android_dir.join(".gradle"),
    ];

    for dir in build_dirs.iter() {
        if dir.exists() {
            println!("🧨 NUKING: {}", dir.display());
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok("Build Nuked!".to_string())
}

#[tauri::command]
fn open_output_folder(working_dir: String) -> Result<String, String> {
    let apk_path = std::path::Path::new(&working_dir)
        .join("android")
        .join("app")
        .join("build")
        .join("outputs")
        .join("apk")
        .join("debug");
    
    if apk_path.exists() {
        Command::new("explorer")
            .arg(apk_path.to_str().unwrap())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok("Opened Explorer".to_string())
    } else {
        Err("APK folder not found yet. Build first!".to_string())
    }
}

#[tauri::command]
async fn scan_for_projects(start_path: String) -> Vec<String> {

    use std::collections::HashSet;
    let mut projects = HashSet::new(); // Use Set to avoid duplicates
    
    // 1. Determine directories to scan
    let mut scan_roots = Vec::new();
    
    // If user provided a path, check it + its parent
    let p_path = std::path::Path::new(&start_path);
    if p_path.exists() {
        scan_roots.push(p_path.to_path_buf());
        if let Some(parent) = p_path.parent() {
            scan_roots.push(parent.to_path_buf());
        }
    }

    // Always check the "Scratch" folder (Default workspace)
    if let Ok(home) = std::env::var("USERPROFILE") {
        let scratch = std::path::Path::new(&home)
            .join(".gemini")
            .join("antigravity")
            .join("scratch");
        if scratch.exists() { scan_roots.push(scratch); }
        
        let docs = std::path::Path::new(&home).join("Documents");
        if docs.exists() { scan_roots.push(docs); }
    }

    // 2. Helper to check if a folder is a Project
    let is_android_project = |path: &std::path::Path| -> bool {
        path.join("android").join("build.gradle").exists() || // Standard
        path.join("android").join("settings.gradle").exists() // Alternative
    };

    // 3. Scan logic (Depth 2 recursion)
    for root in scan_roots {
        let walker = walkdir::WalkDir::new(&root)
            .max_depth(3) // Look 3 levels deep
            .follow_links(false)
            .into_iter();

        for entry in walker.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() && is_android_project(path) {
                if let Some(s) = path.to_str() {
                    projects.insert(s.to_string());
                }
            }
        }
    }

    projects.into_iter().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            get_hardware_profile,
            abort_build,
            execute_build,
            purge_wsl,
            prewarm_engine,
            nuke_build,
            open_output_folder,
            scan_for_projects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_conversion() {
        assert_eq!(windows_to_wsl_path("C:\\Users\\Game"), "/mnt/c/Users/Game");
        assert_eq!(windows_to_wsl_path("D:/Projects/App"), "/mnt/d/Projects/App");
        assert_eq!(windows_to_wsl_path("E:\\Work\\Dev"), "/mnt/e/Work/Dev");
    }

    #[test]
    fn test_hardware_clamping() {
        let gigabyte = 1024 * 1024 * 1024;

        // Test high-end system (Clamped at 16GB)
        let hw_high = calculate_profile(32, 256 * gigabyte);
        assert_eq!(hw_high.jvm_heap_gb, 16); 
        assert!(hw_high.max_workers >= 4);
        
        // Test low-spec system (Minimum 4GB)
        let hw_low = calculate_profile(2, 4 * gigabyte);
        assert_eq!(hw_low.jvm_heap_gb, 4); 
        assert_eq!(hw_low.max_workers, 4); 
    }
}

