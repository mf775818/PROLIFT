import React, { useState } from 'react';
import { LiftChart } from '../LiftChart';
import { Resizer } from './Resizer';
import { StatBox } from './StatBox';
import { LiftMetrics } from '../../types';

interface SidebarProps {
    activeTab: 'chart' | 'stats';
    layout: any;
    isResizing: boolean;
    allMetrics: LiftMetrics[];
    displayMetrics: LiftMetrics;
    cursorMetrics: LiftMetrics | null;
    barbellMass: number;
    focusSide: 'avg' | 'L' | 'R';
    setFocusSide: (side: 'avg' | 'L' | 'R') => void;
    stats: any;
    handleChartHover: (metric: LiftMetrics | null) => void;
    handleSeek: (time: number) => void;
    handleResizeStart: (type: 'chart', e: React.MouseEvent | React.TouchEvent) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    activeTab, layout, isResizing, allMetrics, displayMetrics, cursorMetrics,
    barbellMass, focusSide, setFocusSide, stats, handleChartHover, handleSeek, handleResizeStart
}) => {
    const isDesktop = window.innerWidth >= 1024;
    return (
        <aside 
            className={`flex-col lg:flex-none lg:h-full w-full bg-zinc-900 lg:border-l lg:border-zinc-800 overflow-hidden lg:relative shrink-0 ${activeTab ? 'flex flex-1' : 'hidden lg:flex'}`}
            style={isDesktop ? { width: `var(--sidebar-right-width, ${layout.rightWidth}px)` } : {}}
        >
            {/* Chart Section */}
            <div 
                className={`flex-col min-h-[200px] lg:min-h-0 border-b border-zinc-800 touch-none ${activeTab === 'chart' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex lg:flex-none'} ${isResizing ? 'pointer-events-none' : ''}`}
                style={isDesktop ? { height: `var(--chart-height, ${layout.chartHeightPct}%)` } : {}}
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
                    <div className={`${activeTab === 'stats' ? 'block' : 'hidden lg:block'}`}>
                        <h4 className="text-[10px] text-zinc-600 font-bold mb-3 uppercase">Instantaneous</h4>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                            <StatBox id="stat-velocity" label="Velocity" valAvg={displayMetrics.velocity} unit="m/s" valColor="text-yellow-400" precision={2} />
                            <StatBox id="stat-power" label="Power" valAvg={displayMetrics.power} unit="W" valColor="text-red-400" precision={0} />
                            <StatBox id="stat-height" label="Height" valAvg={displayMetrics.height} unit="m" valColor="text-blue-400" precision={2} />
                            <StatBox id="stat-knee" label="Knee Ang" valAvg={displayMetrics.kneeAngle} valL={displayMetrics.lKneeAngle} valR={displayMetrics.rKneeAngle} unit="°" hasSides={true} focusSide={focusSide} onSideClick={setFocusSide as any} precision={0} />
                            <StatBox id="stat-hip" label="Hip Ang" valAvg={displayMetrics.hipAngle} valL={displayMetrics.lHipAngle} valR={displayMetrics.rHipAngle} unit="°" hasSides={true} focusSide={focusSide} onSideClick={setFocusSide as any} precision={0} />
                            <StatBox id="stat-ankle" label="Ankle Ang" valAvg={displayMetrics.ankleAngle || 0} valL={displayMetrics.lAnkleAngle} valR={displayMetrics.rAnkleAngle} unit="°" hasSides={true} focusSide={focusSide} onSideClick={setFocusSide as any} precision={0} />
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
                            
                            <div className="mt-4 bg-zinc-800/50 p-3 rounded-xl">
                                <div className="flex justify-between mb-2">
                                    <span className="text-[10px] text-zinc-500 uppercase font-bold">Bar Path Efficiency</span>
                                    <span className={`text-xs font-bold ${stats.efficiencyScore > 85 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                        {stats.efficiencyScore.toFixed(1)}/100
                                    </span>
                                </div>
                                <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                                    <div className={`h-full ${stats.efficiencyScore > 85 ? 'bg-emerald-500' : 'bg-yellow-500'}`} style={{ width: `${stats.efficiencyScore}%` }}></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};
