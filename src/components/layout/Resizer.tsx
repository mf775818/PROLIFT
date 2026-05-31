import React from 'react';

export const Resizer = ({ orientation, onResizeStart, isResizing }: { orientation: 'vertical' | 'horizontal', onResizeStart: (e: React.MouseEvent | React.TouchEvent) => void, isResizing: boolean }) => {
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
            
            {/* Affordance Handle (Grip Dots) */}
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
