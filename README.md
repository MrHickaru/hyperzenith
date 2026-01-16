# HyperZenith 🏎️
> **Speed up and manage your local Android builds for Expo & React Native.**

A sleek Tauri + React desktop app that supercharges your local Android builds by automatically detecting your hardware and configuring Gradle for maximum parallelism.

![Version](https://img.shields.io/badge/version-1.2-cyan)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **Auto-Detect Hardware** – Detects CPU cores & RAM, allocates ~90% for builds
- **Turbo Mode** – One-click optimized Gradle flags (`--parallel`, `--build-cache`, `-Dkotlin.incremental=true`)
- **Live Build Timer** – Real-time MM:SS elapsed time tracking
- **Diagnostic Logging** – Timestamped failure logs in `hyperzenith_logs/`
- **Instant APK Access** – "Open APK Folder" button after successful builds
- **WSL Purge** – Instantly reclaim memory from `VmmemWSL`
- **Nuke Build** – Force-clear corrupted build directories

## 🖥️ Screenshots

<!-- Add screenshots here -->

## 🚀 Getting Started

### Prerequisites
- Windows 10/11 with WSL2
- Node.js 18+
- Rust (via rustup)
- Android SDK (via Android Studio)

### Installation

```bash
# Clone the repo
git clone https://github.com/MrHickaru/hyperzenith.git
cd hyperzenith

# Install dependencies
npm install

# Run in dev mode
npm run tauri dev

# Build for production
npm run tauri build
```

## ⚡ How It Works

When you click **IGNITE BUILD**, HyperZenith runs this optimized Gradle command inside WSL:

```bash
./gradlew assembleDebug \
  --parallel \
  --build-cache \
  --max-workers=18 \
  -Dorg.gradle.caching=true \
  -Dorg.gradle.parallel=true \
  -Dkotlin.incremental=true \
  -x lint -x test
```

The `--max-workers` and JVM heap are auto-calculated from your system specs.

## 🛠️ Tech Stack

- **Frontend**: React + TypeScript + TailwindCSS
- **Backend**: Rust + Tauri
- **Build Target**: WSL2 + Gradle

## 📄 License

MIT © 2026 MrHickaru

---

**Made with ⚡ by developers who got tired of waiting for builds.**
