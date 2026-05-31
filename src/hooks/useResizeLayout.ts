import { useState, useCallback } from 'react';
import { RESIZE_DEFAULTS } from '../constants';

export const useResizeLayout = () => {
    const [layout, setLayout] = useState({
        rightWidth: RESIZE_DEFAULTS.RIGHT_WIDTH,
        mobileVideoHeightPct: RESIZE_DEFAULTS.MOBILE_VIDEO_HEIGHT_PCT,
        chartHeightPct: RESIZE_DEFAULTS.CHART_HEIGHT_PCT
    });
    const [isResizing, setIsResizing] = useState(false);

    const handleResizeStart = useCallback((type: 'right' | 'mobile' | 'chart', e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        setIsResizing(true);
        
        const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const startRight = layout.rightWidth;
        const startMobileH = layout.mobileVideoHeightPct;
        const startChartH = layout.chartHeightPct;
        const containerH = window.innerHeight;

        const root = document.documentElement;

        const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
            requestAnimationFrame(() => {
                const currentX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
                const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;
                
                if (type === 'right') {
                    const delta = startX - currentX;
                    const newWidth = Math.max(RESIZE_DEFAULTS.MIN_RIGHT_WIDTH, startRight + delta);
                    root.style.setProperty('--sidebar-right-width', `${newWidth}px`);
                } else if (type === 'mobile' || type === 'chart') {
                    const deltaY = currentY - startY;
                    const deltaPct = (deltaY / containerH) * 100;
                    const newPct = type === 'mobile' 
                        ? Math.max(RESIZE_DEFAULTS.MIN_PCT, Math.min(RESIZE_DEFAULTS.MAX_PCT, startMobileH + deltaPct))
                        : Math.max(RESIZE_DEFAULTS.MIN_PCT, Math.min(RESIZE_DEFAULTS.MAX_PCT, startChartH + deltaPct));
                    
                    const propName = type === 'mobile' ? '--mobile-video-height' : '--chart-height';
                    root.style.setProperty(propName, `${newPct}%`);
                }
            });
        };

        const handleUp = () => {
            setIsResizing(false);
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleUp);

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
    }, [layout]);

    return {
        layout,
        isResizing,
        handleResizeStart
    };
};
