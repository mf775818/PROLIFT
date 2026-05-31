import React from 'react';

interface StatBoxProps {
    id: string;
    label: string;
    valAvg?: number | null;
    valL?: number;
    valR?: number;
    unit: string;
    subColor?: string;
    valColor?: string;
    hasSides?: boolean;
    focusSide?: 'avg' | 'L' | 'R' | 'all';
    onSideClick?: (side: 'avg' | 'L' | 'R' | 'all') => void;
    precision?: number;
}

export const StatBox = ({ id, label, valAvg, valL, valR, unit, subColor = "text-zinc-600", valColor = "text-white", hasSides, focusSide, onSideClick, precision = 0 }: StatBoxProps) => {
    return (
    <div className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50 flex flex-col justify-between hover:bg-zinc-800 transition-colors">
        <div className="flex flex-col xl:flex-row justify-between items-start mb-2 gap-2 xl:gap-0">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</span>
            {hasSides && onSideClick && (
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
