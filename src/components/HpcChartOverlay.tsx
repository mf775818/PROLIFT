import React, { useRef, useEffect } from 'react';

interface HpcChartOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  currentTime: number;
  startTimeVal: number;
  zoomDomain: { min: number; max: number } | null;
  processedData: any[];
  isVisible: boolean;
  // Left and right margins are fallback parameters, 
  // but now the algorithm dynamically samples actual geometries.
  leftMargin?: number;
  rightMargin?: number;
}

export const HpcChartOverlay: React.FC<HpcChartOverlayProps> = ({
  containerRef,
  currentTime,
  startTimeVal,
  zoomDomain,
  processedData,
  isVisible,
  leftMargin = 30,
  rightMargin = 35
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  
  // Real-time cached geometrical boundaries extracted via observers
  const geometryRef = useRef({
    gridLeft: 0,
    gridWidth: 0,
    isValid: false
  });

  // State cache to avoid React closure traps in RAF loop
  const stateRef = useRef({
    currentTime, startTimeVal, zoomDomain, processedData, leftMargin, rightMargin
  });

  useEffect(() => {
    stateRef.current = { currentTime, startTimeVal, zoomDomain, processedData, leftMargin, rightMargin };
  }, [currentTime, startTimeVal, zoomDomain, processedData, leftMargin, rightMargin]);

  // Precise geometry sampling combining ResizeObserver & MutationObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sampleGeometry = () => {
      const containerRect = container.getBoundingClientRect();
      
      // 1. 動態尋找精確的 X 軸網格或底線，這是最準確的資料範圍邊界
      const xAxisLine = container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line');
      const gridBox = container.querySelector('.recharts-cartesian-grid');
      const exactBoundaryEl = xAxisLine || gridBox;

      if (exactBoundaryEl) {
         const exactRect = exactBoundaryEl.getBoundingClientRect();
         // The exact start and end of the drawn chart data mapping
         const wLeftAxis = exactRect.left - containerRect.left;
         const wEffective = exactRect.width;

         geometryRef.current = {
            gridLeft: wLeftAxis,
            gridWidth: wEffective,
            isValid: true
         };
      } else {
         // Fallback directly to state margins
         const state = stateRef.current;
         const wLeftAxis = state.leftMargin || 30;
         const wRightVariance = state.rightMargin || 35;
         const W_container_rect = containerRect.width;
         
         geometryRef.current = {
            gridLeft: wLeftAxis,
            gridWidth: W_container_rect - wLeftAxis - wRightVariance,
            isValid: true
         };
      }
    };

    let debounceTimer: number | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect; // Excludes border/scrollbar usually, but getBoundingClientRect is exact
      const dpr = window.devicePixelRatio || 1;
      
      if (canvasRef.current && containerRef.current) {
         // Lock back-buffer to exact physical pixels
         const exactRect = containerRef.current.getBoundingClientRect();
         canvasRef.current.width = Math.round(exactRect.width * dpr);
         canvasRef.current.height = Math.round(exactRect.height * dpr);
      }
      
      sampleGeometry();
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(sampleGeometry, 30);
    });

    const mutationObserver = new MutationObserver(() => {
       if (debounceTimer) window.clearTimeout(debounceTimer);
       debounceTimer = window.setTimeout(sampleGeometry, 30);
    });

    resizeObserver.observe(container);
    mutationObserver.observe(container, { childList: true, subtree: true });

    // Initial manual sample
    setTimeout(sampleGeometry, 0);

    return () => {
       resizeObserver.disconnect();
       mutationObserver.disconnect();
       if (debounceTimer) window.clearTimeout(debounceTimer);
    };
  }, [containerRef]);

  // HDPI Rendering Loop
  useEffect(() => {
    if (!isVisible) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const renderLoop = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const dpr = window.devicePixelRatio || 1;
      const state = stateRef.current;
      
      if (!state.processedData || state.processedData.length === 0) {
          rafRef.current = requestAnimationFrame(renderLoop);
          return;
      }

      const rect = canvas.getBoundingClientRect();
      const cssWidth = rect.width;
      const cssHeight = rect.height;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      // Apply transformation matrix for HDPI coordinate mapping
      ctx.scale(dpr, dpr);
      
      const domain = state.zoomDomain || {
        min: state.processedData[0]?.timeVal || 0,
        max: state.processedData[state.processedData.length - 1]?.timeVal || 1
      };
      
      let currentVideoTime = state.currentTime;
      const video = document.getElementById('main-video-player') as HTMLVideoElement;
      if (video && !video.paused) {
        currentVideoTime = video.currentTime;
      }

      // Linear interpolation factor (\Delta t)
      const relativeTime = currentVideoTime - state.startTimeVal;
      const domainDiff = domain.max - domain.min;
      
      // Calculate alpha progress
      let alpha = domainDiff > 0 ? (relativeTime - domain.min) / domainDiff : 0;
      
      // Fallback variables in case observers haven't picked up Recharts elements yet
      const fallbackGridLeft = state.leftMargin;
      const fallbackGridWidth = Math.max(1, cssWidth - state.leftMargin - state.rightMargin);
      
      const gridLeft = geometryRef.current.isValid ? geometryRef.current.gridLeft : fallbackGridLeft;
      const gridWidth = geometryRef.current.isValid ? geometryRef.current.gridWidth : fallbackGridWidth;
      
      // Data Space -> Pixel Space interpolation
      // Sub-pixel snapping using Math.round(val) to land directly on the grid
      const exactX = gridLeft + (alpha * gridWidth);
      const pxX = Math.round(exactX); 

      // 1. Draw elapsed progress background
      if (alpha > 0) {
        ctx.fillStyle = 'rgba(156, 163, 175, 0.15)'; 
        // Snap width to avoid blurry sub-pixel edge
        // Limit the shaded area to the right edge of the grid
        const shadeWidth = Math.min(pxX - Math.round(gridLeft), Math.round(gridWidth));
        if (shadeWidth > 0) {
            ctx.fillRect(Math.round(gridLeft), 0, shadeWidth, cssHeight);
        }
      }
      
      // 2. High-precision dashed indicator line
      // ONLY draw if it's strictly within the current zoomed bounding box
      if (alpha >= 0.0 && alpha <= 1.0) {
        const timeNow = performance.now();
        const dashHeight = 8;
        const gapHeight = 4;
      
        ctx.strokeStyle = 'rgba(156, 163, 175, 0.8)';
        ctx.lineWidth = 2; 
        ctx.setLineDash([dashHeight, gapHeight]);
        ctx.lineDashOffset = -((timeNow / 50) % (dashHeight + gapHeight));
        
        ctx.beginPath();
        // Snapping coordinates down to nearest half-pixel guarantees sharp rendering on odd-pixel widths
        const drawX = pxX + (ctx.lineWidth % 2 === 1 ? 0.5 : 0);
        ctx.moveTo(drawX, 0);
        ctx.lineTo(drawX, cssHeight);
        ctx.stroke();
        
        // 3. Playhead Marker Head
        ctx.fillStyle = 'rgba(250, 204, 21, 0.9)'; 
        ctx.beginPath();
        ctx.moveTo(drawX, 0);
        ctx.lineTo(drawX - 6, 0);
        ctx.lineTo(drawX - 6, 12);
        ctx.lineTo(drawX + 6, 12);
        ctx.lineTo(drawX + 6, 0);
        ctx.closePath();
        ctx.fill();
        
        // 4. Time Signature Tracking
        ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(relativeTime.toFixed(2) + 's', drawX, 24);
      }
      
      ctx.restore();
      
      rafRef.current = requestAnimationFrame(renderLoop);
    };

    rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isVisible]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-50"
      style={{ 
        transform: 'translateZ(0)',
        willChange: 'transform',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.2s ease',
        width: '100%', 
        height: '100%' 
      }}
    />
  );
};

