import React from 'react';
import { UI_MESSAGES } from '../../constants';

interface AppHeaderProps {
    barbellMass: number;
    setBarbellMass: (val: number) => void;
    userHeightCm: number | '';
    setUserHeightCm: (val: number | '') => void;
    isAnalyzingVideo: boolean;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ barbellMass, setBarbellMass, userHeightCm, setUserHeightCm, isAnalyzingVideo, onFileChange }) => {
    return (
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
            
            <div className="hidden lg:flex items-center justify-center flex-1 mx-4 gap-4 sm:gap-6 shrink-0">
                {/* Barbell Mass */}
                <div className="flex items-center gap-2 bg-zinc-950/50 border border-zinc-800 hover:border-zinc-700 focus-within:border-yellow-500/50 focus-within:ring-1 focus-within:ring-yellow-500/20 rounded-md px-2.5 py-1.5 transition-all">
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        Barbell Weight
                    </span>
                    <div className="flex items-baseline ml-2">
                        <input 
                            type="number" min="0" max="260" inputMode="numeric" pattern="[0-9]*"
                            value={barbellMass}
                            onChange={(e) => setBarbellMass(Math.abs(parseInt(e.target.value)) || 0)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
                            onKeyDown={(e) => {
                                if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                                if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="bg-zinc-900 text-yellow-500 text-[16px] md:text-sm font-mono font-bold w-[69px] outline-none text-center placeholder:text-zinc-700 border border-zinc-700 hover:border-yellow-500 focus:border-yellow-500 hover:bg-zinc-800 focus:bg-zinc-800 cursor-text transition-all px-2 py-1 rounded shadow-inner"
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
                            type="number" min="0" max="250" placeholder="Auto" inputMode="numeric" pattern="[0-9]*"
                            value={userHeightCm}
                            onChange={(e) => setUserHeightCm(e.target.value === '' ? '' : Math.abs(parseInt(e.target.value)))}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
                            onKeyDown={(e) => {
                                if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                                if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="bg-zinc-900 text-blue-400 text-[16px] md:text-sm font-mono font-bold w-[69px] outline-none text-center placeholder:text-zinc-700 border border-zinc-700 hover:border-blue-400 focus:border-blue-400 hover:bg-zinc-800 focus:bg-zinc-800 cursor-text transition-all px-2 py-1 rounded shadow-inner"
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
                <div className={`hidden sm:flex items-center gap-2 px-3 py-1 bg-zinc-800 rounded-full border border-zinc-700`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isAnalyzingVideo ? 'bg-yellow-500 animate-bounce' : 'bg-emerald-500 animate-pulse'}`}></div>
                    <span className="text-[10px] font-semibold text-zinc-300 tracking-wide">
                        {isAnalyzingVideo ? UI_MESSAGES.STATUS_PROCESSING : UI_MESSAGES.STATUS_READY}
                    </span>
                </div>
                
                <label className={`flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 border border-blue-500 cursor-pointer transition-colors shadow-lg shadow-blue-500/20 ${isAnalyzingVideo ? 'opacity-50 pointer-events-none' : ''}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span className="text-[10px] font-bold tracking-widest">UPLOAD</span>
                    <input type="file" accept="video/mp4,video/quicktime,video/*" className="hidden" onChange={onFileChange} disabled={isAnalyzingVideo} />
                </label>
            </div>
        </header>
    );
};
