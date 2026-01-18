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


  const [buildType, setBuildType] = useState<'apk' | 'aab' | 'simulator' | 'device'>('apk');
  const [platform, setPlatform] = useState<'android' | 'ios'>('android');
  const [macConfig, setMacConfig] = useState(() => {
    const saved = localStorage.getItem('hyperzenith_mac_config');
    return saved ? JSON.parse(saved) : { ip: '', username: '', password: '' };
  });
  const [iosRemotePath, setIosRemotePath] = useState(() => localStorage.getItem('hyperzenith_ios_remote_path') || '~/hyperzenith_builds/project');
  const [iosScheme, setIosScheme] = useState(() => localStorage.getItem('hyperzenith_ios_scheme') || 'App');
  const [showIosSettings, setShowIosSettings] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

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
    // Safety: Ensure no zombie listeners exist from previous runs
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
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

      // Handle iOS Completion/Error signals
      if (platform === 'ios') {
        if (line.includes('✅') || line.includes('❌')) {
          if (line.includes('✅')) setBuildProgress(100);
          else setBuildProgress(0);
          setIsBuilding(false);
          unlisten();
          unlistenRef.current = null; // Clear ref on clean exit
        }
      }
    });
    unlistenRef.current = unlisten;

    try {
      if (platform === 'android') {
        await invoke("execute_build", { workingDir: projectPath, buildType, turboMode, customPath: customArchivePath || null });
        setBuildProgress(100);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        addLog(`✅ BUILD COMPLETE in ${elapsed}s!`);
        if (turboMode) {
          addLog(`⚡ Direct Engine mode (~3x faster than standard)`);
        }
      } else {
        addLog(`🍎 Connecting to Satellite: ${macConfig.ip}...`);
        await invoke("start_ios_build", {
          workingDir: projectPath,
          macConfig,
          remotePath: iosRemotePath,
          scheme: iosScheme,
          buildType
        });
        addLog(`📡 Sync & Build command sent.`);
      }

    } catch (err) {
      addLog(`❌ ${err}`);
      setBuildProgress(0);
      setIsBuilding(false);
      unlisten();
      unlistenRef.current = null;
    } finally {
      if (platform === 'android') {
        unlisten();
        unlistenRef.current = null;
        setIsBuilding(false);
      }
    }
  };

  const handleIosNuke = async () => {
    addLog("☢️ Initiating iOS Nuclear Sequence...");
    try {
      await invoke("trigger_nuke_ios", { macConfig, remotePath: iosRemotePath });
      addLog("✅ Nuke sequence ignited.");
    } catch (err) {
      addLog(`❌ ${err}`);
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
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Panel */}
        <aside className="w-40 shrink-0 border-r border-slate-800/30 flex flex-col bg-[#08090d] min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-3 custom-scrollbar">
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

            {/* Platform Toggle */}
            <div className="flex bg-slate-900/80 border border-slate-800 rounded p-1 mb-3">
              <button
                onClick={() => { setPlatform('android'); setShowMaintenance(false); }}
                className={`flex-1 py-1 text-[9px] font-black rounded transition-all flex items-center justify-center gap-1 ${platform === 'android' ? 'bg-emerald-500 text-black shadow-sm' : 'text-slate-500 hover:text-slate-400'}`}
              >
                <span>🤖</span> ANDROID
              </button>
              <button
                onClick={() => { setPlatform('ios'); setShowMaintenance(false); }}
                className={`flex-1 py-1 text-[9px] font-black rounded transition-all flex items-center justify-center gap-1 ${platform === 'ios' ? 'bg-cyan-500 text-black shadow-sm' : 'text-slate-500 hover:text-slate-400'}`}
              >
                <span>🍎</span> IOS
              </button>
            </div>

            {/* Configuration Card (Type + Turbo) */}
            <div className={`p-3 rounded-lg border transition-all duration-300 ${turboMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/40 border-slate-800'}`}>

              {/* Build Type Row */}
              <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-700/30">
                <span className="text-[10px] font-bold text-slate-500 tracking-wider">TARGET</span>
                <div className="grid grid-cols-2 gap-1 w-[76px] bg-slate-900/80 border border-slate-800 rounded p-0.5">
                  {platform === 'android' ? (
                    <>
                      <button
                        onClick={() => setBuildType('apk')}
                        className={`min-w-0 py-1 text-[9px] font-black rounded transition-all ${buildType === 'apk' ? 'bg-cyan-500 text-black' : 'text-slate-500 hover:text-slate-400'}`}
                      >
                        APK
                      </button>
                      <button
                        onClick={() => setBuildType('aab')}
                        className={`min-w-0 py-1 text-[9px] font-black rounded transition-all ${buildType === 'aab' ? 'bg-cyan-500 text-black' : 'text-slate-500 hover:text-slate-400'}`}
                      >
                        AAB
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setBuildType('simulator')}
                        className={`min-w-0 py-1 text-[9px] font-black rounded transition-all ${buildType === 'simulator' ? 'bg-cyan-500 text-black' : 'text-slate-500 hover:text-slate-400'}`}
                      >
                        APP
                      </button>
                      <button
                        onClick={() => setBuildType('device')}
                        className={`min-w-0 py-1 text-[9px] font-black rounded transition-all ${buildType === 'device' ? 'bg-cyan-500 text-black' : 'text-slate-500 hover:text-slate-400'}`}
                      >
                        IPA
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Turbo Row */}
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <div className={`flex items-center text-xs font-bold tracking-wide transition-colors ${turboMode ? 'text-orange-400' : 'text-cyan-400'}`}>
                    <div style={{ width: '22px' }} className="flex-none flex justify-center mr-1">
                      {turboMode ? '🔥' : '🧊'}
                    </div>
                    <span>{turboMode ? 'DIRECT ENGINE' : 'STABLE MODE'}</span>
                  </div>
                  <div className="flex items-center">
                    <div style={{ width: '22px' }} className="flex-none mr-1" />
                    <span className="text-[9px] text-slate-500 font-medium">
                      {turboMode
                        ? `${hardware?.max_workers || 8} cores • ${hardware?.jvm_heap_gb || 4}GB reserved`
                        : 'Standard EAS Build'}
                    </span>
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

            {/* Trade-Off Micro-List */}
            <div className="p-2 bg-slate-900/50 rounded-lg text-[9px] border border-slate-800/50">
              {turboMode ? (
                <div className="space-y-1 mt-1">
                  <div className="flex items-center text-orange-400">
                    <div style={{ width: '22px' }} className="flex-none flex justify-center items-center">⚡</div>
                    <div className="ml-2">Config Cache + Parallel</div>
                  </div>
                  <div className="flex items-center text-red-400/70">
                    <div style={{ width: '22px' }} className="flex-none flex justify-center items-center">✕</div>
                    <div className="ml-2">Lint & Tests Skipped</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 mt-1">
                  <div className="flex items-center text-emerald-400">
                    <div style={{ width: '22px' }} className="flex-none flex justify-center items-center">✓</div>
                    <div className="ml-2">Full Lint & Tests</div>
                  </div>
                  <div className="flex items-center text-cyan-400">
                    <div style={{ width: '22px' }} className="flex-none flex justify-center items-center">✓</div>
                    <div className="ml-2">Low System Impact</div>
                  </div>
                </div>
              )}
            </div>

            {/* iOS Satellite Configuration */}
            {platform === 'ios' && (
              <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg space-y-2 relative">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">SATELLITE</span>
                  <button onClick={() => setShowIosSettings(!showIosSettings)} className="text-cyan-400 p-1 hover:bg-cyan-400/20 rounded">⚙️</button>
                </div>
                {showIosSettings ? (
                  <div className="space-y-1 mt-1">
                    <input type="text" value={macConfig.ip} onChange={e => {
                      const c = { ...macConfig, ip: e.target.value };
                      setMacConfig(c); localStorage.setItem('hyperzenith_mac_config', JSON.stringify(c));
                    }} placeholder="Mac IP (e.g. 192.168.1.15)" className="w-full bg-slate-950 border border-slate-800 px-2 py-1 text-[9px] rounded outline-none focus:border-cyan-500/50" />
                    <input type="text" value={macConfig.username} onChange={e => {
                      const c = { ...macConfig, username: e.target.value };
                      setMacConfig(c); localStorage.setItem('hyperzenith_mac_config', JSON.stringify(c));
                    }} placeholder="Username" className="w-full bg-slate-950 border border-slate-800 px-2 py-1 text-[9px] rounded outline-none focus:border-cyan-500/50" />
                    <input type="password" value={macConfig.password} onChange={e => {
                      const c = { ...macConfig, password: e.target.value };
                      setMacConfig(c); localStorage.setItem('hyperzenith_mac_config', JSON.stringify(c));
                    }} placeholder="Password" className="w-full bg-slate-950 border border-slate-800 px-2 py-1 text-[9px] rounded outline-none focus:border-cyan-500/50" />
                    <input type="text" value={iosRemotePath} onChange={e => {
                      setIosRemotePath(e.target.value); localStorage.setItem('hyperzenith_ios_remote_path', e.target.value);
                    }} placeholder="Remote Project Path" className="w-full bg-slate-950 border border-slate-800 px-2 py-1 text-[9px] rounded outline-none focus:border-cyan-500/50" />
                    <input type="text" value={iosScheme} onChange={e => {
                      setIosScheme(e.target.value); localStorage.setItem('hyperzenith_ios_scheme', e.target.value);
                    }} placeholder="Scheme" className="w-full bg-slate-950 border border-slate-800 px-2 py-1 text-[9px] rounded outline-none focus:border-cyan-500/50" />
                    <button onClick={() => setShowIosSettings(false)} className="w-full py-1 mt-1 bg-cyan-500 text-black text-[8px] font-bold rounded">SAVE CONFIG</button>
                  </div>
                ) : (
                  <div className="text-[9px] text-slate-400">
                    <div>{macConfig.ip || 'No IP'} • {macConfig.username || 'No User'}</div>
                    <div className="truncate opacity-60">Path: {iosRemotePath}</div>
                  </div>
                )}
              </div>
            )}

            {/* Build Button */}
            <button
              onClick={isBuilding ? handleAbort : handleBuild}
              className={`w-full py-3 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${isBuilding
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-black hover:from-cyan-400 hover:to-emerald-400 active:scale-[0.98]'
                }`}
            >
              {isBuilding
                ? `🛑 ABORT ${formatTime(elapsedTime)} (${Math.round(buildProgress)}%)`
                : `🚀 IGNITE ${buildType === 'simulator' ? 'APP' : buildType === 'device' ? 'IPA' : buildType.toUpperCase()}`
              }
            </button>

            {/* Open Output Folder Button */}
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
              {`📂 OPEN ${buildType === 'simulator' ? 'APP' : buildType === 'device' ? 'IPA' : buildType.toUpperCase()}`}
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
                {platform === 'android' ? (
                  <button onClick={handleNuke} className="w-full py-1.5 text-[9px] font-semibold uppercase bg-red-900/30 text-red-400 rounded hover:bg-red-900/50 transition-colors">
                    🧨 Nuke Gradle Cache
                  </button>
                ) : (
                  <button onClick={handleIosNuke} className="w-full py-1.5 text-[9px] font-semibold uppercase bg-red-900/30 text-red-400 rounded hover:bg-red-900/50 transition-colors">
                    ☢️ Nuclear iOS Reset
                  </button>
                )}
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
        <section className="flex-1 flex flex-col bg-[#050506] min-w-0 min-h-0 overflow-hidden">
          <div className="shrink-0 px-4 py-2 border-b border-slate-800/30 flex justify-between items-center">
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Console</span>
            <span className={`text-[9px] ${isBuilding ? 'text-emerald-400 animate-pulse' : 'text-slate-700'}`}>
              {isBuilding ? '● BUILDING' : '○ IDLE'}
            </span>
          </div>
          <div className="flex-1 min-h-0 p-4 overflow-y-auto text-[10px] leading-relaxed font-mono custom-scrollbar">
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
