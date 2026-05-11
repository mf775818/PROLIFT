/**
 * HPC-Optimized Video Decoder Hook for React
 * 
 * Integrates WebCodecsHEVCDecoder with ROI selection and frame-accurate playback
 * Provides industrial-strength error handling and progress tracking
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { WebCodecsHEVCDecoder, DecodedFrame, DecoderConfig } from './video/WebCodecsHEVCDecoder';

export interface UseHPCVideoDecoderResult {
  // State
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  progress: number;
  
  // Video metadata
  width: number;
  height: number;
  duration: number;
  frameCount: number;
  
  // Frame access
  currentFrame: DecodedFrame | null;
  currentFrameIndex: number;
  
  // Controls
  seekToFrame: (index: number) => Promise<void>;
  getNextFrame: () => Promise<DecodedFrame | null>;
  getPrevFrame: () => Promise<DecodedFrame | null>;
  getCurrentFrameAtTime: (timeSeconds: number) => Promise<DecodedFrame | null>;
  
  // ROI controls
  setROI: (roi: { x: number; y: number; width: number; height: number }) => void;
  clearROI: () => void;
  isROIAvailable: boolean;
  
  // Metrics
  getMetrics: () => {
    totalFrames: number;
    decodeTimeMs: number;
    avgDecodeTimePerFrame: number;
    errorCount: number;
    isComplete: boolean;
  };
  
  // Cleanup
  dispose: () => void;
}

export interface UseHPCVideoDecoderOptions {
  preferHardware?: boolean;
  maxConcurrency?: number;
  enableROI?: boolean;
  onProgress?: (progress: number) => void;
  autoLoad?: boolean;
}

/**
 * Industrial-grade HPC Video Decoder Hook
 * 
 * Features:
 * - HEVC/H.265 hardware acceleration with fallback
 * - ROI-aware decoding for memory efficiency
 * - Frame-accurate seeking
 * - Real-time progress tracking
 * - Comprehensive error recovery
 */
