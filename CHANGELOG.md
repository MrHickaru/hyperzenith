# Changelog

All notable changes to HyperZenith are documented here.

## [1.3.0] - 2026-01-17

### Added
- **APK Archive System**: Builds are now saved to `hyperzenith_builds/` with timestamps.
- **Smart Project Scanner**: Magic Wand (🪄) button auto-detects nearby Android projects.
- **Configuration Caching**: Skips project setup on repeat builds (saves 15-20s).
- **Parallel GC**: Switched to high-throughput garbage collection for faster builds.

### Fixed
- **ANDROID_HOME for WSL**: SDK path now correctly converts to Linux format.
- **Build Timer 0.0s bug**: Timer now uses local variable for accurate elapsed time.
- **Dialog Permissions**: Added `dialog:default` capability for folder picker.

### Changed
- **Open APK Folder** now points to managed `hyperzenith_builds/` archive.
- All Clippy warnings resolved for production-grade code quality.

---

## [1.2.0] - 2026-01-16

### Added
- **Live Build Timer**: Real-time MM:SS display during builds.
- **Hardware Auto-Detection**: Dynamically sets workers (90% of cores) and JVM heap (50% RAM, clamped 4-16GB).
- **Open APK Folder Button**: Quick access to build output after success.
- **VFS Watching**: Faster file change detection via `-Dorg.gradle.vfs.watch=true`.
- **Kotlin Incremental Compilation**: Enabled `-Dkotlin.incremental=true`.

### Removed
- **Configuration Caching** (temporarily): Incompatible with Expo's Node.js spawning.

---

## [1.1.0] - 2026-01-15

### Added
- **Turbo Mode**: Aggressive Gradle optimization flags.
- **Maintenance Menu**: Collapsible section for Nuke Build and Purge WSL.
- **Live CPU/RAM Stats**: Real-time system monitoring in sidebar.
- **Shimmer Progress Bar**: Visual feedback during builds.

### Removed
- **3D GPU Visualizer**: Removed for stability and performance.
- **RAM Disk Engine**: Removed due to I/O errors with symlinks.
- **Thread Affinity Slider**: Removed (automatic allocation is better).

---

## [1.0.0] - 2026-01-14

### Initial Release
- Basic Tauri + React Native build orchestrator.
- Project folder picker.
- Build/Abort functionality.
- Console log output.
