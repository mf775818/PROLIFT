import React, { useRef, useEffect } from 'react';

export interface ActiveNode {
  xVal: number;
  yVal: number;
  color: string;
  yAxisOrientation: 'left' | 'right' | 'none';
}

interface HpcChartOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  currentTime: number;
  startTimeVal: number;
  zoomDomain: { min: number; max: number } | null;
  processedData: any[];
  isVisible: boolean;
  leftMargin?: number;
  rightMargin?: number;
  activeNodes?: ActiveNode[];
  isScatter?: boolean;
}

interface ScaleMapping {
  scaleX: (val: number) => number;
  scaleYLeft: (val: number) => number;
  scaleYRight: (val: number) => number;
  isValid: boolean;
}

export const HpcChartOverlay: React.FC<HpcChartOverlayProps> = ({
  containerRef,
  currentTime,
  startTimeVal,
  zoomDomain,
  processedData,
  isVisible,
  leftMargin = 30,
  rightMargin = 35,
  activeNodes = [],
  isScatter = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  
  // Real-time cached geometrical boundaries extracted via observers
  const geometryRef = useRef({
    gridLeft: 0,
    gridWidth: 0,
    gridTop: 0,
    gridHeight: 0,
    isValid: false
  });

  const scaleMappingRef = useRef<ScaleMapping>({
    scaleX: () => 0,
    scaleYLeft: () => 0,
    scaleYRight: () => 0,
    isValid: false
  });

  // State cache to avoid React closure traps in RAF loop
  const stateRef = useRef({
    currentTime, startTimeVal, zoomDomain, processedData, leftMargin, rightMargin, activeNodes, isScatter
  });

  useEffect(() => {
    stateRef.current = { currentTime, startTimeVal, zoomDomain, processedData, leftMargin, rightMargin, activeNodes, isScatter };
  }, [currentTime, startTimeVal, zoomDomain, processedData, leftMargin, rightMargin, activeNodes, isScatter]);

  // Precise geometry sampling combining ResizeObserver & MutationObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const extractScaleFromTicks = (selector: string, isX: boolean) => {
        const ticks = container.querySelectorAll(selector);
        if (ticks.length < 2) return null;
        
        let p1: {val: number, px: number} | null = null;
        let p2: {val: number, px: number} | null = null;
        
        ticks.forEach((tick, i) => {
            const textEl = tick.querySelector('text');
            if(!textEl) return;
            const val = parseFloat(textEl.textContent?.replace(/[^\d.-]/g, '') || '');
            if(isNaN(val)) return;
            
            // Recharts puts translation on a <g> tag inside or on the tick itself
            const transformEl = tick.hasAttribute('transform') ? tick : tick.querySelector('g[transform]');
            if(transformEl) {
                 const transform = transformEl.getAttribute('transform');
                 if (transform) {
                     const m = transform.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
                     if (m) {
                         const px = isX ? parseFloat(m[1]) : parseFloat(m[2]);
                         if (!p1) p1 = {val, px};
                         else p2 = {val, px}; 
                     }
                 }
            }
        });
        
        if (p1 && p2 && p1.val !== p2.val) {
            const m = (p2.px - p1.px) / (p2.val - p1.val);
            const b = p1.px - m * p1.val;
            return (val: number) => m * val + b;
        }
        return null;
    };

    const sampleGeometry = () => {
      const containerRect = container.getBoundingClientRect();
      
      const xAxisLine = container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line');
      const gridBox = container.querySelector('.recharts-cartesian-grid');
      
      let gridLeft = stateRef.current.leftMargin || 30;
      let gridTop = 10;
      let gridWidth = containerRect.width - gridLeft - (stateRef.current.rightMargin || 35);
      let gridHeight = containerRect.height - 40;
      let isValid = false;

      // Prefer Cartesian Grid for exact bounds, fallback to xAxisLine for width/left
      if (gridBox) {
          const rect = gridBox.getBoundingClientRect();
          gridLeft = rect.left - containerRect.left;
          gridTop = rect.top - containerRect.top;
          gridWidth = rect.width;
          gridHeight = rect.height;
          isValid = true;
      } else if (xAxisLine) {
          const rect = xAxisLine.getBoundingClientRect();
          gridLeft = rect.left - containerRect.left;
          gridWidth = rect.width;
          isValid = true;
      }

      if (isValid) {
         geometryRef.current = {
            gridLeft,
            gridTop,
            gridWidth,
            gridHeight,
            isValid: true
         };
         
         // 2. High-Precision Mathematical XY Mapping scale closure
         const scaleX = extractScaleFromTicks('.recharts-xAxis .recharts-cartesian-axis-tick', true);
         const scaleYLeft = extractScaleFromTicks('.recharts-yAxis[orientation="left"] .recharts-cartesian-axis-tick', false) 
                            || extractScaleFromTicks('.recharts-yAxis:not([orientation="right"]) .recharts-cartesian-axis-tick', false);
         const scaleYRight = extractScaleFromTicks('.recharts-yAxis[orientation="right"] .recharts-cartesian-axis-tick', false);
         
         // Pre-calculate fallback scales if DOM doesn't have ticks yet
         const fallbackScaleY = (yVal: number) => gridTop + geometryRef.current.gridHeight / 2; // Dead center fallback
         
         scaleMappingRef.current = {
             scaleX: scaleX || ((val: number) => gridLeft),
             scaleYLeft: scaleYLeft || fallbackScaleY,
             scaleYRight: scaleYRight || fallbackScaleY,
             isValid: !!scaleX
         };

      } else {
         // Fallback directly to state margins
         const state = stateRef.current;
         const wLeftAxis = state.leftMargin || 30;
         const wRightVariance = state.rightMargin || 35;
         const W_container_rect = containerRect.width;
         
         geometryRef.current = {
            gridLeft: wLeftAxis,
            gridTop: 10,
            gridWidth: W_container_rect - wLeftAxis - wRightVariance,
            gridHeight: containerRect.height - 40,
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
      const mappedGeom = geometryRef.current;
      const scales = scaleMappingRef.current;

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
      
      let currentVideoTime = state.currentTime;
      const video = document.getElementById('main-video-player') as HTMLVideoElement;
      if (video && !video.paused) {
        currentVideoTime = video.currentTime;
      }

      // Linear interpolation fallback (\Delta t)
      const domain = state.zoomDomain || {
        min: state.processedData[0]?.timeVal || 0,
        max: state.processedData[state.processedData.length - 1]?.timeVal || 1
      };
      
      const relativeTime = currentVideoTime - state.startTimeVal;
      const domainDiff = domain.max - domain.min;
      const alpha = domainDiff > 0 ? (relativeTime - domain.min) / domainDiff : 0;
      
      const fallbackGridLeft = state.leftMargin || 30;
      const fallbackGridWidth = Math.max(1, cssWidth - fallbackGridLeft - (state.rightMargin || 35));
      const gridLeft = mappedGeom.isValid ? mappedGeom.gridLeft : fallbackGridLeft;
      const gridWidth = mappedGeom.isValid ? mappedGeom.gridWidth : fallbackGridWidth;
      
      // Data Space -> Pixel Space X coordinates calculation
      let exactX = gridLeft + (alpha * gridWidth);
      if (scales.isValid && !state.isScatter) {
         // High-Precision override via direct Math function
         const testX = scales.scaleX(relativeTime);
         if (!isNaN(testX) && isFinite(testX)) {
             exactX = testX;
         }
      }

      const pxX = Math.round(exactX); 

      // 1. Draw elapsed progress background
      if (alpha > 0 && !state.isScatter) {
        ctx.fillStyle = 'rgba(156, 163, 175, 0.15)'; 
        const shadeWidth = Math.min(pxX - Math.round(gridLeft), Math.round(gridWidth));
        if (shadeWidth > 0 && pxX >= gridLeft) {
            ctx.fillRect(Math.round(gridLeft), mappedGeom.gridTop, shadeWidth, mappedGeom.gridHeight || cssHeight);
        }
      }
      
      // 2. High-precision dashed indicator line
      if (!state.isScatter && alpha >= 0.0 && alpha <= 1.0 && pxX >= gridLeft && pxX <= gridLeft + gridWidth) {
        const timeNow = performance.now();
        const dashHeight = 8;
        const gapHeight = 4;
      
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
        ctx.lineWidth = 1.5; 
        ctx.setLineDash([dashHeight, gapHeight]);
        ctx.lineDashOffset = -((timeNow / 50) % (dashHeight + gapHeight));
        
        ctx.beginPath();
        const drawX = pxX + 0.5;
        const startY = mappedGeom.isValid ? mappedGeom.gridTop : 0;
        const endY = mappedGeom.isValid ? mappedGeom.gridTop + mappedGeom.gridHeight : cssHeight;
        
        ctx.moveTo(drawX, startY);
        ctx.lineTo(drawX, endY);
        ctx.stroke();
        
        ctx.setLineDash([]);
        
        // Playhead Marker Head
        ctx.fillStyle = 'rgba(250, 204, 21, 0.9)'; 
        ctx.beginPath();
        ctx.moveTo(drawX, startY);
        ctx.lineTo(drawX - 6, startY);
        ctx.lineTo(drawX - 6, startY + 10);
        ctx.lineTo(drawX + 6, startY + 10);
        ctx.lineTo(drawX + 6, startY);
        ctx.closePath();
        ctx.fill();
        
        // Time Signature Tracking
        ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        // Base label underneath axes frame
        ctx.fillText(relativeTime.toFixed(2) + 's', drawX, endY + 14);
      }
      
      // 3. Apple-like Pure Canvas Multiple Nodes drawing
      if (state.activeNodes && state.activeNodes.length > 0 && scales.isValid) {
         ctx.globalCompositeOperation = 'source-over';
         
         for (const node of state.activeNodes) {
             const cx = Math.round(scales.scaleX(node.xVal) * 2) / 2;
             
             let cyExact = 0;
             if (node.yAxisOrientation === 'right') cyExact = scales.scaleYRight(node.yVal);
             else if (node.yAxisOrientation === 'left') cyExact = scales.scaleYLeft(node.yVal);
             else cyExact = scales.scaleYLeft(node.yVal); // Fallback assumption
             
             const cy = Math.round(cyExact * 2) / 2;

             // Ensure bound clipping loosely so we don't draw far outside
             if (cx >= gridLeft - 10 && cx <= gridLeft + gridWidth + 10) {
                 // Ambient glow / Ao transition
                 ctx.shadowColor = node.color;
                 ctx.shadowBlur = 10;
                 ctx.shadowOffsetX = 0;
                 ctx.shadowOffsetY = 0;

                 ctx.beginPath();
                 ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
                 ctx.fillStyle = node.color;
                 ctx.fill();
                 
                 // Inner white solid stroke equivalent
                 ctx.shadowBlur = 0;
                 ctx.lineWidth = 2;
                 ctx.strokeStyle = '#ffffff';
                 ctx.stroke();
             }
         }
      }
      
      ctx.globalCompositeOperation = 'source-over'; // Reset
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

