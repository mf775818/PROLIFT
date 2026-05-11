
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoAnalyzer } from './components/VideoAnalyzer';
import { LiftChart } from './components/LiftChart';
import { LiftMetrics } from './types';

// --- UX COMPONENT: RESIZER HANDLE ---
const Resizer = ({ orientation, onResizeStart, isResizing }: { orientation: 'vertical' | 'horizontal', onResizeStart: (e: React.MouseEvent | React.TouchEvent) => void, isResizing: boolean }) => {
    return (
        <div 
            className={`group relative z-50 flex items-center justify-center transition-colors touch-none
                ${orientation === 'vertical' 
                    ? 'w-3 hover:w-3 cursor-col-resize -ml-1.5 -mr-1.5 h-full' 
                    : 'h-6 w-full cursor-row-resize -mt-3 -mb-3'
                }`}
            onMouseDown={onResizeStart}
            onTouchStart={onResizeStart}
        >
            {/* Hit Area & Visual Line */}
            <div className={`transition-all duration-300 bg-zinc-800 group-hover:bg-yellow-500/50 
                ${orientation === 'vertical' 
                    ? `w-[1px] h-full ${isResizing ? 'bg-yellow-500 w-[2px]' : ''}` 
                    : `h-[1px] w-full ${isResizing ? 'bg-yellow-500 h-[2px]' : ''}`
                }`} 
            />
            
            {/* Affordance Handle (Pill) */}
            <div className={`absolute bg-zinc-700 group-hover:bg-yellow-500 rounded-full flex items-center justify-center gap-0.5 shadow-lg border border-zinc-900 transition-colors
                ${orientation === 'vertical' 
                    ? 'w-1 h-8 left-1/2 -translate-x-1/2' 
                    : 'h-1 w-12 top-1/2 -translate-y-1/2'
                }`}
            >
            </div>
        </div>
    );
};

