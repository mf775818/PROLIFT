
import React, { useState, useCallback, useEffect } from 'react';
import { VideoAnalyzer } from './components/VideoAnalyzer';
import { useEngineInit } from './hooks/useEngineInit';
import { useResizeLayout } from './hooks/useResizeLayout';
import { useLiftMetrics } from './hooks/useLiftMetrics';
import { InitOverlay } from './components/layout/InitOverlay';
import { AppHeader } from './components/layout/AppHeader';
import { Sidebar } from './components/layout/Sidebar';
import { Resizer } from './components/layout/Resizer';
import { forceAppRemount } from './main';
import { PHYSICS_DEFAULTS } from './constants';

const App = () => {
    const { initLog, isInitComplete, initFailed } = useEngineInit();
    const { layout, isResizing, handleResizeStart } = useResizeLayout();

    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [preloadedUrl, setPreloadedUrl] = useState<string | undefined>(undefined);
    const [barbellMass, setBarbellMass] = useState(PHYSICS_DEFAULTS.BARBELL_MASS);
    const [userHeightCm, setUserHeightCm] = useState<number | ''>('');
    const [activeTab, setActiveTab] = useState<'chart' | 'stats'>('stats');
    const [seekRequest, setSeekRequest] = useState<{time: number, nonce: number} | null>(null);

    const {
        allMetrics, displayMetrics, cursorMetrics, isAnalyzingVideo, stats,
        handleReset, handleMetricsUpdate, handleAnalysisComplete,
        handleAnalysisStart, handleChartHover, setFocusSide, focusSideRef
    } = useLiftMetrics(barbellMass);

    useEffect(() => {
        const handleCopy = (e: ClipboardEvent) => e.preventDefault();
        const handleContextMenu = (e: MouseEvent) => {
            const isInput = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA';
            if (!isInput && window.matchMedia('(pointer: coarse)').matches) e.preventDefault();
        };
        window.addEventListener('copy', handleCopy);
        window.addEventListener('contextmenu', handleContextMenu);
        return () => {
            window.removeEventListener('copy', handleCopy);
            window.removeEventListener('contextmenu', handleContextMenu);
        };
    }, []);

    const processFile = useCallback((file: File) => {
        const newUrl = URL.createObjectURL(file);
        setPreloadedUrl(prev => { if (prev) URL.revokeObjectURL(prev); return newUrl; });
        handleReset();
        setVideoFile(file);
    }, [handleReset]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
            e.target.value = ''; 
        }
    };

    const handleSeek = useCallback((time: number) => {
        setSeekRequest({ time, nonce: Date.now() });
    }, []);

    const isDesktop = window.innerWidth >= 1024;

    return (
        <div className={`h-[100dvh] w-full flex flex-col bg-zinc-950 text-white font-sans overflow-hidden ${isResizing ? 'cursor-grabbing select-none' : ''}`}>
            {!isInitComplete && <InitOverlay initLog={initLog} initFailed={initFailed} onForceRestart={forceAppRemount} />}
            
            <AppHeader 
                barbellMass={barbellMass} setBarbellMass={setBarbellMass}
                userHeightCm={userHeightCm} setUserHeightCm={setUserHeightCm}
                isAnalyzingVideo={isAnalyzingVideo} onFileChange={handleFileChange}
            />

            <div className="flex-1 flex flex-col lg:flex-row bg-black overflow-hidden relative min-h-0 min-w-0">
                
                <main 
                    className={`relative flex-none lg:flex-1 w-full bg-black flex items-center justify-center overflow-hidden border-b lg:border-b-0 border-zinc-800 scrollbar-hide min-w-0 min-h-0 touch-none ${isResizing ? 'pointer-events-none' : ''}`}
                    style={isDesktop ? { height: 'auto' } : { height: `var(--mobile-video-height, ${layout.mobileVideoHeightPct}dvh)` }}
                >
                    <VideoAnalyzer 
                        videoFile={videoFile} preloadedUrl={preloadedUrl}
                        onMetricsUpdate={handleMetricsUpdate} onAnalysisComplete={handleAnalysisComplete}
                        onAnalysisStart={handleAnalysisStart} onReset={handleReset}
                        barbellMass={barbellMass} userHeightMm={userHeightCm ? (userHeightCm as number) * 10 : null}
                        seekRequest={seekRequest} onFileSelect={processFile} focusSide={focusSideRef.current}
                    />
                </main>

                <div className="lg:hidden w-full z-20 bg-zinc-900 shrink-0">
                    <Resizer orientation="horizontal" onResizeStart={(e) => handleResizeStart('mobile', e)} isResizing={isResizing} />
                </div>

                <div className="lg:hidden flex bg-zinc-900 border-b border-zinc-800 sticky top-0 z-10 shrink-0 touch-none">
                    <button onClick={() => setActiveTab('chart')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'chart' ? 'border-yellow-500 text-white bg-zinc-800' : 'border-transparent text-zinc-500'}`}>Charts</button>
                    <button onClick={() => setActiveTab('stats')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'stats' ? 'border-yellow-500 text-white bg-zinc-800' : 'border-transparent text-zinc-500'}`}>Data</button>
                </div>

                <div className="hidden lg:block h-full z-20">
                    <Resizer orientation="vertical" onResizeStart={(e) => handleResizeStart('right', e)} isResizing={isResizing} />
                </div>

                <Sidebar 
                    activeTab={activeTab} layout={layout} isResizing={isResizing}
                    allMetrics={allMetrics} displayMetrics={displayMetrics}
                    cursorMetrics={cursorMetrics} barbellMass={barbellMass}
                    focusSide={focusSideRef.current} setFocusSide={setFocusSide as any} stats={stats}
                    handleChartHover={handleChartHover} handleSeek={handleSeek}
                    handleResizeStart={handleResizeStart}
                />
            </div>
        </div>
    );
};

export default App;