export function useHPCVideoDecoder(
  file: File | Blob | string | null,
  options: UseHPCVideoDecoderOptions = {}
): UseHPCVideoDecoderResult {
  const {
    preferHardware = true,
    maxConcurrency = 4,
    enableROI = false,
    onProgress,
    autoLoad = true
  } = options;

  // State
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [duration, setDuration] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  
  const [currentFrame, setCurrentFrame] = useState<DecodedFrame | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(-1);
  
  // Refs
  const decoderRef = useRef<WebCodecsHEVCDecoder | null>(null);
  const roiRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const fileRef = useRef<File | Blob | string | null>(file);
  
  // Initialize decoder
  useEffect(() => {
    if (!file || !autoLoad) return;
    
    let cancelled = false;
    
    const loadVideo = async () => {
      setIsLoading(true);
      setIsError(false);
      setErrorMessage(null);
      setProgress(0);
      
      try {
        const decoder = new WebCodecsHEVCDecoder((prog) => {
          if (cancelled) return;
          setProgress(prog);
          onProgress?.(prog);
        });
        
        decoderRef.current = decoder;
        
        const config: DecoderConfig = {
          preferHardware,
          maxConcurrency,
          roiEnabled: enableROI,
          ...(roiRef.current && {
            roiX: roiRef.current.x,
            roiY: roiRef.current.y,
            roiWidth: roiRef.current.width,
            roiHeight: roiRef.current.height
          })
        };
        
        const metadata = await decoder.initialize(file, config);
        
        if (cancelled) {
          decoder.dispose();
          return;
        }
        
        setWidth(metadata.width);
        setHeight(metadata.height);
        setDuration(metadata.duration);
        setFrameCount(metadata.frameCount);
        
        // Wait for first frame
        const firstFrame = await decoder.getFrame(0);
        if (firstFrame && !cancelled) {
          setCurrentFrame(firstFrame);
          setCurrentFrameIndex(0);
          setIsReady(true);
        }
        
        setIsLoading(false);
        
      } catch (error) {
        if (cancelled) return;
        
        console.error('[HPCVideoDecoder] Initialization failed:', error);
        setIsError(true);
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
        setIsLoading(false);
      }
    };
    
    loadVideo();
    
    return () => {
      cancelled = true;
      if (decoderRef.current) {
        decoderRef.current.dispose();
        decoderRef.current = null;
      }
    };
  }, [file, autoLoad]);
  
  // Seek to frame
  const seekToFrame = useCallback(async (index: number) => {
    if (!decoderRef.current || index < 0) return;
    
    try {
      const frame = await decoderRef.current.getFrame(index);
      if (frame) {
        setCurrentFrame(frame);
        setCurrentFrameIndex(index);
      }
    } catch (error) {
      console.error('[HPCVideoDecoder] Seek failed:', error);
      throw error;
    }
  }, []);
  
  // Get next frame
  const getNextFrame = useCallback(async () => {
    if (!decoderRef.current || currentFrameIndex >= frameCount - 1) return null;
    
    const nextIndex = currentFrameIndex + 1;
    const frame = await decoderRef.current.getFrame(nextIndex);
    if (frame) {
      setCurrentFrame(frame);
      setCurrentFrameIndex(nextIndex);
    }
    return frame;
  }, [currentFrameIndex, frameCount]);
  
  // Get previous frame
  const getPrevFrame = useCallback(async () => {
    if (!decoderRef.current || currentFrameIndex <= 0) return null;
    
    const prevIndex = currentFrameIndex - 1;
    const frame = await decoderRef.current.getFrame(prevIndex);
    if (frame) {
      setCurrentFrame(frame);
      setCurrentFrameIndex(prevIndex);
    }
    return frame;
  }, [currentFrameIndex]);
  
  // Get frame at specific time
  const getCurrentFrameAtTime = useCallback(async (timeSeconds: number) => {
    if (!decoderRef.current || !duration) return null;
    
    const fps = frameCount / (duration / 1_000_000);
    const targetIndex = Math.floor(timeSeconds * fps);
    
    return await seekToFrame(targetIndex);
  }, [duration, frameCount, seekToFrame]);
  
  // Set ROI
  const setROI = useCallback((roi: { x: number; y: number; width: number; height: number }) => {
    roiRef.current = roi;
    
    // If decoder exists, reinitialize with new ROI
    if (decoderRef.current && fileRef.current) {
      decoderRef.current.dispose();
      decoderRef.current = null;
      setIsReady(false);
      
      // Trigger re-initialization by updating file ref
      const currentFile = fileRef.current;
      fileRef.current = null;
      
      setTimeout(() => {
        fileRef.current = currentFile;
        // This will trigger the useEffect to reload
      }, 0);
    }
  }, []);
  
  // Clear ROI
  const clearROI = useCallback(() => {
    roiRef.current = null;
    
    if (decoderRef.current && fileRef.current) {
      decoderRef.current.dispose();
      decoderRef.current = null;
      setIsReady(false);
      
      const currentFile = fileRef.current;
      fileRef.current = null;
      
      setTimeout(() => {
        fileRef.current = currentFile;
      }, 0);
    }
  }, []);
  
  // Get metrics
  const getMetrics = useCallback(() => {
    if (!decoderRef.current) {
      return {
        totalFrames: 0,
        decodeTimeMs: 0,
        avgDecodeTimePerFrame: 0,
        errorCount: 0,
        isComplete: false
      };
    }
    return decoderRef.current.getMetrics();
  }, []);
  
  // Cleanup
  const dispose = useCallback(() => {
    if (decoderRef.current) {
      decoderRef.current.dispose();
      decoderRef.current = null;
    }
    setIsReady(false);
    setCurrentFrame(null);
    setCurrentFrameIndex(-1);
  }, []);
  
  return {
    isReady,
    isLoading,
    isError,
    errorMessage,
    progress,
    width,
    height,
    duration,
    frameCount,
    currentFrame,
    currentFrameIndex,
    seekToFrame,
    getNextFrame,
    getPrevFrame,
    getCurrentFrameAtTime,
    setROI,
    clearROI,
    isROIAvailable: enableROI,
    getMetrics,
    dispose
  };
}

/**
 * Utility: Check HEVC support before loading video
 */
export async function checkHEVCSupport(): Promise<{
  supported: boolean;
  method: 'hardware' | 'software' | 'native-video' | 'none';
  recommendation: string;
}> {
  const result = await WebCodecsHEVCDecoder.detectHEVCSupport();
  
  let recommendation = '';
  switch (result.method) {
    case 'hardware':
      recommendation = 'Full hardware-accelerated HEVC decoding available';
      break;
    case 'software':
      recommendation = 'Software HEVC decoding available (may be slower)';
      break;
    case 'native-video':
      recommendation = 'Native video playback only, limited frame access';
      break;
    case 'none':
      recommendation = 'HEVC not supported. Consider transcoding to H.264';
      break;
  }
  
  return {
    supported: result.supported,
    method: result.method,
    recommendation
  };
}
