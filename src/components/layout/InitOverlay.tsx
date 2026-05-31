import React from 'react';
import { InitLogItem } from '../../hooks/useEngineInit';
import { UI_MESSAGES } from '../../constants';

interface InitOverlayProps {
    initLog: InitLogItem[];
    initFailed: boolean;
    onForceRestart: () => void;
}

export const InitOverlay: React.FC<InitOverlayProps> = ({ initLog, initFailed, onForceRestart }) => {
    return (
        <div className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center p-6">
            <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center">
                <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl flex items-center justify-center text-black font-bold mb-6 shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2l-4 4-4-4"/><path d="M8.5 2C7.12 2 6 3.12 6 4.5V9h12V4.5C18 3.12 16.88 2 15.5 2"/></svg>
                </div>
                <h2 className="text-xl font-bold tracking-tight text-white mb-2">{UI_MESSAGES.INIT_LOADING}</h2>
                <p className="text-sm text-zinc-400 text-center mb-8">{UI_MESSAGES.INIT_SUBTEXT}</p>
                
                <div className="w-full space-y-4 mb-4">
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

                <button 
                    onClick={onForceRestart}
                    className={`w-full py-3 mb-4 rounded-lg font-bold tracking-wider text-[11px] uppercase transition-colors flex justify-center items-center gap-2 ${initFailed ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 hover:border-zinc-500'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    {initFailed ? UI_MESSAGES.INIT_RELOAD_CRITICAL : UI_MESSAGES.INIT_RESTART}
                </button>

                {!initFailed && (
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono animate-pulse">
                        {UI_MESSAGES.INIT_WAITING}
                    </div>
                )}
            </div>
        </div>
    );
};
