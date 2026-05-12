
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
  ComposedChart,
  ReferenceDot,
  ScatterChart,
  Scatter,
  ZAxis,
  Legend
} from 'recharts';
import { LiftMetrics } from '../types';

interface LiftChartProps {
  data: LiftMetrics[];
  currentTime: number; // Synced video time
  barbellMass: number;
  onCursorMove?: (metric: LiftMetrics | null) => void;
  onSeekToTime?: (time: number) => void;
}

interface ProcessedLiftMetrics extends LiftMetrics {
  timeVal: number;
  xDev: number;
  yHgt: number;
  acceleration: number;
  force: number;
}

type ChartMode = 'kinematics' | 'kinetics' | 'trajectory' | 'power' | 'angles';

export const LiftChart: React.FC<LiftChartProps> = ({ data, currentTime, barbellMass, onCursorMove, onSeekToTime }) => {
  const [mode, setMode] = useState<ChartMode>('kinematics');
  
  // Intelligent mobile detection combining pointer type and user agent, averting issues from resized desktop windows.
  const isMobile = useMemo(() => {
     if (typeof window === 'undefined') return false;
     return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 
            /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  // Zoom State
  const [zoomDomain, setZoomDomain] = useState<{ min: number, max: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const hoveredMetricRef = useRef<ProcessedLiftMetrics | null>(null);

  const maxVel = useMemo(() => Math.max(...data.map(d => d.velocity), 0.1), [data]);

  // --- INDUSTRIAL GRADE ZERO LINE DETECTION (RETROGRADE POWER-ZERO CONVERGENCE) ---
  const startX = useMemo(() => {
    if (data.length < 5) return data[0]?.x || 0;

    // 1. GLOBAL PEAK IDENTIFICATION
    let maxPower = -1;
    let peakIndex = 0;
    
    for (let i = 0; i < data.length; i++) {
        if (data[i].power > maxPower) {
            maxPower = data[i].power;
            peakIndex = i;
        }
    }

    // Edge Case: If max power is negligible (no lift happened), fallback to start
    if (maxPower < 10) return data[0].x;

    // 2. RETROGRADE WALK TO ZERO POWER
    const POWER_NOISE_FLOOR = Math.max(15, maxPower * 0.005);
    let zeroIndex = 0;
    for (let i = peakIndex; i >= 0; i--) {
        const p = data[i].power;
        if (p <= POWER_NOISE_FLOOR) {
            zeroIndex = i;
            break; 
        }
    }
    return data[zeroIndex].x;
  }, [data]);

  // Derived Physics Data
  const processedData = useMemo<ProcessedLiftMetrics[]>(() => {
    return data.map((d, i) => {
      let acceleration = 0;
      let force = 0;
      if (i > 0) {
        const prev = data[i-1];
        const dt = parseFloat(d.time) - parseFloat(prev.time);
        if (dt > 0.001) {
           acceleration = (d.velocity - prev.velocity) / dt;
        }
      }
      force = barbellMass * (acceleration + 9.81);

      return {
        ...d,
        timeVal: parseFloat(d.time),
        xDev: (d.x - startX) * 200, // cm
        yHgt: d.height,
        acceleration: acceleration,
        force: Math.max(0, force)
      };
    });
  }, [data, startX, barbellMass]);

  // "Smart Dynamic" Domain Calculation
  const scatterXDomain = useMemo(() => {
      if (processedData.length === 0) return [-10, 10];
      const values = processedData.map(d => d.xDev);
      let min = Math.min(...values);
      let max = Math.max(...values);
      if (Math.abs(max - min) < 0.0001) {
          min -= 5;
          max += 5;
      } else {
          const padding = (max - min) * 0.15;
          min -= padding;
          max += padding;
      }
      return [min, max];
  }, [processedData]);

  // Initial Zoom Reset when data changes
  useEffect(() => {
      setZoomDomain(null);
  }, [data]);

  // --- 工業級：事件驅動與防抖重繪 (Event-Driven Debounced Resize) ---
  const [resizeTick, setResizeTick] = useState(0);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
      if (!chartContainerRef.current) return;

      // 訂閱瀏覽器原生尺寸變更事件 (非輪詢迴圈)
      const resizeObserver = new ResizeObserver(() => {
          // 只要事件還在連續觸發(例如使用者正在拖拉)，就取消上一次的重繪排程
          if (debounceTimerRef.current) {
              window.clearTimeout(debounceTimerRef.current);
          }
          
          // 只有當使用者「停止拖拉」超過 150 毫秒後，才派發唯一一次的更新信號
          debounceTimerRef.current = window.setTimeout(() => {
              setResizeTick(Date.now());
          }, 150);
      });

      resizeObserver.observe(chartContainerRef.current);

      return () => {
          resizeObserver.disconnect();
          if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      };
  }, []);

  const getExportData = () => {
    if (!processedData || processedData.length === 0) return null;

    // 1. Calculate Session Peaks for Header
    const maxVelocity = Math.max(...processedData.map(d => d.velocity));
    const maxPower = Math.max(...processedData.map(d => d.power));
    const maxForce = Math.max(...processedData.map(d => d.force));
    const maxHeight = Math.max(...processedData.map(d => d.height));

    // 2. Build Header Section (Metadata)
    const headerRows = [
        ['--- PROLIFT AI SESSION REPORT ---'],
        ['Date', new Date().toISOString().split('T')[0]],
        ['Time', new Date().toLocaleTimeString()],
        ['Barbell Mass (kg)', barbellMass],
        ['Zero Line X (Normalized)', startX.toFixed(6)],
        ['Session Max Velocity (m/s)', maxVelocity.toFixed(3)],
        ['Session Max Power (W)', maxPower.toFixed(0)],
        ['Session Max Force (N)', maxForce.toFixed(0)],
        ['Session Max Height (m)', maxHeight.toFixed(3)],
        [] // Empty row separator
    ];

    // 3. Build Data Columns
    const columns = [
        'Time (s)',
        'Velocity (m/s)',
        'Power (W)',
        'Force (N)',
        'Acceleration (m/s^2)',
        'Height (m)',
        'Bar Path Deviation (cm)',
        'Knee Angle (deg)',
        'Hip Angle (deg)',
        'Ankle Angle (deg)',
        'Back Angle (deg)',
        'Raw X (Norm)',
        'Raw Y (Norm)'
    ];

    // 4. Build Data Rows
    const dataRows = processedData.map(row => [
        row.timeVal.toFixed(3),
        row.velocity.toFixed(3),
        row.power.toFixed(0),
        row.force.toFixed(0),
        row.acceleration.toFixed(2),
        row.height.toFixed(3),
        row.xDev.toFixed(2), // The crucial Zero-Line adjusted metric
        row.kneeAngle.toFixed(1),
        row.hipAngle.toFixed(1),
        (row.ankleAngle || 0).toFixed(1),
        (row.backAngle || 0).toFixed(1),
        row.x.toFixed(6),
        row.y.toFixed(6)
    ]);

    // 5. Construct CSV String
    return [
        ...headerRows.map(e => e.join(',')),
        columns.join(','),
        ...dataRows.map(e => e.join(','))
    ].join('\n');
  };

  const handleExportData = async (format: 'csv' | 'copy') => {
    const content = getExportData();
    if (!content) return;

    if (format === 'copy') {
        try {
            await navigator.clipboard.writeText(content);
            alert("Data copied to clipboard successfully!");
        } catch (err) {
            console.error('Failed to copy', err);
            // Fallback for secure contexts or legacy browsers
            try {
                const textArea = document.createElement("textarea");
                textArea.value = content;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert("Data copied to clipboard successfully!");
            } catch (e) {
                alert("Failed to copy. Please check your browser permissions.");
            }
        }
        return;
    }

    const mimeType = 'text/csv;charset=utf-8;';
    const blob = new Blob([content], { type: mimeType });
    const fileName = `prolift_export_${Date.now()}.csv`;

    if (isMobile && navigator.share) {
        // Use text/plain to force OS share sheets to handle the content as an attachable file
        // rather than dropping unrecognized text/csv mime types or just sharing the title.
        const file = new File([blob], fileName, { type: 'text/plain' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                // Not including `title` or `text` prevents share sheets from accidentally pasting text instead of the file
                await navigator.share({
                    files: [file]
                });
                return;
            } catch (err) {
                console.log('Share error or cancelled', err);
                if (err && (err as Error).name === 'AbortError') {
                    return; // User cancelled
                }
            }
        }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- ZOOM & PAN LOGIC ---
  const handleWheel = (e: React.WheelEvent) => {
      if (mode === 'trajectory' || processedData.length === 0) return;
      
      const currentMin = zoomDomain ? zoomDomain.min : processedData[0].timeVal;
      const currentMax = zoomDomain ? zoomDomain.max : processedData[processedData.length - 1].timeVal;
      const duration = currentMax - currentMin;
      const fullDuration = processedData[processedData.length - 1].timeVal - processedData[0].timeVal;

      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      let newDuration = duration * zoomFactor;
      
      if (newDuration >= fullDuration * 0.99) {
          setZoomDomain(null);
          return;
      }

      if (newDuration < 0.5) newDuration = 0.5; // Min zoom 0.5s

      const center = (currentMin + currentMax) / 2;
      let newMin = center - newDuration / 2;
      let newMax = center + newDuration / 2;

      const dataMin = processedData[0].timeVal;
      const dataMax = processedData[processedData.length - 1].timeVal;
      
      if (newMin < dataMin) { newMin = dataMin; newMax = newMin + newDuration; }
      if (newMax > dataMax) { newMax = dataMax; newMin = newMax - newDuration; }

      setZoomDomain({ min: newMin, max: newMax });
  };
  
  // 【工業級修復 1】: 獨立的拖曳狀態記憶體，不受生命週期與渲染影響
  const hasDraggedRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ 
      x: number, 
      y: number, 
      min: number, 
      max: number, 
      moved: boolean,
      pinchDist?: number
  } | null>(null);

  const getPinchDistance = (touches: React.TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
  };

  const getPinchCenter = (touches: React.TouchList) => {
      if (touches.length < 2) return { x: touches[0].clientX, y: touches[0].clientY };
      return { 
          x: (touches[0].clientX + touches[1].clientX) / 2, 
          y: (touches[0].clientY + touches[1].clientY) / 2 
      };
  };

  const startAction = (coords: {x: number, y: number}, pinchDist?: number) => {
      const currentZoom = zoomDomain || { min: processedData[0].timeVal, max: processedData[processedData.length - 1].timeVal };
      dragStartRef.current = { 
          x: coords.x, 
          y: coords.y,
          min: currentZoom.min, 
          max: currentZoom.max,
          moved: false,
          pinchDist
      };
      hasDraggedRef.current = false; 
  };

  const handleTouchStart = (e: React.TouchEvent) => {
      if (mode === 'trajectory' || processedData.length === 0) return;
      if (e.touches.length === 1) {
          startAction({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      } else if (e.touches.length === 2) {
          startAction(getPinchCenter(e.touches), getPinchDistance(e.touches));
      }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      if (mode === 'trajectory' || processedData.length === 0) return;
      startAction({ x: e.clientX, y: e.clientY });
  };

  const handleMoveAction = (coords: {x: number, y: number}, pinchDist?: number) => {
      if (!dragStartRef.current || !chartContainerRef.current) return;
      
      const width = chartContainerRef.current.clientWidth;
      const dataMin = processedData[0].timeVal;
      const dataMax = processedData[processedData.length - 1].timeVal;
      let newMin = dragStartRef.current.min;
      let newMax = dragStartRef.current.max;

      if (pinchDist && dragStartRef.current.pinchDist) {
          const zoomFactor = dragStartRef.current.pinchDist / pinchDist;
          let currentZoomDomain = dragStartRef.current.max - dragStartRef.current.min;
          
          let newDuration = currentZoomDomain * zoomFactor;
          const fullDuration = dataMax - dataMin;
          if (newDuration >= fullDuration * 0.99) {
              setZoomDomain(null);
              return;
          }
          if (newDuration < 0.5) newDuration = 0.5;

          const rect = chartContainerRef.current.getBoundingClientRect();
          const picaX = coords.x - rect.left;
          const pct = Math.max(0, Math.min(1, picaX / width));
          const timeAtPinch = dragStartRef.current.min + currentZoomDomain * pct;

          newMin = timeAtPinch - newDuration * pct;
          newMax = timeAtPinch + newDuration * (1 - pct);
          
          hasDraggedRef.current = true;
          dragStartRef.current.min = newMin;
          dragStartRef.current.max = newMax;
          dragStartRef.current.pinchDist = pinchDist; 
      } else {
          const dx = coords.x - dragStartRef.current.x;
          if (Math.abs(dx) > 5) {
              dragStartRef.current.moved = true;
              hasDraggedRef.current = true; 
          }
          const domainRange = dragStartRef.current.max - dragStartRef.current.min;
          const shift = -(dx / width) * domainRange;
          newMin += shift;
          newMax += shift;
      }

      if (newMin < dataMin) {
           const diff = dataMin - newMin;
           newMin += diff;
           newMax += diff;
      }
      if (newMax > dataMax) {
          const diff = dataMax - newMax;
          newMin += diff;
          newMax += diff;
      }
      
      if (newMin < dataMin) newMin = dataMin;
      if (newMax > dataMax) newMax = dataMax;

      if (!zoomDomain || Math.abs(zoomDomain.min - newMin) > 0.001 || Math.abs(zoomDomain.max - newMax) > 0.001) {
          setZoomDomain({ min: newMin, max: newMax });
      }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 1) {
          handleMoveAction({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      } else if (e.touches.length === 2) {
          handleMoveAction(getPinchCenter(e.touches), getPinchDistance(e.touches));
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (e.buttons === 1) {
          handleMoveAction({ x: e.clientX, y: e.clientY });
      }
  };

  const handleEndAction = () => {
      dragStartRef.current = null;
  };

  const handleChartClick = (nextState: any) => {
      // 【工業級修復 4】: 透過獨立的 hasDraggedRef 攔截。
      // 即使 dragStartRef 已被清除，我們依然記得剛剛是不是在拖曳，完美解決競態條件。
      if (hasDraggedRef.current) return;

      if (onSeekToTime && nextState) {
          // 優先度 1：精準點擊在資料線上
          if (nextState.activePayload && nextState.activePayload.length > 0) {
              onSeekToTime(nextState.activePayload[0].payload.timeVal);
          } 
          // 優先度 2：點擊在圖表空白處 (軌跡圖除外，因其 X 軸不是時間)
          else if (mode !== 'trajectory' && nextState.activeLabel !== undefined) {
              onSeekToTime(Number(nextState.activeLabel));
          }
      }
  };
  
  const handleDoubleClick = (e: React.MouseEvent) => {
      if (onSeekToTime && hoveredMetricRef.current) {
           onSeekToTime(hoveredMetricRef.current.timeVal);
      }
  };
  
  // rAF for high-performance hover debounce (zero layout thrashing)
  const hoverRafRef = useRef<number | null>(null);

  useEffect(() => {
     return () => {
         if (hoverRafRef.current !== null) {
             cancelAnimationFrame(hoverRafRef.current);
         }
     };
  }, []);

  const handleTooltip = (props: any) => {
    if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
    }

    hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        if (props.active && props.payload && props.payload.length) {
            const metric = props.payload[0].payload as ProcessedLiftMetrics;
            hoveredMetricRef.current = metric;
            if (onCursorMove) onCursorMove(metric);
        } else {
            hoveredMetricRef.current = null;
            if (onCursorMove) onCursorMove(null);
        }
    });
  };
  
  const currentPoint = useMemo(() => {
      if (!processedData || processedData.length === 0) return null;
      return processedData.reduce((prev, curr) => 
        Math.abs(curr.timeVal - currentTime) < Math.abs(prev.timeVal - currentTime) ? curr : prev
      );
  }, [processedData, currentTime]);

  if (!data || data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-zinc-500 text-sm">
        Waiting for lift data...
      </div>
    );
  }

  // Common Axis Props
  const xAxisDomain = zoomDomain ? [zoomDomain.min, zoomDomain.max] : ['dataMin', 'dataMax'];

  return (
    <div className="w-full h-full flex flex-col overflow-hidden relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 px-2 shrink-0 gap-2 w-full overflow-hidden">
         <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest shrink-0 hidden sm:block">
            {mode === 'kinematics' && 'Velocity & Height'}
            {mode === 'kinetics' && 'Force & Acceleration'}
            {mode === 'trajectory' && 'Bar Path Heatmap'}
            {mode === 'power' && 'Power Output'}
            {mode === 'angles' && 'Joint Angles (Hip/Knee/Ankle)'}
         </h3>
         <div 
           className="flex bg-zinc-900 rounded p-1 border border-zinc-700 gap-1 z-10 items-center overflow-x-auto max-w-full [&::-webkit-scrollbar]:hidden" 
           style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
         >
           <button 
             onClick={() => { setMode('kinematics'); setZoomDomain(null); }}
             className={`shrink-0 px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'kinematics' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               KINEMATICS
           </button>
           <button 
             onClick={() => { setMode('kinetics'); setZoomDomain(null); }}
             className={`shrink-0 px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'kinetics' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               KINETICS
           </button>
           <button 
             onClick={() => { setMode('power'); setZoomDomain(null); }}
             className={`shrink-0 px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'power' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               POWER
           </button>
           <button 
             onClick={() => { setMode('angles'); setZoomDomain(null); }}
             className={`shrink-0 px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'angles' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               ANGLES
           </button>
           <button 
             onClick={() => { setMode('trajectory'); setZoomDomain(null); }}
             className={`shrink-0 px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'trajectory' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               BAR PATH
           </button>
           
           {/* Separator */}
           <div className="shrink-0 w-px h-3 bg-zinc-700 mx-1"></div>

           {/* EXPORT OPTIONS */}
           <div className="flex gap-1 shrink-0" id="export-options-group">
               {/* CSV Export/Share */}
               <button 
                 onClick={() => handleExportData('csv')}
                 title="Export / Share as CSV"
                 className="shrink-0 px-2 py-1 flex items-center gap-1 bg-green-900/30 text-green-500 hover:bg-green-600 hover:text-white rounded transition-colors group"
               >
                  {!isMobile ? (
                     <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  ) : (
                     <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  )}
                  <span className="text-[9px] font-bold">CSV</span>
               </button>

               {/* COPY Direct */}
               <button 
                 id="btn-export-copy"
                 onClick={() => handleExportData('copy')}
                 title="Copy Data to Clipboard"
                 className="shrink-0 px-2 py-1 flex items-center gap-1 bg-blue-900/30 text-blue-400 hover:bg-blue-600 hover:text-white rounded transition-colors group"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span className="text-[9px] font-bold">COPY</span>
               </button>
           </div>
         </div>
      </div>
      
      {/* Auto-Hide Reset Button */}
      {zoomDomain && mode !== 'trajectory' && (
          <button 
             onClick={() => setZoomDomain(null)}
             className="absolute top-8 right-4 z-20 bg-zinc-800 text-white text-[9px] px-2 py-1 rounded border border-zinc-600 hover:bg-zinc-700 shadow-lg"
          >
             RESET ZOOM
          </button>
      )}

      {/* 絕對不要在這裡加 key，保護所有的滑鼠交互事件 (onPointerDown 等) 不被銷毀 */}
      <div 
         ref={chartContainerRef}
         className={`flex-1 w-full min-h-0 relative ${zoomDomain ? 'cursor-ew-resize' : 'cursor-pointer'} touch-none`}
         onMouseLeave={() => { onCursorMove && onCursorMove(null); handleEndAction(); }}
         onWheel={handleWheel}
         onTouchStart={handleTouchStart}
         onTouchMove={handleTouchMove}
         onTouchEnd={handleEndAction}
         onTouchCancel={handleEndAction}
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMove}
         onMouseUp={handleEndAction}
         onDoubleClick={handleDoubleClick}
      >
          {/* 將 resizeTick 交給 ResponsiveContainer，只在拖曳結束後讓圖表引擎重新計算一次座標 */}
          <ResponsiveContainer key={`rc-engine-${resizeTick}`} width="100%" height="100%" minWidth={1} minHeight={1}>
          {mode === 'kinematics' ? (
            <ComposedChart data={processedData} onMouseMove={handleTooltip} onClick={handleChartClick} margin={{ top: 5, right: 35, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="timeVal" type="number" domain={xAxisDomain} allowDataOverflow={true} stroke="#52525b" fontSize={10} tickFormatter={(val) => val.toFixed(1)} />
              <YAxis yAxisId="left" stroke="#71717a" fontSize={10} width={30} />
              <YAxis yAxisId="right" orientation="right" stroke="#71717a" fontSize={10} width={30} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(24, 24, 27, 0.9)', border: '1px solid #3f3f46', backdropFilter: 'blur(4px)' }} 
                itemStyle={{ fontSize: '11px', fontWeight: 'bold' }} 
                labelStyle={{ color: '#a1a1aa', fontSize: '10px' }}
                cursor={{ stroke: '#facc15', strokeWidth: 1 }}
              />
              <ReferenceLine x={currentTime} stroke="white" strokeDasharray="3 3" opacity={0.5} />
              {currentPoint && (
                  <>
                    <ReferenceDot yAxisId="left" x={currentPoint.timeVal} y={currentPoint.velocity} r={4} fill="#facc15" stroke="white" strokeWidth={2} />
                    <ReferenceDot yAxisId="right" x={currentPoint.timeVal} y={currentPoint.height} r={4} fill="#3b82f6" stroke="white" strokeWidth={2} />
                  </>
              )}
              <Area yAxisId="left" type="monotone" dataKey="velocity" stroke="#facc15" fill="url(#velGradient)" fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="height" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <defs>
                <linearGradient id="velGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#facc15" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#facc15" stopOpacity={0}/>
                </linearGradient>
              </defs>
            </ComposedChart>
          ) : mode === 'kinetics' ? (
            <ComposedChart data={processedData} onMouseMove={handleTooltip} onClick={handleChartClick} margin={{ top: 5, right: 35, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="timeVal" type="number" domain={xAxisDomain} allowDataOverflow={true} stroke="#52525b" fontSize={10} />
              <YAxis yAxisId="left" stroke="#71717a" fontSize={10} width={40} label={{ value: 'N', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#52525b' }} />
              <YAxis yAxisId="right" orientation="right" stroke="#71717a" fontSize={10} width={30} label={{ value: 'm/s²', angle: 90, position: 'insideRight', fontSize: 9, fill: '#52525b' }} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(24, 24, 27, 0.9)', border: '1px solid #3f3f46' }} 
                itemStyle={{ fontSize: '11px' }} 
                cursor={{ stroke: '#facc15', strokeWidth: 1 }}
              />
              <ReferenceLine x={currentTime} stroke="white" strokeDasharray="3 3" opacity={0.5} />
              {currentPoint && (
                  <>
                    <ReferenceDot yAxisId="left" x={currentPoint.timeVal} y={currentPoint.force} r={4} fill="#ef4444" stroke="white" strokeWidth={2} />
                    <ReferenceDot yAxisId="right" x={currentPoint.timeVal} y={currentPoint.acceleration} r={4} fill="#10b981" stroke="white" strokeWidth={2} />
                  </>
              )}
              <Line yAxisId="left" type="monotone" dataKey="force" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="acceleration" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
            </ComposedChart>
          ) : mode === 'power' ? (
             <AreaChart data={processedData} onMouseMove={handleTooltip} onClick={handleChartClick} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="timeVal" type="number" domain={xAxisDomain} allowDataOverflow={true} stroke="#52525b" fontSize={10} />
              <YAxis stroke="#71717a" fontSize={10} width={40} />
              <Tooltip 
                 contentStyle={{ backgroundColor: 'rgba(24, 24, 27, 0.9)', border: '1px solid #3f3f46' }} 
                 itemStyle={{ fontSize: '11px' }} 
                 cursor={{ stroke: '#facc15', strokeWidth: 1 }}
              />
              <ReferenceLine x={currentTime} stroke="white" strokeDasharray="3 3" opacity={0.5} />
              {currentPoint && (
                 <ReferenceDot x={currentPoint.timeVal} y={currentPoint.power} r={4} fill="#ef4444" stroke="white" strokeWidth={2} />
              )}
              <Area type="monotone" dataKey="power" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          ) : mode === 'angles' ? (
             <LineChart data={processedData} onMouseMove={handleTooltip} onClick={handleChartClick} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="timeVal" type="number" domain={xAxisDomain} allowDataOverflow={true} stroke="#52525b" fontSize={10} />
              <YAxis stroke="#71717a" fontSize={10} width={40} domain={[0, 180]} />
              <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
              <Tooltip 
                 contentStyle={{ backgroundColor: 'rgba(24, 24, 27, 0.9)', border: '1px solid #3f3f46' }} 
                 itemStyle={{ fontSize: '11px' }} 
                 cursor={{ stroke: '#facc15', strokeWidth: 1 }}
              />
              <ReferenceLine x={currentTime} stroke="white" strokeDasharray="3 3" opacity={0.5} />
              {currentPoint && (
                <>
                  <ReferenceDot x={currentPoint.timeVal} y={currentPoint.hipAngle} r={3} fill="#3b82f6" stroke="none" />
                  <ReferenceDot x={currentPoint.timeVal} y={currentPoint.kneeAngle} r={3} fill="#facc15" stroke="none" />
                  <ReferenceDot x={currentPoint.timeVal} y={currentPoint.ankleAngle} r={3} fill="#10b981" stroke="none" />
                  <ReferenceDot x={currentPoint.timeVal} y={currentPoint.backAngle || 0} r={3} fill="#a78bfa" stroke="none" />
                </>
              )}
              <Line name="Hip" type="monotone" dataKey="hipAngle" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name="Knee" type="monotone" dataKey="kneeAngle" stroke="#facc15" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name="Ankle" type="monotone" dataKey="ankleAngle" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name="Back" type="monotone" dataKey="backAngle" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          ) : mode === 'trajectory' ? (
            <ScatterChart 
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                // 注意：軌跡圖內部不綁定滑鼠事件，全交給外層 div 處理
            >
               <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
               <XAxis 
                   type="number" 
                   dataKey="xDev" 
                   name="Deviation" 
                   unit="cm" 
                   domain={scatterXDomain}
                   stroke="#71717a" 
                   fontSize={10} 
                   tickCount={7}
                   tickFormatter={(val) => Number(val).toFixed(1)}
               />
               <YAxis 
                   type="number" 
                   dataKey="yHgt" 
                   name="Height" 
                   unit="m" 
                   domain={['auto', 'auto']} 
                   stroke="#71717a" 
                   fontSize={10} 
               />
               <ZAxis range={[60, 60]} /> 
               
               <Tooltip 
                 cursor={{ strokeDasharray: '3 3' }}
                 contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}
                 itemStyle={{ fontSize: '12px', color: '#fff' }}
               />
               
               <ReferenceLine x={0} stroke="#52525b" strokeWidth={1} />

               {currentPoint && (
                   <ReferenceDot 
                       x={currentPoint.xDev} 
                       y={currentPoint.yHgt} 
                       r={6} 
                       fill="#facc15" 
                       stroke="white" 
                       strokeWidth={2} 
                       isAnimationActive={false} // 確保不產生漂移殘影
                   />
               )}
               
               <Scatter 
                   name="Bar Path" 
                   data={processedData} 
                   line={{ stroke: '#3b82f6', strokeWidth: 3 }} 
                   shape={() => <g />} 
                   isAnimationActive={false}
               />
            </ScatterChart>
          ) : (
             // Fallback or other modes
             <div />
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
