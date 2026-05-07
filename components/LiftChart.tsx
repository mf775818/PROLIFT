
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

  // --- DIMENSION GUARD (INDUSTRIAL GRADE FOR IOS SAFARI) ---
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    const observeTarget = chartContainerRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });
    
    resizeObserver.observe(observeTarget);
    return () => resizeObserver.disconnect();
  }, []);

  const handleExportCSV = () => {
    if (!processedData || processedData.length === 0) return;

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
    const csvContent = [
        ...headerRows.map(e => e.join(',')),
        columns.join(','),
        ...dataRows.map(e => e.join(','))
    ].join('\n');

    // 6. Trigger Download using Blob (Industrial Robustness)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `prolift_export_${Date.now()}.csv`);
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
  
  const dragStartRef = useRef<{ x: number, y: number, min: number, max: number, moved: boolean } | null>(null);
  
  const handleMouseDown = (e: React.MouseEvent) => {
      const currentZoom = zoomDomain || { min: processedData[0].timeVal, max: processedData[processedData.length - 1].timeVal };
      dragStartRef.current = { 
          x: e.clientX, 
          y: e.clientY,
          min: currentZoom.min, 
          max: currentZoom.max,
          moved: false
      };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!dragStartRef.current || !zoomDomain || !chartContainerRef.current) return;
      
      const dx = e.clientX - dragStartRef.current.x;
      if (Math.abs(dx) > 5) dragStartRef.current.moved = true;

      const width = chartContainerRef.current.clientWidth;
      const domainRange = zoomDomain.max - zoomDomain.min;
      
      const shift = -(dx / width) * domainRange;
      
      let newMin = dragStartRef.current.min + shift;
      let newMax = dragStartRef.current.max + shift;
      
      const dataMin = processedData[0].timeVal;
      const dataMax = processedData[processedData.length - 1].timeVal;

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
      
      setZoomDomain({ min: newMin, max: newMax });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
      if (dragStartRef.current && !dragStartRef.current.moved && onSeekToTime) {
          if (hoveredMetricRef.current) {
               onSeekToTime(hoveredMetricRef.current.timeVal);
          } else if (chartContainerRef.current && processedData.length > 0) {
               const rect = chartContainerRef.current.getBoundingClientRect();
               const x = e.clientX - rect.left;
               const marginLeft = 30; // Left YAxis
               const marginRight = mode === 'kinematics' || mode === 'kinetics' ? 30 : 10;
               const chartWidth = rect.width - marginLeft - marginRight;
               if (chartWidth > 0) {
                   let pct = (x - marginLeft) / chartWidth;
                   pct = Math.max(0, Math.min(1, pct));
                   const tMin = zoomDomain ? zoomDomain.min : processedData[0].timeVal;
                   const tMax = zoomDomain ? zoomDomain.max : processedData[processedData.length - 1].timeVal;
                   onSeekToTime(tMin + pct * (tMax - tMin));
               }
          }
      }
      dragStartRef.current = null;
  };
  
  const handleDoubleClick = (e: React.MouseEvent) => {
      if (onSeekToTime && hoveredMetricRef.current) {
           onSeekToTime(hoveredMetricRef.current.timeVal);
      }
  };
  
  const handleTooltip = (props: any) => {
    if (props.active && props.payload && props.payload.length) {
      const metric = props.payload[0].payload as ProcessedLiftMetrics;
      hoveredMetricRef.current = metric;
      if (onCursorMove) onCursorMove(metric);
    } else {
      hoveredMetricRef.current = null;
      if (onCursorMove) onCursorMove(null);
    }
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
      <div className="flex justify-between items-center mb-2 px-2 shrink-0">
         <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
            {mode === 'kinematics' && 'Velocity & Height'}
            {mode === 'kinetics' && 'Force & Acceleration'}
            {mode === 'trajectory' && 'Bar Path Heatmap'}
            {mode === 'power' && 'Power Output'}
            {mode === 'angles' && 'Joint Angles (Hip/Knee/Ankle)'}
         </h3>
         <div className="flex bg-zinc-900 rounded p-1 border border-zinc-700 gap-1 z-10 items-center">
           <button 
             onClick={() => { setMode('kinematics'); setZoomDomain(null); }}
             className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'kinematics' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               KINEMATICS
           </button>
           <button 
             onClick={() => { setMode('kinetics'); setZoomDomain(null); }}
             className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'kinetics' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               KINETICS
           </button>
           <button 
             onClick={() => { setMode('power'); setZoomDomain(null); }}
             className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'power' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               POWER
           </button>
           <button 
             onClick={() => { setMode('angles'); setZoomDomain(null); }}
             className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'angles' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               ANGLES
           </button>
           <button 
             onClick={() => { setMode('trajectory'); setZoomDomain(null); }}
             className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${mode === 'trajectory' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
           >
               BAR PATH
           </button>
           
           {/* Separator */}
           <div className="w-px h-3 bg-zinc-700 mx-1"></div>

           {/* CSV EXPORT BUTTON */}
           <button 
             onClick={handleExportCSV}
             title="Export Session Data to CSV"
             className="p-1 px-2 flex items-center gap-1 bg-green-900/30 text-green-500 hover:bg-green-600 hover:text-white rounded transition-colors group"
           >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span className="text-[9px] font-bold hidden md:inline group-hover:inline">CSV</span>
           </button>
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

      <div 
         ref={chartContainerRef}
         className={`flex-1 w-full min-h-0 relative ${zoomDomain ? 'cursor-ew-resize' : 'cursor-pointer'}`}
         onMouseLeave={() => { onCursorMove && onCursorMove(null); handleMouseUp({ clientX: -999, clientY: -999 } as any); }}
         onWheel={handleWheel}
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
         onDoubleClick={handleDoubleClick}
      >
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          {mode === 'kinematics' ? (
            <ComposedChart data={processedData} onMouseMove={handleTooltip} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
            <ComposedChart data={processedData} onMouseMove={handleTooltip} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
             <AreaChart data={processedData} onMouseMove={handleTooltip} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
             <LineChart data={processedData} onMouseMove={handleTooltip} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
          ) : (
            // TRAJECTORY CHART
            <ScatterChart 
                margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                onMouseMove={handleTooltip}
            >
               <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
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
          )}
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
