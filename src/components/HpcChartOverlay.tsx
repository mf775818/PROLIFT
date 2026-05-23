import React, { useRef, useEffect, useCallback } from 'react';

interface HpcChartOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  currentTime: number;
  startTimeVal: number;
  zoomDomain: { min: number; max: number } | null;
  processedData: any[];
  isVisible: boolean;
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
  const lastDrawTimeRef = useRef<number>(0);
  
  // 離屏 Canvas 用於雙緩衝，避免閃爍
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  
  // 初始化離屏 Canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const { width, height } = canvasRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    if (typeof OffscreenCanvas !== 'undefined') {
      offscreenCanvasRef.current = new OffscreenCanvas(
        Math.floor(width * dpr),
        Math.floor(height * dpr)
      );
    }
    
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        canvasRef.current.width = Math.floor(rect.width * dpr);
        canvasRef.current.height = Math.floor(rect.height * dpr);
        
        if (offscreenCanvasRef.current && typeof OffscreenCanvas !== 'undefined') {
          offscreenCanvasRef.current = new OffscreenCanvas(
            Math.floor(rect.width * dpr),
            Math.floor(rect.height * dpr)
          );
        }
      });
    });
    
    resizeObserver.observe(canvasRef.current);
    return () => resizeObserver.disconnect();
  }, []);
  
  // 高性能繪製循環 - 使用 requestAnimationFrame 但限制幀率
  const drawPlayhead = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isVisible) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const now = performance.now();
    // 限制為 30 FPS 以節省資源（播放頭不需要 60 FPS）
    if (now - lastDrawTimeRef.current < 33) {
      rafRef.current = requestAnimationFrame(drawPlayhead);
      return;
    }
    lastDrawTimeRef.current = now;
    
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;
    
    // 清空畫布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.scale(dpr, dpr);
    
    // 計算當前時間在圖表中的位置
    const domain = zoomDomain || {
      min: processedData[0]?.timeVal || 0,
      max: processedData[processedData.length - 1]?.timeVal || 1
    };
    
    // READ DIRECTLY FROM VIDEO IF AVAILABLE AND PLAYING FOR HPC SYNC
    let currentVideoTime = currentTime;
    const video = document.getElementById('main-video-player') as HTMLVideoElement;
    if (video) {
        currentVideoTime = video.currentTime;
    }
    
    const relativeTime = currentVideoTime - startTimeVal;
    
    // Avoid division by zero
    const domainDiff = domain.max - domain.min;
    const xPercent = domainDiff > 0 ? (relativeTime - domain.min) / domainDiff : 0;
    
    // chart width minus leftMargin and rightMargin
    const graphWidth = width - leftMargin - rightMargin;
    const xPos = leftMargin + xPercent * graphWidth;
    
    ctx.save();
    
    // 繪製時間區間 (Time Interval) - Gray shaded area from start to current position
    // We want to draw from leftMargin up to xPos, clamped by graph width.
    if (xPos > leftMargin) {
      ctx.fillStyle = 'rgba(156, 163, 175, 0.15)'; // Gray-400 transparent
      ctx.fillRect(leftMargin, 0, Math.min(xPos - leftMargin, graphWidth), height);
    }
    
    // 只繪製在可視範圍內的播放頭
    if (xPos >= 0 && xPos <= width) {
      // 繪製虛線播放頭 - 使用 CSS 樣式模擬虛線效果
      const dashHeight = 8;
      const gapHeight = 4;
      const totalDashes = Math.ceil(height / (dashHeight + gapHeight));
    
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.8)'; // Gray-400
      ctx.lineWidth = 2;
      ctx.setLineDash([dashHeight, gapHeight]);
      ctx.lineDashOffset = -((now / 50) % (dashHeight + gapHeight)); // 動畫效果
      
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, height);
      ctx.stroke();
      
      // 繪製頂部指示器
      ctx.fillStyle = 'rgba(250, 204, 21, 0.9)'; // yellow-400
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos - 6, 0);
      ctx.lineTo(xPos - 6, 12);
      ctx.lineTo(xPos + 6, 12);
      ctx.lineTo(xPos + 6, 0);
      ctx.closePath();
      ctx.fill();
      
      // 繪製時間標籤
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(relativeTime.toFixed(2) + 's', xPos, 22);
    // ... drawing ends ...
    }
    
    ctx.restore(); // restore line 115
    ctx.restore(); // restore line 89
    
    rafRef.current = requestAnimationFrame(drawPlayhead);
  }, [currentTime, startTimeVal, zoomDomain, processedData, isVisible]);
  
  // 啟動/停止繪製循環
  useEffect(() => {
    if (isVisible && processedData.length > 0) {
      rafRef.current = requestAnimationFrame(drawPlayhead);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isVisible, processedData.length, drawPlayhead]);
  
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-50"
      style={{ 
        transform: 'translateZ(0)',
        willChange: 'transform',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.2s ease'
      }}
    />
  );
};
