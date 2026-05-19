
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { VideoAnalyzer } from './components/VideoAnalyzer';
import { LiftChart } from './components/LiftChart';
import { LiftMetrics } from './types';
import { OnsetDetectorHPC } from './lib/hpc/OnsetDetectorHPC';

// --- UX COMPONENT: RESIZER HANDLE ---
const Resizer = ({ orientation, onResizeStart, isResizing }: { orientation: 'vertical' | 'horizontal', onResizeStart: (e: React.MouseEvent | React.TouchEvent) => void, isResizing: boolean }) => {
    const isVert = orientation === 'vertical';
    return (
        <div 
            className={`group relative z-50 flex items-center justify-center transition-colors touch-none
                ${isVert 
                    ? 'w-6 cursor-col-resize -ml-3 -mr-3 h-full' 
                    : 'h-6 w-full cursor-row-resize -mt-3 -mb-3'
                }`}
            onMouseDown={onResizeStart}
            onTouchStart={onResizeStart}
        >
            {/* Ambient Hit Area Background (Invisible until hover) */}
            <div className={`absolute inset-0 transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${isResizing ? 'opacity-100' : ''}
                ${isVert ? 'bg-gradient-to-r from-transparent via-yellow-500/10 to-transparent' : 'bg-gradient-to-b from-transparent via-yellow-500/10 to-transparent'}`} 
            />

            {/* Visual Line spanning the full length */}
            <div className={`absolute transition-all duration-300 ${isResizing ? 'bg-yellow-400' : 'bg-zinc-800 group-hover:bg-yellow-500'} 
                ${isVert 
                    ? `w-[1px] h-full ${isResizing ? 'w-[2px] shadow-[0_0_8px_rgba(234,179,8,0.5)]' : 'group-hover:w-[2px]'}` 
                    : `h-[1px] w-full ${isResizing ? 'h-[2px] shadow-[0_0_8px_rgba(234,179,8,0.5)]' : 'group-hover:h-[2px]'}`
                }`} 
            />
            
            {/* Affordance Handle (Grip Dots instead of Pill) */}
            <div className={`absolute flex items-center justify-center gap-[3px] transition-transform duration-300 ${isResizing ? 'scale-110' : 'group-hover:scale-110'}
                ${isVert 
                    ? 'flex-col left-1/2 -translate-x-1/2 w-3 h-10 bg-zinc-900/80 rounded-full border border-zinc-700/50 backdrop-blur-sm shadow-sm' 
                    : 'flex-row top-1/2 -translate-y-1/2 h-3 w-10 bg-zinc-900/80 rounded-full border border-zinc-700/50 backdrop-blur-sm shadow-sm'
                }`}
            >
                <div className={`rounded-full transition-colors ${isResizing ? 'bg-yellow-400' : 'bg-zinc-500 group-hover:bg-yellow-400'} w-1 h-1`} />
                <div className={`rounded-full transition-colors ${isResizing ? 'bg-yellow-400' : 'bg-zinc-500 group-hover:bg-yellow-400'} w-1 h-1`} />
                <div className={`rounded-full transition-colors ${isResizing ? 'bg-yellow-400' : 'bg-zinc-500 group-hover:bg-yellow-400'} w-1 h-1`} />
            </div>
        </div>
    );
};

