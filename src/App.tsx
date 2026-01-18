import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import './App.css';

interface SystemStats {
  cpu_usage: number[];
  total_memory: number;
  used_memory: number;
  available_memory: number;
  cpu_count: number;
}

interface HardwareProfile {
  max_workers: number;
  jvm_heap_gb: number;
  cpu_cores: number;
  total_ram_gb: number;
}

export default function App() {
  const [projectPath, setProjectPath] = useState("");

  const [turboMode, setTurboMode] = useState(true);
  const [isBuilding, setIsBuilding] = useState(false);
  const [engineStatus, setEngineStatus] = useState("Select Project");
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [logs, setLogs] = useState<string[]>(["🚀 HyperZenith V1.3.6"]);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildStartTime, setBuildStartTime] = useState<number | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [showScanResults, setShowScanResults] = useState(false);
  const [customArchivePath, setCustomArchivePath] = useState(() => localStorage.getItem('hyperzenith_archive_path') || '');
  const hasPrewarmed = useRef(false);


  const [buildType, setBuildType] = useState<'apk' | 'aab'>('apk');

  const addLog = (msg: string) => setLogs(prev => [msg, ...prev.slice(0, 150)]);

  // Fetch hardware profile on mount
  useEffect(() => {
    invoke<HardwareProfile>('get_hardware_profile').then(setHardware).catch(console.error);
  }, []);

  // Pre-warm when project is selected
  useEffect(() => {
    if (!projectPath || hasPrewarmed.current) return;
    hasPrewarmed.current = true;
    setEngineStatus("Pre-heating...");
    invoke('prewarm_engine', { workingDir: projectPath })
      .then(() => setTimeout(() => setEngineStatus("Ready"), 2000))
      .catch(() => setEngineStatus("Ready"));
  }, [projectPath]);


  // Stats polling
  useEffect(() => {
    const interval = setInterval(async () => {
      try { setStats(await invoke("get_system_stats")); } catch { }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Build timer
  const [elapsedTime, setElapsedTime] = useState(0);
  useEffect(() => {
    if (!isBuilding || !buildStartTime) {
      setElapsedTime(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - buildStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isBuilding, buildStartTime]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };


  const estimateProgress = useCallback((line: string): number => {
    const l = line.toLowerCase();
    if (l.includes('starting') || l.includes('initializing')) return 5;
    if (l.includes('downloading') || l.includes('resolving')) return 12;
    if (l.includes('configuring')) return 20;
    if (l.includes(':prebuild') || l.includes('prebuild')) return 28;
    if (l.includes(':compile') || l.includes('compiling')) return 45;
    if (l.includes(':merge') || l.includes('merging')) return 60;
    if (l.includes(':package') || l.includes('packaging')) return 72;
    if (l.includes(':assemble') || l.includes('assembling')) return 85;
    if (l.includes(':bundle') || l.includes('bundling')) return 85; // Handled AAB step
    if (l.includes('signing') || l.includes(':sign')) return 92;
    if (l.includes('build successful') || l.includes('build completed')) return 100;
    return -1;
  }, []);

  const handleBuild = async () => {
    setIsBuilding(true);
    setBuildProgress(0);
    const startTime = Date.now();
    setBuildStartTime(startTime);
    addLog(`⚡ TURBO BUILD: ${hardware?.max_workers} workers, ${hardware?.jvm_heap_gb}GB heap (${buildType.toUpperCase()})`);

    const unlisten = await listen<string>('build-output', (event) => {
      const line = event.payload;
      if (line.trim()) addLog(line.slice(0, 120));
      const est = estimateProgress(line);
      if (est > 0) setBuildProgress(prev => Math.max(prev, est));
      else setBuildProgress(prev => Math.min(prev + 0.08, 95));
    });

    try {
      await invoke("execute_build", { workingDir: projectPath, buildType, turboMode, customPath: customArchivePath || null });
      setBuildProgress(100);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      addLog(`✅ BUILD COMPLETE in ${elapsed}s!`);

    } catch (err) {
      addLog(`❌ ${err}`);
    } finally {
      unlisten();
      setIsBuilding(false);
    }
  };

  const handleAbort = async () => {
    await invoke("abort_build").catch(() => { });
    addLog("🛑 Build aborted.");
    setIsBuilding(false);
  };

  const handleNuke = async () => {
    addLog("🧨 Nuking build directories...");
    try {
      const msg: string = await invoke("nuke_build", { workingDir: projectPath });
      addLog(`✅ ${msg}`);
    } catch (err) {
      addLog(`❌ ${err}`);
    }
    setShowMaintenance(false);
  };

  const handlePurge = async () => {
    addLog("🔥 Shutting down WSL...");
    try {
      await invoke("purge_wsl");
      addLog("✅ WSL shutdown.");
    } catch (err) {
      addLog(`❌ ${err}`);
    }
    setShowMaintenance(false);
  };

  const handleOpenOutput = async () => {
    try {
      await invoke("open_build_archive", { workingDir: projectPath, customPath: customArchivePath || null });
      addLog("📂 Opening APK folder...");
    } catch (err) {
      addLog(`❌ ${err}`);
    }
  };

  const handleClearArchive = async () => {
    addLog("🗑️ Clearing APK archive...");
    try {
      const msg: string = await invoke("clear_archive", { workingDir: projectPath, customPath: customArchivePath || null });
      addLog(`✅ ${msg}`);
    } catch (err) {
      addLog(`❌ ${err}`);
    }
    setShowMaintenance(false);
  };

  const handleArchivePathChange = (newPath: string) => {
    setCustomArchivePath(newPath);
    localStorage.setItem('hyperzenith_archive_path', newPath);
  };

  const handleOpenLogs = async () => {
    try {
      await invoke("open_logs_folder", { workingDir: projectPath });
      addLog("📂 Opening logs folder...");
    } catch (err) {
      addLog(`❌ ${err}`);
    }
  };

  const memPercent = stats ? Math.round((stats.used_memory / stats.total_memory) * 100) : 0;
  const avgCpu = stats ? Math.round(stats.cpu_usage.reduce((a, b) => a + b, 0) / stats.cpu_usage.length) : 0;

  return (
    <div className="h-screen w-screen bg-[#08090d] text-white font-mono flex flex-col overflow-hidden select-none">
      {/* Header */}
      <header className="shrink-0 flex justify-between items-center px-6 py-3 border-b border-slate-800/40 bg-[#08090d]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-black tracking-tight">
            HYPER<span className="text-cyan-400">ZENITH</span>
          </h1>
          <span className="text-[9px] font-medium px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded">V1.3.6</span>
        </div>
        <div className="flex items-center gap-5 text-[11px]">
          {hardware && (
            <span className="text-slate-500">{hardware.cpu_cores} cores • {hardware.total_ram_gb}GB</span>
          )}
          <span className={engineStatus === 'Ready' ? 'text-emerald-400' : 'text-amber-400'}>● {engineStatus}</span>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="shrink-0 h-1.5 bg-slate-900 relative overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 via-cyan-400 to-emerald-400 transition-all duration-300 ease-out"
          style={{ width: `${buildProgress}%` }}
        />
        {isBuilding && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
        )}
      </div>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel */}
        <aside className="w-40 shrink-0 border-r border-slate-800/30 flex flex-col bg-[#08090d]">
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-3 custom-scrollbar">
            {/* Project */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600 block mb-1">Project</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="Select project folder..."
                  className="flex-1 bg-slate-900/80 border border-slate-800 px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:border-cyan-500/50 rounded placeholder:text-slate-600"
                />
                <button
                  onClick={async () => {
                    try {
                      const sel = await open({ directory: true, multiple: false });
                      if (sel && typeof sel === 'string') setProjectPath(sel);
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="px-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-950 active:scale-95 text-slate-300 text-[10px] font-bold rounded border border-slate-700 hover:border-slate-600 transition-all"
                  title="Browse Folder"
                >
                  ...
                </button>
                <button
                  onClick={async () => {
                    try {
                      const found: string[] = await invoke('scan_for_projects', { startPath: projectPath || "C:\\" });
                      if (found.length === 0) {
                        addLog("🔍 No Android projects found nearby.");
                      } else if (found.length === 1) {
                        setProjectPath(found[0]);
                        addLog("✨ Auto-detected project!");
                      } else {
                        setScanResults(found);
                        setShowScanResults(true);
                        addLog(`🔍 Found ${found.length} projects.`);
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="px-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-950 active:scale-95 text-slate-300 text-[10px] font-bold rounded border border-slate-700 hover:border-slate-600 transition-all"
                  title="Auto-Detect Project Nearby"
                >
                  🪄
                </button>
              </div>

              {/* Scan Results Dropdown */}
              {showScanResults && scanResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                  <div className="px-2 py-1 text-[9px] font-bold text-slate-500 bg-slate-950/50 border-b border-slate-800">select project</div>
                  {scanResults.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => { setProjectPath(p); setShowScanResults(false); }}
                      className="w-full text-left px-3 py-2 text-[10px] text-slate-300 hover:bg-cyan-900/20 hover:text-cyan-400 transition-colors truncate"
                    >
                      {p.split('\\').pop() || p} <span className="text-slate-600 ml-1 text-[9px]">({p})</span>
                    </button>
                  ))}
                  <button onClick={() => setShowScanResults(false)} className="w-full text-center py-1 text-[9px] text-slate-500 hover:text-slate-300 border-t border-slate-800">cancel</button>
                </div>
              )}
            </div>

            {/* Configuration Card (Type + Turbo) */}
            <div className={`p-3 rounded-lg border transition-all duration-300 ${turboMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/40 border-slate-800'}`}>

              {/* Build Type Row */}
              <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-700/30">
                <span className="text-[10px] font-bold text-slate-500 tracking-wider">BUILD TARGET</span>
                <div className="flex bg-slate-900/80 border border-slate-800 rounded p-0.5">
                  <button
                    onClick={() => setBuildType('apk')}
                    className={`px-3 py-1 text-[9px] font-black rounded transition-all ${buildType === 'apk' ? 'bg-cyan-500 text-black shadow-sm' : 'text-slate-500 hover:text-slate-400'}`}
                  >
                    APK
                  </button>
                  <button
                    onClick={() => setBuildType('aab')}
                    className={`px-3 py-1 text-[9px] font-black rounded transition-all ${buildType === 'aab' ? 'bg-cyan-500 text-black shadow-sm' : 'text-slate-500 hover:text-slate-400'}`}
                  >
                    AAB
                  </button>
                </div>
              </div>

              {/* Turbo Row */}
              <div className="flex justify-between items-center">
                <div>
                  <div className={`text-xs font-bold tracking-wide transition-colors ${turboMode ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {turboMode ? '⚡ TURBO ACTIVE' : '🐢 TURBO OFF'}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 font-medium">
                    {hardware ? `${hardware.max_workers} workers • ${hardware.jvm_heap_gb}GB heap` : 'Auto-detecting...'}
                  </div>
                </div>
                <button
                  onClick={() => setTurboMode(!turboMode)}
                  style={{
                    width: '32px',
                    height: '16px',
                    borderRadius: '8px',
                    backgroundColor: turboMode ? '#10b981' : '#475569',
                    position: 'relative',
                    transition: 'all 0.3s',
                    boxShadow: turboMode ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none',
                    cursor: 'pointer',
                    border: 'none',
                    marginRight: '5px'
                  }}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: 'white',
                      position: 'absolute',
                      top: '3px',
                      left: turboMode ? '19px' : '3px',
                      transition: 'all 0.3s',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }}
                  />
                </button>
              </div>
            </div>

            {/* Build Button */}
            <button
              onClick={isBuilding ? handleAbort : handleBuild}
              className={`w-full py-3 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${isBuilding
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-black hover:from-cyan-400 hover:to-emerald-400 active:scale-[0.98]'
                }`}
            >
              {isBuilding ? `🛑 ABORT ${formatTime(elapsedTime)} (${Math.round(buildProgress)}%)` : `🚀 IGNITE ${buildType.toUpperCase()} BUILD`}
            </button>

            {/* Open APK Folder Button */}
            <button
              onClick={handleOpenOutput}
              disabled={isBuilding}
              className={`w-full py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-lg border transition-all ${buildProgress >= 100 && !isBuilding
                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 hover:bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                : isBuilding
                  ? 'bg-slate-900/50 border-slate-800 text-slate-700 cursor-not-allowed opacity-50'
                  : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:bg-slate-800'
                }`}
            >
              📂 Open APK Folder
            </button>

            {/* Live Stats */}

            <div className="flex gap-2 text-[9px]">
              <div className="flex-1 p-2 bg-slate-900/50 rounded border border-slate-800/50 text-center">
                <div className="text-slate-500">CPU</div>
                <div className={`font-bold ${avgCpu > 80 ? 'text-orange-400' : 'text-cyan-400'}`}>{avgCpu}%</div>
              </div>
              <div className="flex-1 p-2 bg-slate-900/50 rounded border border-slate-800/50 text-center">
                <div className="text-slate-500">RAM</div>
                <div className={`font-bold ${memPercent > 80 ? 'text-orange-400' : 'text-cyan-400'}`}>{memPercent}%</div>
              </div>
            </div>

          </div>

          {/* Maintenance Toggle (Fixed Footer) */}
          <div className="shrink-0 p-2 border-t border-slate-800/50 bg-[#08090d] z-20 relative">
            <button
              onClick={() => setShowMaintenance(!showMaintenance)}
              className="w-full py-2 text-[9px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors"
            >
              ⚙️ Maintenance {showMaintenance ? '▲' : '▼'}
            </button>
            {showMaintenance && (
              <div className="absolute bottom-full left-0 right-0 mx-2 mb-2 p-2 bg-slate-900 border border-slate-800 rounded-lg space-y-1 shadow-2xl z-30">
                <button onClick={handleNuke} className="w-full py-1.5 text-[9px] font-semibold uppercase bg-red-900/30 text-red-400 rounded hover:bg-red-900/50 transition-colors">
                  🧨 Nuke Gradle Cache
                </button>
                <button onClick={handleClearArchive} className="w-full py-1.5 text-[9px] font-semibold uppercase bg-purple-900/30 text-purple-400 rounded hover:bg-purple-900/50 transition-colors">
                  🗑️ Clear Archive
                </button>
                <button onClick={handlePurge} className="w-full py-1.5 text-[9px] font-semibold uppercase bg-orange-900/30 text-orange-400 rounded hover:bg-orange-900/50 transition-colors">
                  🔥 Purge WSL
                </button>
                <button onClick={handleOpenLogs} className="w-full py-1.5 text-[9px] font-semibold uppercase bg-slate-700/50 text-slate-400 rounded hover:bg-slate-600/50 transition-colors">
                  📂 Open Logs Folder
                </button>
                <div className="mt-2 pt-2 border-t border-slate-700">
                  <label className="text-[8px] text-slate-500 block mb-1">Custom Output Path:</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={customArchivePath}
                      onChange={(e) => handleArchivePathChange(e.target.value)}
                      placeholder="Default: hyperzenith_builds/"
                      className="flex-1 px-2 py-1 text-[9px] bg-slate-800 border border-slate-700 rounded text-slate-300 placeholder-slate-600"
                    />
                    <button
                      onClick={async () => {
                        const selected = await open({ directory: true, multiple: false });
                        if (selected) handleArchivePathChange(selected as string);
                      }}
                      className="px-2 py-1 text-[9px] bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                    >
                      ...
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Console */}
        <section className="flex-1 flex flex-col bg-[#050506] min-w-0">
          <div className="shrink-0 px-4 py-2 border-b border-slate-800/30 flex justify-between items-center">
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Console</span>
            <span className={`text-[9px] ${isBuilding ? 'text-emerald-400 animate-pulse' : 'text-slate-700'}`}>
              {isBuilding ? '● BUILDING' : '○ IDLE'}
            </span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto text-[10px] leading-relaxed font-mono">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`py-px ${log.startsWith('❌') ? 'text-red-400' :
                  log.startsWith('✅') ? 'text-emerald-400' :
                    log.startsWith('⚡') || log.startsWith('🚀') ? 'text-cyan-400' :
                      log.startsWith('🧨') || log.startsWith('🔥') ? 'text-orange-400' :
                        'text-slate-500'
                  }`}
              >
                {log}
              </div>
            ))}
          </div>
        </section>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .animate-shimmer {
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </div>
  );
}