// Helper component for stat box
const StatBox = ({ id, label, value, unit, subColor = "text-zinc-600", valColor = "text-white" }: any) => (
    <div className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50 flex flex-col justify-between hover:bg-zinc-800 transition-colors">
        <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</span>
        <div className="flex items-baseline gap-1 mt-1">
            <span id={id} className={`text-xl font-mono font-bold ${valColor}`}>{value}</span>
            <span className={`text-[10px] font-bold ${subColor}`}>{unit}</span>
        </div>
    </div>
);

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
      rightWidth: 380,
      mobileVideoHeightPct: 45, // 45% height by default on mobile
      chartHeightPct: 55 // 55% height by default on desktop
  });
  const [isResizing, setIsResizing] = useState(false);

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

     return { 
         maxVel, timeMaxVel, 
         maxHgt, timeMaxHgt, 
         maxPwr, timeMaxPwr, 
         maxForce, timeMaxForce, 
         maxAccel, timeMaxAccel, 
         totalWork, rfd 
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
        const elKnee = document.getElementById('stat-knee'); if (elKnee) elKnee.innerText = newMetric.kneeAngle.toFixed(0);
        const elHip = document.getElementById('stat-hip'); if (elHip) elHip.innerText = newMetric.hipAngle.toFixed(0);
        const elAnkle = document.getElementById('stat-ankle'); if (elAnkle) elAnkle.innerText = newMetric.ankleAngle.toFixed(0);
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
          if (moveEvent.cancelable) {
              moveEvent.preventDefault();
          }
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
                        min="20"
                        max="260"
                        inputMode="decimal"
                        pattern="[0-9]*"
                        value={barbellMass}
                        onChange={(e) => setBarbellMass(Math.max(0, parseInt(e.target.value) || 0))}
                        onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onFocus={(e) => e.target.select()}
                        className="bg-zinc-900 text-yellow-500 text-sm font-mono font-bold w-16 outline-none text-center placeholder:text-zinc-700 border border-zinc-700 hover:border-yellow-500 focus:border-yellow-500 hover:bg-zinc-800 focus:bg-zinc-800 cursor-text transition-all px-2 py-1 rounded shadow-inner"
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
                        min="100"
                        max="250"
                        placeholder="Auto"
                        inputMode="decimal"
                        pattern="[0-9]*"
                        value={userHeightCm}
                        onChange={(e) => setUserHeightCm(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)))}
                        onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onFocus={(e) => e.target.select()}
                        className="bg-zinc-900 text-blue-400 text-sm font-mono font-bold w-16 outline-none text-center placeholder:text-zinc-700 border border-zinc-700 hover:border-blue-400 focus:border-blue-400 hover:bg-zinc-800 focus:bg-zinc-800 cursor-text transition-all px-2 py-1 rounded shadow-inner"
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
      <div className="flex-1 flex flex-col lg:flex-row bg-black overflow-y-auto overscroll-contain relative min-h-0 min-w-0">
        
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
           />
        </main>

        {/* RESIZER MOBILE (Horizontal between Video and Tabs) */}
        <div className="lg:hidden w-full z-20 bg-zinc-900 shrink-0">
            <Resizer orientation="horizontal" onResizeStart={(e) => handleResizeStart('mobile', e)} isResizing={isResizing} />
        </div>

        {/* MOBILE CONTROLS (Between Video and Tabs) */}
        <div className="lg:hidden px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Barbell Wgt</span>
                    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 shadow-inner">
                       <input 
                          type="number" min="20" max="260"
                          inputMode="decimal" pattern="[0-9]*"
                          value={barbellMass}
                          onChange={(e) => setBarbellMass(Math.max(0, parseInt(e.target.value) || 0))}
                          onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                          onFocus={(e) => e.target.select()}
                          className="w-16 bg-transparent text-yellow-500 text-xs text-center outline-none font-mono font-bold"
                       />
                       <span className="text-[9px] text-zinc-500 font-bold ml-1">kg</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Height</span>
                    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 shadow-inner">
                       <input 
                          type="number" min="100" max="250" placeholder="Auto"
                          inputMode="decimal" pattern="[0-9]*"
                          value={userHeightCm}
                          onChange={(e) => setUserHeightCm(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)))}
                          onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                          onFocus={(e) => e.target.select()}
                          className="w-16 bg-transparent text-blue-400 text-xs text-center outline-none font-mono font-bold placeholder:text-zinc-600"
                       />
                       <span className="text-[9px] text-zinc-500 font-bold ml-1">cm</span>
                    </div>
                </div>
            </div>
        </div>

        {/* MOBILE TABS */}
        <div className="lg:hidden flex bg-zinc-900 border-b border-zinc-800 sticky top-0 z-10 shrink-0">
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
            className={`flex-col min-h-[200px] lg:min-h-0 border-b border-zinc-800 overscroll-contain ${activeTab === 'chart' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex lg:flex-none'} ${isResizing ? 'pointer-events-none' : ''}`}
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

          {/* Stats Section */}
          <div className={`flex-col bg-zinc-900 overflow-y-auto overscroll-contain ${activeTab === 'stats' ? 'flex flex-1' : 'hidden lg:flex lg:flex-1'}`}>
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
                       <StatBox id="stat-velocity" label="Velocity" value={displayMetrics.velocity.toFixed(2)} unit="m/s" valColor="text-yellow-400" />
                       <StatBox id="stat-power" label="Power" value={displayMetrics.power.toFixed(0)} unit="W" valColor="text-red-400"/>
                       <StatBox id="stat-height" label="Height" value={displayMetrics.height.toFixed(2)} unit="m" valColor="text-blue-400"/>
                       <StatBox id="stat-knee" label="Knee Ang" value={displayMetrics.kneeAngle.toFixed(0)} unit="°" />
                       <StatBox id="stat-hip" label="Hip Ang" value={displayMetrics.hipAngle.toFixed(0)} unit="°" />
                       <StatBox id="stat-ankle" label="Ankle Ang" value={displayMetrics.ankleAngle.toFixed(0)} unit="°" />
                       <StatBox id="stat-back" label="Back Ang" value={(displayMetrics.backAngle || 0).toFixed(0)} unit="°" valColor="text-purple-400" />
                       <StatBox 
                          id="stat-force"
                          label="Force (Est)" 
                          value={allMetrics.length > 0 ? (cursorMetrics ? (barbellMass * (9.81 + (cursorMetrics.velocity - (allMetrics[allMetrics.indexOf(cursorMetrics)-1]?.velocity || 0))/0.03)).toFixed(0) : (barbellMass * 9.81).toFixed(0)) : "--"} 
                          unit="N" 
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

// --- MOUNTING LOGIC (INDUSTRIAL GRADE) ---
const init = () => {
  const container = document.getElementById('root');
  if (container) {
      const root = createRoot(container);
      root.render(<App />);
  } else {
      console.error("Critical Error: #root element not found in DOM.");
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