// Helper component for stat box
const StatBox = ({ id, label, valAvg, valL, valR, unit, subColor = "text-zinc-600", valColor = "text-white", hasSides, focusSide, onSideClick, precision = 0 }: any) => {
    return (
    <div className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50 flex flex-col justify-between hover:bg-zinc-800 transition-colors">
        <div className="flex flex-col xl:flex-row justify-between items-start mb-2 gap-2 xl:gap-0">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</span>
            {hasSides && (
                 <div className="flex flex-wrap gap-1 bg-zinc-900/50 p-1 rounded-lg border border-zinc-700/50 w-full xl:w-auto mt-1 xl:mt-0">
                     <button onClick={() => onSideClick('avg')} className={`flex-1 text-[10px] sm:text-xs px-2 py-1 sm:py-1.5 rounded-md flex items-center justify-center font-bold transition-all ${focusSide === 'avg' ? 'bg-blue-500 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}>AVG</button>
                     <button onClick={() => onSideClick('all')} className={`flex-1 text-[10px] sm:text-xs px-2 py-1 sm:py-1.5 rounded-md flex items-center justify-center font-bold transition-all ${focusSide === 'all' ? 'bg-purple-500 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}>ALL</button>
                     <button onClick={() => onSideClick('L')} className={`flex-1 text-[10px] sm:text-xs px-2 py-1 sm:py-1.5 rounded-md flex items-center justify-center font-bold transition-all ${focusSide === 'L' ? 'bg-yellow-500 text-black shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}>L</button>
                     <button onClick={() => onSideClick('R')} className={`flex-1 text-[10px] sm:text-xs px-2 py-1 sm:py-1.5 rounded-md flex items-center justify-center font-bold transition-all ${focusSide === 'R' ? 'bg-emerald-500 text-black shadow-sm' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}>R</button>
                 </div>
            )}
        </div>
        <div className="flex items-baseline gap-1 mt-1">
            {focusSide === 'all' && hasSides ? (
                <div id={id} className={`flex gap-1 text-base font-mono font-bold leading-none items-baseline ${valColor}`}>
                    <span className="text-yellow-500 text-sm">L</span><span>{valL !== undefined ? valL.toFixed(precision) : '--'}</span>
                    <span className="text-emerald-500 text-sm ml-1">R</span><span>{valR !== undefined ? valR.toFixed(precision) : '--'}</span>
                </div>
            ) : (
                <span id={id} className={`text-xl font-mono font-bold ${valColor}`}>
                    {focusSide === 'L' && hasSides && valL !== undefined ? valL.toFixed(precision) : 
                     focusSide === 'R' && hasSides && valR !== undefined ? valR.toFixed(precision) : 
                     (valAvg !== undefined && valAvg !== null ? valAvg.toFixed(precision) : '--')}
                </span>
            )}
            <span className={`text-[10px] font-bold ${subColor}`}>{unit}</span>
        </div>
    </div>
    );
};

const App = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  
  const [liveMetrics, setLiveMetrics] = useState<LiftMetrics>({ time: '0', velocity: 0, height: 0, power: 0, x: 0, y: 0, kneeAngle: 0, hipAngle: 0, ankleAngle: 0, backAngle: 0 });
  const liveMetricsRef = useRef<LiftMetrics>(liveMetrics);
  
  // 'cursorMetrics' is what comes from hovering the chart
  const [cursorMetrics, setCursorMetrics] = useState<LiftMetrics | null>(null);
  const cursorMetricsRef = useRef<LiftMetrics | null>(null);
  
  // Stores the entire history of the lift.
  const [allMetrics, setAllMetrics] = useState<LiftMetrics[]>([]);
  const allMetricsRef = useRef<LiftMetrics[]>([]);
  useEffect(() => { allMetricsRef.current = allMetrics; }, [allMetrics]);
  
  // Control video seeking from chart
  const [seekRequest, setSeekRequest] = useState<{time: number, nonce: number} | null>(null);
  
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false);
  const [barbellMass, setBarbellMass] = useState(60); 
  const barbellMassRef = useRef(barbellMass);
  useEffect(() => { barbellMassRef.current = barbellMass; }, [barbellMass]);

  const [userHeightCm, setUserHeightCm] = useState<number | ''>('');
  
  // Mobile Tab State
  const [activeTab, setActiveTab] = useState<'chart' | 'stats'>('stats');

  // --- RESIZABLE LAYOUT STATE ---
  const [layout, setLayout] = useState({
      rightWidth: 760,
      mobileVideoHeightPct: 45, // 45% height by default on mobile
      chartHeightPct: 55 // 55% height by default on desktop
  });
  const [isResizing, setIsResizing] = useState(false);

  const [focusSide, setFocusSide] = useState<'avg' | 'L' | 'R'>('avg');
  const focusSideRef = useRef<'avg' | 'L' | 'R'>('avg');
  useEffect(() => { focusSideRef.current = focusSide; }, [focusSide]);

  // --- ENGINE INITIALIZATION STATE ---
  const [initLog, setInitLog] = useState<{name: string, status: 'loading'|'ready'|'error'}[]>([
    {name: 'Core Analysis Engine', status: 'loading'},
    {name: 'Environment Calibration Engine', status: 'loading'},
    {name: 'Motion Tracking System', status: 'loading'},
  ]);
  const [isInitComplete, setIsInitComplete] = useState(false);
  const [initFailed, setInitFailed] = useState(false);

  // Global UI Lock for Mobile (Prevent unwanted selection and manual copy)
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
        // We block all manual copy events. 
        // Note: navigator.clipboard.writeText used in CSV export bypasses this.
        e.preventDefault();
    };

    const handleContextMenu = (e: MouseEvent) => {
        // Disable context menu on mobile to prevent "Select All / Copy" popups
        // We only allow it for input elements so users can still paste into them if needed
        const isInput = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA';
        if (!isInput && window.matchMedia('(pointer: coarse)').matches) {
            e.preventDefault();
        }
    };

    window.addEventListener('copy', handleCopy);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
        window.removeEventListener('copy', handleCopy);
        window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  useEffect(() => {
     let checkCount = 0;
     const maxChecks = 300; // 30 seconds

     const initInterval = setInterval(() => {
        checkCount++;
        
        let poseReady = !!(window as any).Pose;
        let cvReady = (window as any).cv && (window as any).cv.Mat;

        setInitLog([
            {name: 'Core Analysis Engine', status: poseReady ? 'ready' : (checkCount >= maxChecks ? 'error' : 'loading')},
            {name: 'Environment Calibration Engine', status: cvReady ? 'ready' : (checkCount >= maxChecks ? 'error' : 'loading')},
            {name: 'Motion Tracking System', status: cvReady ? 'ready' : (checkCount >= maxChecks ? 'error' : 'loading')},
        ]);

        if (poseReady && cvReady) {
            clearInterval(initInterval);
            setTimeout(() => setIsInitComplete(true), 800); 
        } else if (checkCount >= maxChecks) {
            clearInterval(initInterval);
            setInitFailed(true);
        }
     }, 100);

     return () => clearInterval(initInterval);
  }, []);

  // The Display Metrics switch between Cursor (Scrubbing) and Live (Playback)
  const displayMetrics = cursorMetrics || liveMetrics;

  // --- ACADEMIC / OLYMPIC METRICS CALCULATION ---
  const stats = useMemo(() => {
     if (allMetrics.length === 0) return null;

     let maxVel = 0; let timeMaxVel = 0;
     let maxHgt = 0; let timeMaxHgt = 0;
     let maxPwr = 0; let timeMaxPwr = 0;

     allMetrics.forEach(m => {
         const t = parseFloat(m.time);
         if (m.velocity > maxVel) { maxVel = m.velocity; timeMaxVel = t; }
         if (m.height > maxHgt) { maxHgt = m.height; timeMaxHgt = t; }
         if (m.power > maxPwr) { maxPwr = m.power; timeMaxPwr = t; }
     });
     
     // Calculate Force & Acceleration
     let maxForce = 0; let timeMaxForce = 0;
     let maxAccel = 0; let timeMaxAccel = 0;
     let totalWork = 0; // J = Force * Distance (simplified integration)

     for(let i=1; i<allMetrics.length; i++) {
        const curr = allMetrics[i];
        const prev = allMetrics[i-1];
        const dt = parseFloat(curr.time) - parseFloat(prev.time);
        
        if (dt > 0.001) {
            const accel = (curr.velocity - prev.velocity) / dt;
            const force = barbellMass * (accel + 9.81);
            
            if (force > maxForce) { maxForce = force; timeMaxForce = parseFloat(curr.time); }
            if (accel > maxAccel) { maxAccel = accel; timeMaxAccel = parseFloat(curr.time); }

            // Work = F * d
            const dy = Math.abs(curr.height - prev.height);
            totalWork += force * dy;
        }
     }

     // RFD (Rate of Force Development) Estimate
     const rfd = maxForce / 0.25; 
     
     // Industrial Grade Onset Detection to find true start time
     const powers = allMetrics.map(d => d.power);
     const onsetIndex = OnsetDetectorHPC.detectBatchOnset(powers, 5);
     const startTime = parseFloat(allMetrics[onsetIndex]?.time) || 0;

     return { 
         maxVel, timeMaxVel, 
         maxHgt, timeMaxHgt, 
         maxPwr, timeMaxPwr, 
         maxForce, timeMaxForce, 
         maxAccel, timeMaxAccel, 
         totalWork, rfd,
         startTime
     };
  }, [allMetrics, barbellMass]);

  const calculateEfficiency = () => {
    if (allMetrics.length < 2) return 100;
    const xValues = allMetrics.map(m => m.x);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const deviation = maxX - minX;
    const score = Math.max(0, 100 - (deviation * 500)); 
    return score;
  };

  const efficiencyScore = calculateEfficiency();

  const handleReset = useCallback(() => {
    setAllMetrics([]);
    setCursorMetrics(null);
    cursorMetricsRef.current = null;
    const defaultStats = { time: '0', velocity: 0, height: 0, power: 0, x: 0, y: 0, kneeAngle: 0, hipAngle: 0, ankleAngle: 0, backAngle: 0 };
    setLiveMetrics(defaultStats);
    liveMetricsRef.current = defaultStats;
    
    // Also reset DOM if exist
    const elVel = document.getElementById('stat-velocity'); if (elVel) elVel.innerText = "0.00";
    const elPwr = document.getElementById('stat-power'); if (elPwr) elPwr.innerText = "0";
    const elHgt = document.getElementById('stat-height'); if (elHgt) elHgt.innerText = "0.00";
    const elKnee = document.getElementById('stat-knee'); if (elKnee) elKnee.innerText = "0";
    const elHip = document.getElementById('stat-hip'); if (elHip) elHip.innerText = "0";
    const elAnkle = document.getElementById('stat-ankle'); if (elAnkle) elAnkle.innerText = "0";
    const elBack = document.getElementById('stat-back'); if (elBack) elBack.innerText = "0";
    const elForce = document.getElementById('stat-force'); if (elForce) elForce.innerText = "--";
    
    setActiveTab('stats');
  }, []);

  // Unified File Handler
  const processFile = useCallback((file: File) => {
      setVideoFile(file);
      handleReset();
  }, [handleReset]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
       processFile(e.target.files[0]);
       e.target.value = ''; // Allow selecting the same file again to trigger reset
    }
  };

  const handleAnalysisStart = useCallback(() => {
    setIsAnalyzingVideo(true);
    handleReset();
  }, [handleReset]);

  const lastReactUpdateRef = useRef<number>(0);
  
  const handleMetricsUpdate = useCallback((newMetric: LiftMetrics, history: LiftMetrics[]) => {
    liveMetricsRef.current = newMetric;
    
    if (!cursorMetricsRef.current) {
        // We use imperative DOM updates instead of React state for 60fps telemetry so it doesn't drop paints
        const now = performance.now();
        if (now - lastReactUpdateRef.current > 100) {
           setLiveMetrics(newMetric); // Throttle React state generally in sync for transitions/Reference Line (10 FPS)
           lastReactUpdateRef.current = now;
        }
        
        const elVel = document.getElementById('stat-velocity'); if (elVel) elVel.innerText = newMetric.velocity.toFixed(2);
        const elPwr = document.getElementById('stat-power'); if (elPwr) elPwr.innerText = newMetric.power.toFixed(0);
        const elHgt = document.getElementById('stat-height'); if (elHgt) elHgt.innerText = newMetric.height.toFixed(2);
        
        const side = focusSideRef.current;
        const getSideValueHTML = (avg: number, l?: number, r?: number) => {
            if (side === 'L' && l !== undefined) return l.toFixed(0);
            if (side === 'R' && r !== undefined) return r.toFixed(0);
            if (side === 'all' && l !== undefined && r !== undefined) return `<span class="text-yellow-500 text-sm">L</span><span>${l.toFixed(0)}</span><span class="text-emerald-500 text-sm ml-1">R</span><span>${r.toFixed(0)}</span>`;
            return avg.toFixed(0);
        };

        const kneeHTML = getSideValueHTML(newMetric.kneeAngle, newMetric.lKneeAngle, newMetric.rKneeAngle);
        const hipHTML = getSideValueHTML(newMetric.hipAngle, newMetric.lHipAngle, newMetric.rHipAngle);
        const ankleHTML = getSideValueHTML(newMetric.ankleAngle || 0, newMetric.lAnkleAngle, newMetric.rAnkleAngle);

        const elKnee = document.getElementById('stat-knee'); if (elKnee) elKnee.innerHTML = kneeHTML;
        const elHip = document.getElementById('stat-hip'); if (elHip) elHip.innerHTML = hipHTML;
        const elAnkle = document.getElementById('stat-ankle'); if (elAnkle) elAnkle.innerHTML = ankleHTML;
        const elBack = document.getElementById('stat-back'); if (elBack) elBack.innerText = (newMetric.backAngle || 0).toFixed(0);
        
        const mass = barbellMassRef.current;
        const elForce = document.getElementById('stat-force'); 
        if (elForce) {
            const historyArr = allMetricsRef.current;
            if (historyArr.length > 1) {
                const prev = historyArr[historyArr.length - 1];
                const accel = (newMetric.velocity - prev.velocity) / 0.03;
                elForce.innerText = (mass * (9.81 + accel)).toFixed(0);
            } else {
                elForce.innerText = (mass * 9.81).toFixed(0);
            }
        }
    }
    
    // Only animate the chart dynamically if we are currently analyzing
    // Otherwise the chart has the full dataset from handleAnalysisComplete
    if (allMetricsRef.current.length !== history.length) {
        setAllMetrics(history);
    }
    
  }, []);

  const handleAnalysisComplete = useCallback(async (fullHistory: LiftMetrics[]) => {
    setIsAnalyzingVideo(false);
    setAllMetrics(fullHistory);
  }, []);

  const handleChartHover = useCallback((metric: LiftMetrics | null) => {
    cursorMetricsRef.current = metric;
    setCursorMetrics(metric);
  }, []);
  
  const handleSeek = useCallback((time: number) => {
      setSeekRequest({ time, nonce: Date.now() });
  }, []);

  // --- RESIZE LOGIC (INDUSTRIAL GRADE: ZERO REFLOW) ---
  const handleResizeStart = (type: 'right' | 'mobile' | 'chart', e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      setIsResizing(true);
      
      const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const startRight = layout.rightWidth;
      const startMobileH = layout.mobileVideoHeightPct;
      const startChartH = layout.chartHeightPct;
      const containerH = window.innerHeight;

      // Get root element to inject CSS Variables
      const root = document.documentElement;

      const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
          // Use requestAnimationFrame to throttle and ensure DOM writes happen once per frame
          requestAnimationFrame(() => {
              const currentX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
              const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;
              
              if (type === 'right') {
                  const delta = startX - currentX; // Right side logic inverted
                  const newWidth = Math.max(50, startRight + delta);
                  // [Performance] Bypass React, directly manipulate CSS variable
                  root.style.setProperty('--sidebar-right-width', `${newWidth}px`);
              } else if (type === 'mobile' || type === 'chart') {
                  const deltaY = currentY - startY;
                  const deltaPct = (deltaY / containerH) * 100;
                  const newPct = type === 'mobile' 
                      ? Math.max(20, Math.min(80, startMobileH + deltaPct))
                      : Math.max(20, Math.min(80, startChartH + deltaPct));
                  
                  const propName = type === 'mobile' ? '--mobile-video-height' : '--chart-height';
                  root.style.setProperty(propName, `${newPct}%`);
              }
          });
      };

      const handleUp = (upEvent: MouseEvent | TouchEvent) => {
          setIsResizing(false);
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('mouseup', handleUp);
          window.removeEventListener('touchmove', handleMove);
          window.removeEventListener('touchend', handleUp);

          // [State Sync] Write back to React State after drag ends to maintain consistency
          const getVal = (name: string) => parseFloat(root.style.getPropertyValue(name));
          setLayout(prev => ({
              ...prev,
              rightWidth: getVal('--sidebar-right-width') || prev.rightWidth,
              mobileVideoHeightPct: getVal('--mobile-video-height') || prev.mobileVideoHeightPct,
              chartHeightPct: getVal('--chart-height') || prev.chartHeightPct
          }));
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp);
  };

  return (
    <div className={`h-[100dvh] w-full flex flex-col bg-zinc-950 text-white font-sans overflow-hidden ${isResizing ? 'cursor-grabbing select-none' : ''}`}>
      {/* --- STARTUP INITIALIZATION OVERLAY --- */}
      {!isInitComplete && (
          <div className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center p-6">
             <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center">
                 <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl flex items-center justify-center text-black font-bold mb-6 shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2l-4 4-4-4"/><path d="M8.5 2C7.12 2 6 3.12 6 4.5V9h12V4.5C18 3.12 16.88 2 15.5 2"/></svg>
                 </div>
                 <h2 className="text-xl font-bold tracking-tight text-white mb-2">INITIALIZING PROLIFT AI</h2>
                 <p className="text-sm text-zinc-400 text-center mb-8">Loading core computer vision and analysis engines to ensure industrial-grade accuracy.</p>
                 
                 <div className="w-full space-y-4 mb-8">
                     {initLog.map((log, idx) => (
                         <div key={idx} className="flex flex-col bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                             <div className="flex items-center justify-between">
                                 <span className="text-xs font-mono font-bold text-zinc-300">{log.name}</span>
                                 <div className="flex items-center gap-2">
                                     {log.status === 'loading' && <div className="w-3.5 h-3.5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>}
                                     {log.status === 'ready' && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                     {log.status === 'error' && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
                                     <span className={`text-[10px] font-bold uppercase ${log.status === 'ready' ? 'text-green-500' : log.status === 'error' ? 'text-red-500' : 'text-yellow-500'}`}>{log.status}</span>
                                 </div>
                             </div>
                         </div>
                     ))}
                 </div>

                 {initFailed && (
                     <button 
                        onClick={() => window.location.reload()}
                        className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold tracking-wider text-sm shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-colors"
                     >
                         RELOAD / RE-SYNC ENGINES
                     </button>
                 )}
                 {!initFailed && (
                     <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono animate-pulse">
                         Please wait, analyzing environment...
                     </div>
                 )}
             </div>
          </div>
      )}

      {/* Mobile/Desktop Header */}
      <header className="h-16 lg:h-14 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur flex items-center justify-between px-4 shrink-0 sticky top-0 z-50 shadow-sm overflow-x-auto overflow-y-hidden scrollbar-hide">
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-8 w-8 bg-yellow-500 rounded-lg flex items-center justify-center text-black font-bold shadow-[0_0_15px_rgba(234,179,8,0.4)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2l-4 4-4-4"/><path d="M8.5 2C7.12 2 6 3.12 6 4.5V9h12V4.5C18 3.12 16.88 2 15.5 2"/></svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1">
                PROLIFT <span className="text-yellow-400">AI</span>
            </h1>
            <p className="text-[9px] text-zinc-500 font-medium tracking-wide">BIOMECHANICS SUITE</p>
          </div>
        </div>
        
        {/* DESKTOP INTEGRATED CONTROLS (Moved from Sidebar) */}
        <div className="hidden lg:flex items-center justify-center flex-1 mx-4 gap-4 sm:gap-6 shrink-0">
            {/* Barbell Mass */}
            <div className="flex items-center gap-2 bg-zinc-950/50 border border-zinc-800 hover:border-zinc-700 focus-within:border-yellow-500/50 focus-within:ring-1 focus-within:ring-yellow-500/20 rounded-md px-2.5 py-1.5 transition-all">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    Barbell Weight
                </span>
                <div className="flex items-baseline ml-2">
                    <input 
                        type="number"
                        min="0"
                        max="260"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={barbellMass}
                        onChange={(e) => setBarbellMass(Math.abs(parseInt(e.target.value)) || 0)}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => {
                            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                        }}
                        onKeyDown={(e) => {
                            if (['e', 'E', '+', '-'].includes(e.key)) {
                                e.preventDefault();
                            }
                            if (e.key === 'Enter') {
                                e.currentTarget.blur();
                            }
                        }}
                        className="bg-zinc-900 text-yellow-500 text-[16px] md:text-sm font-mono font-bold w-16 outline-none text-center placeholder:text-zinc-700 border border-zinc-700 hover:border-yellow-500 focus:border-yellow-500 hover:bg-zinc-800 focus:bg-zinc-800 cursor-text transition-all px-2 py-1 rounded shadow-inner"
                    />
                    <span className="text-[9px] text-zinc-500 font-bold ml-1.5">kg</span>
                </div>
            </div>

            {/* User Height */}
            <div className="flex items-center gap-2 bg-zinc-950/50 border border-zinc-800 hover:border-zinc-700 focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20 rounded-md px-2.5 py-1.5 transition-all">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M12 22V2"/><path d="M8 6h8"/><path d="M8 12h8"/><path d="M8 18h8"/></svg>
                    Height
                </span>
                <div className="flex items-baseline ml-2">
                    <input 
                        type="number"
                        min="0"
                        max="250"
                        placeholder="Auto"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={userHeightCm}
                        onChange={(e) => setUserHeightCm(e.target.value === '' ? '' : Math.abs(parseInt(e.target.value)))}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => {
                            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                        }}
                        onKeyDown={(e) => {
                            if (['e', 'E', '+', '-'].includes(e.key)) {
                                e.preventDefault();
                            }
                            if (e.key === 'Enter') {
                                e.currentTarget.blur();
                            }
                        }}
                        className="bg-zinc-900 text-blue-400 text-[16px] md:text-sm font-mono font-bold w-16 outline-none text-center placeholder:text-zinc-700 border border-zinc-700 hover:border-blue-400 focus:border-blue-400 hover:bg-zinc-800 focus:bg-zinc-800 cursor-text transition-all px-2 py-1 rounded shadow-inner"
                    />
                    <span className="text-[9px] text-zinc-500 font-bold ml-1.5">cm</span>
                </div>
            </div>

            {/* System Status Indicators */}
            <div className="flex items-center pl-4 border-l border-zinc-800">
                <div className="flex items-center gap-1.5" title="Computer Vision Core">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    <span className="text-[9px] text-zinc-400 font-semibold tracking-wide">Vision</span>
                </div>
            </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
           {/* Status Indicator */}
          <div className={`hidden sm:flex items-center gap-2 px-3 py-1 bg-zinc-800 rounded-full border border-zinc-700`}>
             <div className={`w-1.5 h-1.5 rounded-full ${isAnalyzingVideo ? 'bg-yellow-500 animate-bounce' : 'bg-emerald-500 animate-pulse'}`}></div>
             <span className="text-[10px] font-semibold text-zinc-300 tracking-wide">
               {isAnalyzingVideo ? 'PROCESSING...' : 'READY'}
             </span>
          </div>
          
          {/* File Input Trigger (Updated for Clarity) */}
          <label className={`flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 border border-blue-500 cursor-pointer transition-colors shadow-lg shadow-blue-500/20 ${isAnalyzingVideo ? 'opacity-50 pointer-events-none' : ''}`}>
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
             <span className="text-[10px] font-bold tracking-widest">UPLOAD</span>
             <input type="file" accept="video/mp4,video/quicktime,video/*" className="hidden" onChange={handleFileChange} disabled={isAnalyzingVideo} />
          </label>
        </div>
      </header>

      {/* Main Workspace - UX Optimized Resizable Layout */}
      {/* Replaced fixed Grid with Flex to support drag-resizing */}
      <div className="flex-1 flex flex-col lg:flex-row bg-black overflow-hidden relative min-h-0 min-w-0">
        

        {/* CENTER: VIEWPORT */}
        <main 
            className={`relative flex-none lg:flex-1 w-full bg-black flex items-center justify-center overflow-hidden border-b lg:border-b-0 border-zinc-800 scrollbar-hide min-w-0 min-h-0 touch-none ${isResizing ? 'pointer-events-none' : ''}`}
            style={{ 
                // Mobile: Dynamic Height | Desktop: Auto Fill
                height: window.innerWidth < 1024 ? `var(--mobile-video-height, ${layout.mobileVideoHeightPct}dvh)` : 'auto' 
            }}
        >
           <VideoAnalyzer 
             videoFile={videoFile} 
             onMetricsUpdate={handleMetricsUpdate}
             onAnalysisComplete={handleAnalysisComplete}
             onAnalysisStart={handleAnalysisStart}
             onReset={handleReset}
             barbellMass={barbellMass}
             userHeightMm={userHeightCm ? userHeightCm * 10 : null}
             seekRequest={seekRequest}
             onFileSelect={processFile}
             focusSide={focusSide}
           />
        </main>

        {/* RESIZER MOBILE (Horizontal between Video and Tabs) */}
        <div className="lg:hidden w-full z-20 bg-zinc-900 shrink-0">
            <Resizer orientation="horizontal" onResizeStart={(e) => handleResizeStart('mobile', e)} isResizing={isResizing} />
        </div>

        {/* MOBILE CONTROLS (Between Video and Tabs) */}
        <div className="lg:hidden px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex flex-col gap-3 shrink-0 touch-none">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Barbell Wgt</span>
                    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 shadow-inner">
                       <input 
                          type="number" min="0" max="260"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={barbellMass}
                          onChange={(e) => setBarbellMass(Math.abs(parseInt(e.target.value)) || 0)}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => {
                              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                          }}
                          onKeyDown={(e) => {
                              if (['e', 'E', '+', '-'].includes(e.key)) {
                                  e.preventDefault();
                              }
                              if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                              }
                          }}
                          className="w-16 bg-transparent text-yellow-500 text-[16px] md:text-sm text-center outline-none font-mono font-bold"
                       />
                       <span className="text-[9px] text-zinc-500 font-bold ml-1">kg</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Height</span>
                    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 shadow-inner">
                       <input 
                          type="number" min="0" max="250" placeholder="Auto"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={userHeightCm}
                          onChange={(e) => setUserHeightCm(e.target.value === '' ? '' : Math.abs(parseInt(e.target.value)))}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => {
                              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                          }}
                          onKeyDown={(e) => {
                              if (['e', 'E', '+', '-'].includes(e.key)) {
                                  e.preventDefault();
                              }
                              if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                              }
                          }}
                          className="w-16 bg-transparent text-blue-400 text-[16px] md:text-sm text-center outline-none font-mono font-bold placeholder:text-zinc-600"
                       />
                       <span className="text-[9px] text-zinc-500 font-bold ml-1">cm</span>
                    </div>
                </div>
            </div>
        </div>

        {/* MOBILE TABS */}
        <div className="lg:hidden flex bg-zinc-900 border-b border-zinc-800 sticky top-0 z-10 shrink-0 touch-none">
            <button 
                onClick={() => setActiveTab('chart')} 
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'chart' ? 'border-yellow-500 text-white bg-zinc-800' : 'border-transparent text-zinc-500'}`}
            >
                Charts
            </button>
            <button 
                onClick={() => setActiveTab('stats')} 
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'stats' ? 'border-yellow-500 text-white bg-zinc-800' : 'border-transparent text-zinc-500'}`}
            >
                Data
            </button>
        </div>

        {/* RESIZER RIGHT (Desktop) */}
        <div className="hidden lg:block h-full z-20">
            <Resizer orientation="vertical" onResizeStart={(e) => handleResizeStart('right', e)} isResizing={isResizing} />
        </div>

        {/* RIGHT SIDEBAR / MOBILE CONTENT AREA */}
        <aside 
            className={`flex-col lg:flex-none lg:h-full w-full bg-zinc-900 lg:border-l lg:border-zinc-800 overflow-hidden lg:relative shrink-0 ${activeTab ? 'flex flex-1' : 'hidden lg:flex'}`}
            style={window.innerWidth < 1024 ? {} : { width: `var(--sidebar-right-width, ${layout.rightWidth}px)` }}
        >
          
          {/* Chart Section */}
          <div 
            className={`flex-col min-h-[200px] lg:min-h-0 border-b border-zinc-800 touch-none ${activeTab === 'chart' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex lg:flex-none'} ${isResizing ? 'pointer-events-none' : ''}`}
            style={window.innerWidth < 1024 ? {} : { height: `var(--chart-height, ${layout.chartHeightPct}%)` }}
          >
             <div className="p-3 bg-zinc-800/30 border-b border-zinc-800 flex justify-between items-center">
                 <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                    Live Telemetry
                 </h3>
                 {cursorMetrics && (
                     <span className="text-[9px] font-bold bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full border border-yellow-500/20">
                         {cursorMetrics.time}s
                     </span>
                 )}
             </div>
             <div className="flex-1 relative bg-zinc-900/50 p-0 sm:p-2 min-h-0 flex flex-col">
                <LiftChart 
                    data={allMetrics.length > 0 ? allMetrics : []} 
                    currentTime={parseFloat(displayMetrics.time)}
                    barbellMass={barbellMass}
                    onCursorMove={handleChartHover}
                    onSeekToTime={handleSeek}
                />
             </div>
          </div>

          {/* HORIZONTAL RESIZER RIGHT PANEL (Desktop) */}
          <div className="hidden lg:block w-full z-20 relative">
             <div className="absolute w-full h-[1px] bg-zinc-800 top-0 left-0 pointer-events-none" />
             <Resizer orientation="horizontal" onResizeStart={(e) => handleResizeStart('chart', e)} isResizing={isResizing} />
          </div>

          {/* MOVED JUMP BUTTON */}
          <div className="px-4 pt-3 pb-2 bg-zinc-900 w-full z-10 border-b border-zinc-800/50">
             <div 
                  onClick={() => handleSeek(stats?.startTime || 0)} 
                  className="relative overflow-hidden bg-indigo-900/40 p-2.5 rounded-xl border border-indigo-500/30 flex items-center justify-center cursor-pointer hover:bg-indigo-800/60 hover:border-indigo-400/60 hover:shadow-[0_0_12px_rgba(99,102,241,0.25)] active:scale-95 transition-all duration-300 group"
              >
                  <div className="absolute inset-0 bg-indigo-400/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="flex items-center gap-2.5 z-10 w-full justify-center">
                      <div className="bg-indigo-500/20 p-1.5 rounded-lg group-hover:bg-indigo-500/40 transition-colors shadow-inner shadow-indigo-500/20">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400 group-hover:text-indigo-300 transition-colors">
                              <polygon points="19 20 9 12 19 4 19 20"/>
                              <line x1="5" y1="19" x2="5" y2="5"/>
                          </svg>
                      </div>
                      <div className="flex flex-col justify-center text-left">
                          <span className="text-[8px] text-indigo-300/70 group-hover:text-indigo-300/90 uppercase font-black tracking-[0.2em] transition-colors leading-[1.2]">Jump to</span>
                          <span className="text-[11px] text-indigo-100 uppercase font-bold tracking-widest transition-colors leading-[1.2]">Lift Start Time</span>
                      </div>
                  </div>
             </div>
          </div>

          {/* Stats Section */}
          <div className={`flex-col bg-zinc-900 overflow-y-auto overscroll-y-contain ${activeTab === 'stats' ? 'flex flex-1' : 'hidden lg:flex lg:flex-1'}`}>
            <div className="px-4 py-3 border-b border-zinc-800 flex justify-between items-center bg-zinc-900 sticky top-0 z-10">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    Performance Metrics
                </h3>
            </div>

            <div className="p-2 sm:p-4 space-y-6 pb-20 lg:pb-4">
                
                {/* A. Live Values - Show if Stats Tab active or Desktop */}
                <div className={`${activeTab === 'stats' ? 'block' : 'hidden lg:block'}`}>
                   <h4 className="text-[10px] text-zinc-600 font-bold mb-3 uppercase">Instantaneous</h4>
                   <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                       <StatBox id="stat-velocity" label="Velocity" valAvg={displayMetrics.velocity} unit="m/s" valColor="text-yellow-400" precision={2} />
                       <StatBox id="stat-power" label="Power" valAvg={displayMetrics.power} unit="W" valColor="text-red-400" precision={0} />
                       <StatBox id="stat-height" label="Height" valAvg={displayMetrics.height} unit="m" valColor="text-blue-400" precision={2} />
                       <StatBox id="stat-knee" label="Knee Ang" valAvg={displayMetrics.kneeAngle} valL={displayMetrics.lKneeAngle} valR={displayMetrics.rKneeAngle} unit="°" hasSides={true} focusSide={focusSide} onSideClick={setFocusSide} precision={0} />
                       <StatBox id="stat-hip" label="Hip Ang" valAvg={displayMetrics.hipAngle} valL={displayMetrics.lHipAngle} valR={displayMetrics.rHipAngle} unit="°" hasSides={true} focusSide={focusSide} onSideClick={setFocusSide} precision={0} />
                       <StatBox id="stat-ankle" label="Ankle Ang" valAvg={displayMetrics.ankleAngle || 0} valL={displayMetrics.lAnkleAngle} valR={displayMetrics.rAnkleAngle} unit="°" hasSides={true} focusSide={focusSide} onSideClick={setFocusSide} precision={0} />
                       <StatBox id="stat-back" label="Back Ang" valAvg={displayMetrics.backAngle || 0} unit="°" valColor="text-purple-400" precision={0} />
                       <StatBox 
                          id="stat-force"
                          label="Force (Est)" 
                          valAvg={allMetrics.length > 0 ? (cursorMetrics ? (barbellMass * (9.81 + (cursorMetrics.velocity - (allMetrics[allMetrics.indexOf(cursorMetrics)-1]?.velocity || 0))/0.03)) : (barbellMass * 9.81)) : null} 
                          unit="N" 
                          precision={0}
                       />
                   </div>
                </div>

                {/* B. Peak Stats - Show if Stats Tab active or Desktop */}
                {stats && (
                    <div className={`pt-4 border-t border-zinc-800 ${activeTab === 'stats' ? 'block' : 'hidden lg:block'}`}>
                       <h4 className="text-[10px] text-zinc-600 font-bold mb-3 uppercase flex items-center gap-1">
                          Session Peaks
                       </h4>
                       <div className="grid grid-cols-2 gap-3">
                           <div onClick={() => handleSeek(stats.timeMaxVel)} className="bg-zinc-800 p-3 rounded-xl border-l-4 border-yellow-500 cursor-pointer hover:bg-zinc-700 transition-colors">
                               <div className="flex flex-col">
                                  <span className="text-[9px] text-zinc-500 uppercase font-bold">Max Velocity</span>
                                  <span className="text-xl font-mono font-bold text-white mt-1">{stats.maxVel.toFixed(2)}<span className="text-xs text-zinc-600 ml-1">m/s</span></span>
                               </div>
                           </div>
                           <div onClick={() => handleSeek(stats.timeMaxPwr)} className="bg-zinc-800 p-3 rounded-xl border-l-4 border-red-500 cursor-pointer hover:bg-zinc-700 transition-colors">
                               <div className="flex flex-col">
                                  <span className="text-[9px] text-zinc-500 uppercase font-bold">Max Power</span>
                                  <span className="text-xl font-mono font-bold text-white mt-1">{stats.maxPwr.toFixed(0)}<span className="text-xs text-zinc-600 ml-1">W</span></span>
                               </div>
                           </div>
                           <div onClick={() => handleSeek(stats.timeMaxForce)} className="bg-zinc-800 p-3 rounded-xl border-l-4 border-blue-500 cursor-pointer hover:bg-zinc-700 transition-colors">
                               <div className="flex flex-col">
                                  <span className="text-[9px] text-zinc-500 uppercase font-bold">Peak Force</span>
                                  <span className="text-xl font-mono font-bold text-white mt-1">{stats.maxForce.toFixed(0)}<span className="text-xs text-zinc-600 ml-1">N</span></span>
                               </div>
                           </div>
                            <div onClick={() => handleSeek(stats.timeMaxAccel)} className="bg-zinc-800 p-3 rounded-xl border-l-4 border-emerald-500 cursor-pointer hover:bg-zinc-700 transition-colors">
                               <div className="flex flex-col">
                                  <span className="text-[9px] text-zinc-500 uppercase font-bold">Max Accel</span>
                                  <span className="text-xl font-mono font-bold text-white mt-1">{stats.maxAccel.toFixed(1)}<span className="text-xs text-zinc-600 ml-1">m/s²</span></span>
                               </div>
                           </div>
                       </div>
                       
                       <div className="mt-3 grid grid-cols-2 gap-3">
                            <div className="bg-zinc-800 p-3 rounded-xl border-l-4 border-purple-500">
                               <div className="flex flex-col">
                                  <span className="text-[9px] text-zinc-500 uppercase font-bold">Work Done</span>
                                  <span className="text-xl font-mono font-bold text-white mt-1">{stats.totalWork.toFixed(0)}<span className="text-xs text-zinc-600 ml-1">J</span></span>
                               </div>
                           </div>
                       </div>
                       
                       {/* Button has been moved to the top */}
                       
                       {/* Efficiency Bar */}
                       <div className="mt-4 bg-zinc-800/50 p-3 rounded-xl">
                           <div className="flex justify-between mb-2">
                               <span className="text-[10px] text-zinc-500 uppercase font-bold">Bar Path Efficiency</span>
                               <span className={`text-xs font-bold ${efficiencyScore > 85 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                   {efficiencyScore.toFixed(1)}/100
                                </span>
                            </div>
                            <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                                <div className={`h-full ${efficiencyScore > 85 ? 'bg-emerald-500' : 'bg-yellow-500'}`} style={{ width: `${efficiencyScore}%` }}></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
};

export default App;
