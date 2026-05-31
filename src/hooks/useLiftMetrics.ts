import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { LiftMetrics } from '../types';
import { OnsetDetectorHPC } from '../lib/hpc/OnsetDetectorHPC';
import { PHYSICS_DEFAULTS, TIME_CONSTANTS } from '../constants';

export const useLiftMetrics = (barbellMass: number) => {
    const defaultMetrics: LiftMetrics = { time: '0', velocity: 0, height: 0, power: 0, x: 0, y: 0, kneeAngle: 0, hipAngle: 0, ankleAngle: 0, backAngle: 0 };
    const [liveMetrics, setLiveMetrics] = useState<LiftMetrics>(defaultMetrics);
    const liveMetricsRef = useRef<LiftMetrics>(defaultMetrics);
    
    const [cursorMetrics, setCursorMetrics] = useState<LiftMetrics | null>(null);
    const cursorMetricsRef = useRef<LiftMetrics | null>(null);
    
    const [allMetrics, setAllMetrics] = useState<LiftMetrics[]>([]);
    const allMetricsRef = useRef<LiftMetrics[]>([]);
    useEffect(() => { allMetricsRef.current = allMetrics; }, [allMetrics]);
    
    const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false);
    
    // Performance reference to throttle react updates
    const lastReactUpdateRef = useRef<number>(0);
    const focusSideRef = useRef<'avg' | 'L' | 'R'>('avg');

    const handleReset = useCallback(() => {
        setAllMetrics([]);
        setCursorMetrics(null);
        cursorMetricsRef.current = null;
        setLiveMetrics(defaultMetrics);
        liveMetricsRef.current = defaultMetrics;

        // Reset DOM metrics directly
        const resetDom = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.innerText = text; };
        resetDom('stat-velocity', "0.00");
        resetDom('stat-power', "0");
        resetDom('stat-height', "0.00");
        resetDom('stat-knee', "0");
        resetDom('stat-hip', "0");
        resetDom('stat-ankle', "0");
        resetDom('stat-back', "0");
        resetDom('stat-force', "--");
    }, [defaultMetrics]);

    const handleMetricsUpdate = useCallback((newMetric: LiftMetrics, history: LiftMetrics[]) => {
        liveMetricsRef.current = newMetric;
        
        if (!cursorMetricsRef.current) {
            const now = performance.now();
            if (now - lastReactUpdateRef.current > TIME_CONSTANTS.METRICS_THROTTLE_MS) {
               setLiveMetrics(newMetric); 
               lastReactUpdateRef.current = now;
            }
            
            // DOM manipulation for performance
            const updateDom = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.innerText = text; };
            updateDom('stat-velocity', newMetric.velocity.toFixed(2));
            updateDom('stat-power', newMetric.power.toFixed(0));
            updateDom('stat-height', newMetric.height.toFixed(2));
            updateDom('stat-back', (newMetric.backAngle || 0).toFixed(0));
            
            const side = focusSideRef.current;
            const getSideValueHTML = (avg: number, l?: number, r?: number) => {
                if (side === 'L' && l !== undefined) return l.toFixed(0);
                if (side === 'R' && r !== undefined) return r.toFixed(0);
                if (side === 'all' && l !== undefined && r !== undefined) return `<span class="text-yellow-500 text-sm">L</span><span>${l.toFixed(0)}</span><span class="text-emerald-500 text-sm ml-1">R</span><span>${r.toFixed(0)}</span>`;
                return avg.toFixed(0);
            };

            const htmlDom = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
            htmlDom('stat-knee', getSideValueHTML(newMetric.kneeAngle, newMetric.lKneeAngle, newMetric.rKneeAngle));
            htmlDom('stat-hip', getSideValueHTML(newMetric.hipAngle, newMetric.lHipAngle, newMetric.rHipAngle));
            htmlDom('stat-ankle', getSideValueHTML(newMetric.ankleAngle || 0, newMetric.lAnkleAngle, newMetric.rAnkleAngle));
            
            const elForce = document.getElementById('stat-force'); 
            if (elForce) {
                const historyArr = allMetricsRef.current;
                if (historyArr.length > 1) {
                    const prev = historyArr[historyArr.length - 1];
                    const accel = (newMetric.velocity - prev.velocity) / 0.03;
                    elForce.innerText = (barbellMass * (PHYSICS_DEFAULTS.GRAVITY + accel)).toFixed(0);
                } else {
                    elForce.innerText = (barbellMass * PHYSICS_DEFAULTS.GRAVITY).toFixed(0);
                }
            }
        }
        
        if (allMetricsRef.current.length !== history.length) {
            setAllMetrics(history);
        }
    }, [barbellMass]);

    const handleAnalysisComplete = useCallback(async (fullHistory: LiftMetrics[]) => {
        setIsAnalyzingVideo(false);
        setAllMetrics(fullHistory);
    }, []);

    const handleAnalysisStart = useCallback(() => {
        setIsAnalyzingVideo(true);
        handleReset();
    }, [handleReset]);

    const handleChartHover = useCallback((metric: LiftMetrics | null) => {
        cursorMetricsRef.current = metric;
        setCursorMetrics(metric);
    }, []);

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
        
        let maxForce = 0; let timeMaxForce = 0;
        let maxAccel = 0; let timeMaxAccel = 0;
        let totalWork = 0; 

        for(let i=1; i<allMetrics.length; i++) {
           const curr = allMetrics[i];
           const prev = allMetrics[i-1];
           const dt = parseFloat(curr.time) - parseFloat(prev.time);
           
           if (dt > 0.001) {
               const accel = (curr.velocity - prev.velocity) / dt;
               const force = barbellMass * (accel + PHYSICS_DEFAULTS.GRAVITY);
               
               if (force > maxForce) { maxForce = force; timeMaxForce = parseFloat(curr.time); }
               if (accel > maxAccel) { maxAccel = accel; timeMaxAccel = parseFloat(curr.time); }

               const dy = Math.abs(curr.height - prev.height);
               totalWork += force * dy;
           }
        }

        const rfd = maxForce / 0.25; 
        
        const powers = allMetrics.map(d => d.power);
        const onsetIndex = OnsetDetectorHPC.detectBatchOnset(powers, 5);
        const startTime = parseFloat(allMetrics[onsetIndex]?.time) || 0;

        const maxTotalHeight = Math.max(...allMetrics.map(m => m.height));
        const efficiencyScore = allMetrics.length < 2 ? 100 : Math.max(0, 100 - ((Math.max(...allMetrics.map(m => m.x)) - Math.min(...allMetrics.map(m => m.x))) * 500));

        return { 
            maxVel, timeMaxVel, 
            maxHgt, timeMaxHgt, 
            maxPwr, timeMaxPwr, 
            maxForce, timeMaxForce, 
            maxAccel, timeMaxAccel, 
            totalWork, rfd,
            startTime,
            efficiencyScore
        };
    }, [allMetrics, barbellMass]);

    const displayMetrics = cursorMetrics || liveMetrics;

    const setFocusSide = useCallback((side: 'avg' | 'L' | 'R') => {
        focusSideRef.current = side;
    }, []);

    return {
        allMetrics,
        liveMetrics,
        cursorMetrics,
        displayMetrics,
        isAnalyzingVideo,
        stats,
        handleReset,
        handleMetricsUpdate,
        handleAnalysisComplete,
        handleAnalysisStart,
        handleChartHover,
        setFocusSide,
        focusSideRef
    };
};
