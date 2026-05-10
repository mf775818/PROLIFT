
import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { LiftMetrics, PoseResult, AnalysisState, Keypoint } from '../types';
import { TrackingBuffer } from '../src/lib/hpc/TrackingBuffer';
import { CalibrationEngineHPC } from '../src/lib/hpc/CalibrationEngineHPC';
import { DepthCalibratorHPC } from '../src/lib/hpc/DepthCalibratorHPC';
import { PhysicsEngineHPC } from '../src/lib/hpc/PhysicsEngineHPC';
import { KalmanSmoother1D } from '../src/lib/hpc/KalmanSmoother';


// Module-level variable to store the initialized OpenCV instance, avoiding re-assignment to window.cv if it's read-only
let g_cv: any = null;

interface VideoAnalyzerProps {
  videoFile: File | null;
  onMetricsUpdate: (metrics: LiftMetrics, history: LiftMetrics[]) => void;
  onAnalysisComplete: (allMetrics: LiftMetrics[]) => void;
  onAnalysisStart: () => void;
  onReset?: () => void;
  barbellMass: number;
  userHeightMm?: number | null;
  seekRequest?: {time: number, nonce: number} | null;
  onFileSelect?: (file: File) => void;
}

// --- TYPES ---
interface NormalizedRect {
  x: number; y: number; width: number; height: number;
}
interface VideoLayout {
    width: number; height: number; top: number; left: number;
}
interface RawFrameData {
    index: number; time: number; landmarks: Keypoint[]; roi?: { x: number, y: number };
}

declare global {
  interface Window { cv: any; MP4Box: any; }
}

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

// ... (Math Helpers retained)
const calculateAngle = (a: Keypoint, b: Keypoint, c: Keypoint): number => {
  if (!a || !b || !c) return 0;
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const magSq1 = v1x * v1x + v1y * v1y;
  const magSq2 = v2x * v2x + v2y * v2y;
  if (magSq1 === 0 || magSq2 === 0) return 0;
  return (Math.acos(dot / Math.sqrt(magSq1 * magSq2)) * 180.0) / Math.PI;
};

const calculateAngleToHorizontal = (a: Keypoint, b: Keypoint): number => {
  if (!a || !b) return 0;
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dy, dx) * 180.0) / Math.PI;
};

const getHeatColor = (value: number, min: number, max: number) => {
  if (max === min) return `hsl(240, 100%, 50%)`;
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const hue = 240 * (1 - normalized);
  return `hsl(${hue}, 100%, 50%)`;
};

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t * t2;
    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
};

const upsampleData = (data: LiftMetrics[], factor: number = 4) => {
    if (data.length < 4) return data;
    const result: LiftMetrics[] = [];
    for (let i = 0; i < data.length - 1; i++) {
        const p0 = data[Math.max(0, i - 1)];
        const p1 = data[i];
        const p2 = data[i + 1];
        const p3 = data[Math.min(data.length - 1, i + 2)];
        for (let j = 0; j < factor; j++) {
            const t = j / factor;
            const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
            const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
            const time = (parseFloat(p1.time) + (parseFloat(p2.time) - parseFloat(p1.time)) * t).toFixed(3);
            const velocity = p1.velocity + (p2.velocity - p1.velocity) * t;
            const height = p1.height + (p2.height - p1.height) * t;
            const power = p1.power + (p2.power - p1.power) * t;
            const kneeAngle = p1.kneeAngle + (p2.kneeAngle - p1.kneeAngle) * t;
            const hipAngle = p1.hipAngle + (p2.hipAngle - p1.hipAngle) * t;
            // Robust Interpolation for optional/new fields
            const aa1 = p1.ankleAngle || 0;
            const aa2 = p2.ankleAngle || 0;
            const ankleAngle = aa1 + (aa2 - aa1) * t;
            const ba1 = p1.backAngle || 0;
            const ba2 = p2.backAngle || 0;
            const backAngle = ba1 + (ba2 - ba1) * t;
            
            result.push({ time, velocity, height, power, x, y, kneeAngle, hipAngle, ankleAngle, backAngle });
        }
    }
    return result;
};

const cleanSkeletonData = (rawFrames: RawFrameData[]) => {
    if (rawFrames.length < 3) return;
    
    // Physiological limit: ~5.0 normalized units per second.
    // E.g., moving across the entire screen in 0.2 seconds
    const MAX_VELOCITY = 5.0; 
    const numLandmarks = 33;
    
    for (let lm = 0; lm < numLandmarks; lm++) {
        let lastValidIdx = 0;
        
        // 1. Mark outliers
        for (let i = 1; i < rawFrames.length; i++) {
            const current = rawFrames[i];
            const prev = rawFrames[lastValidIdx];
            
            const ptCurrent = current.landmarks[lm];
            const ptPrev = prev.landmarks[lm];
            
            if (!ptCurrent || !ptPrev) continue;
            
            const dt = current.time - prev.time;
            if (dt <= 0.001) continue;
            
            const dx = ptCurrent.x - ptPrev.x;
            const dy = ptCurrent.y - ptPrev.y;
            const distSq = dx * dx + dy * dy;
            
            const limitSq = (MAX_VELOCITY * dt) * (MAX_VELOCITY * dt);
            
            if (distSq > limitSq) {
                // Mark as invalid
                ptCurrent.visibility = -1; 
            } else {
                lastValidIdx = i;
            }
        }
        
        // 2. Interpolate invalid points
        let lastValid = -1;
        for (let i = 0; i < rawFrames.length; i++) {
            const pt = rawFrames[i].landmarks[lm];
            if (!pt) continue;

            if (pt.visibility !== -1) {
                if (lastValid !== -1 && i - lastValid > 1) {
                    const f1 = rawFrames[lastValid];
                    const f2 = rawFrames[i];
                    const dt = f2.time - f1.time;
                    for (let j = lastValid + 1; j < i; j++) {
                        const fj = rawFrames[j];
                        const tRatio = dt > 0.001 ? (fj.time - f1.time) / dt : 0.5;
                        fj.landmarks[lm].x = f1.landmarks[lm].x + (f2.landmarks[lm].x - f1.landmarks[lm].x) * tRatio;
                        fj.landmarks[lm].y = f1.landmarks[lm].y + (f2.landmarks[lm].y - f1.landmarks[lm].y) * tRatio;
                        if (fj.landmarks[lm].z !== undefined && f1.landmarks[lm].z !== undefined && f2.landmarks[lm].z !== undefined) {
                            fj.landmarks[lm].z = f1.landmarks[lm].z! + (f2.landmarks[lm].z! - f1.landmarks[lm].z!) * tRatio;
                        }
                        const v1 = Math.max(0, f1.landmarks[lm].visibility);
                        const v2 = Math.max(0, f2.landmarks[lm].visibility);
                        fj.landmarks[lm].visibility = v1 + (v2 - v1) * tRatio;
                    }
                }
                lastValid = i;
            }
        }
        
        // 3. Extrapolate trailing
        if (lastValid !== -1 && lastValid < rawFrames.length - 1) {
            for (let i = lastValid + 1; i < rawFrames.length; i++) {
                if (!rawFrames[i].landmarks[lm]) continue;
                rawFrames[i].landmarks[lm].x = rawFrames[lastValid].landmarks[lm].x;
                rawFrames[i].landmarks[lm].y = rawFrames[lastValid].landmarks[lm].y;
                if (rawFrames[i].landmarks[lm].z !== undefined) {
                    rawFrames[i].landmarks[lm].z = rawFrames[lastValid].landmarks[lm].z;
                }
                rawFrames[i].landmarks[lm].visibility = Math.max(0, rawFrames[lastValid].landmarks[lm].visibility) * 0.9;
            }
        }
        
        // 4. Extrapolate leading
        let firstValid = -1;
        for (let i = 0; i < rawFrames.length; i++) {
             if (rawFrames[i].landmarks[lm] && rawFrames[i].landmarks[lm].visibility !== -1) {
                 firstValid = i;
                 break;
             }
        }
        if (firstValid > 0) {
            for (let i = 0; i < firstValid; i++) {
                if (!rawFrames[i].landmarks[lm]) continue;
                rawFrames[i].landmarks[lm].x = rawFrames[firstValid].landmarks[lm].x;
                rawFrames[i].landmarks[lm].y = rawFrames[firstValid].landmarks[lm].y;
                if (rawFrames[i].landmarks[lm].z !== undefined) {
                    rawFrames[i].landmarks[lm].z = rawFrames[firstValid].landmarks[lm].z;
                }
                rawFrames[i].landmarks[lm].visibility = Math.max(0, rawFrames[firstValid].landmarks[lm].visibility) * 0.9;
            }
        }
        
        for (let i = 0; i < rawFrames.length; i++) {
             if (rawFrames[i].landmarks[lm] && rawFrames[i].landmarks[lm].visibility === -1) {
                 rawFrames[i].landmarks[lm].visibility = 0;
             }
        }
    }
};

// --- ADVANCED COMPRESSION: Ramer-Douglas-Peucker Algorithm ---
const perpendicularDistanceSq = (pt: LiftMetrics, lineStart: LiftMetrics, lineEnd: LiftMetrics) => {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lineMagSq = dx * dx + dy * dy;
    
    if (lineMagSq === 0) {
        const pdx = pt.x - lineStart.x;
        const pdy = pt.y - lineStart.y;
        return pdx * pdx + pdy * pdy;
    }
    
    const crossProduct = dx * (lineStart.y - pt.y) - (lineStart.x - pt.x) * dy;
    return (crossProduct * crossProduct) / lineMagSq;
};

const rdpCompress = (points: LiftMetrics[], epsilon: number): LiftMetrics[] => {
    const n = points.length;
    if (n < 3) return points;

    const epsilonSq = epsilon * epsilon;

    // Use a flat Uint8Array to mark points to keep (O(N) memory allocation instead of O(N log N) recursive slicing)
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;

    // Iterative stack pre-allocated to avoid array resizing overhead
    const stack = new Int32Array(n);
    let top = 0;
    
    // push initial range
    stack[top++] = 0;
    stack[top++] = n - 1;

    let dmaxSq = 0;
    let index = 0;

    while (top > 0) {
        const endIndex = stack[--top];
        const startIndex = stack[--top];

        dmaxSq = 0;
        index = startIndex;

        const pStart = points[startIndex];
        const pEnd = points[endIndex];

        // Find the point with the maximum distance
        for (let i = startIndex + 1; i < endIndex; i++) {
            const dSq = perpendicularDistanceSq(points[i], pStart, pEnd);
            if (dSq > dmaxSq) {
                index = i;
                dmaxSq = dSq;
            }
        }

        // If max distance is greater than epsilon, recursively simplify
        if (dmaxSq > epsilonSq) {
            keep[index] = 1;
            // Push right half
            stack[top++] = index;
            stack[top++] = endIndex;
            // Push left half
            stack[top++] = startIndex;
            stack[top++] = index;
        }
    }

    // Filter points based on the 'keep' array mapping
    const result: LiftMetrics[] = [];
    for (let i = 0; i < n; i++) {
        if (keep[i] === 1) {
            result.push(points[i]);
        }
    }
    return result;
};

// ... (Classes RTSSmoother and OpenCVTracker retained)
class RTSSmoother {
    Q: number; R_base: number;
    constructor(processNoise = 1e-4, measNoise = 1e-3) { this.Q = processNoise; this.R_base = measNoise; }
    smooth(n: number, vals: Float64Array, confs: Float64Array): Float64Array {
        if (n === 0) return new Float64Array(0);
        const x_est = new Float64Array(n), P_est = new Float64Array(n), x_pred = new Float64Array(n), P_pred = new Float64Array(n);
        x_est[0] = vals[0]; P_est[0] = 1.0; 
        for (let k = 1; k < n; k++) {
            x_pred[k] = x_est[k - 1]; P_pred[k] = P_est[k - 1] + this.Q;
            const z = vals[k]; const R = this.R_base / Math.max(0.001, confs[k]);
            const K = P_pred[k] / (P_pred[k] + R); x_est[k] = x_pred[k] + K * (z - x_pred[k]); P_est[k] = (1 - K) * P_pred[k];
        }
        const x_smooth = new Float64Array(n); x_smooth[n - 1] = x_est[n - 1];
        for (let k = n - 2; k >= 0; k--) { const C = P_est[k] / P_pred[k + 1]; x_smooth[k] = x_est[k] + C * (x_smooth[k + 1] - x_pred[k + 1]); }
        return x_smooth;
    }
}

class OpenCVTracker {
    prevGray: any = null; prevPts: any = null; isInitialized: boolean = false; currentROI: any = null; clahe: any = null;
    
    initialize(ctx: CanvasRenderingContext2D, width: number, height: number, roi: any) {
        const cv = g_cv || (window as any).cv;
        if (!cv || !cv.Mat) return;
        if (this.prevGray) this.prevGray.delete(); if (this.prevPts) this.prevPts.delete(); if (this.clahe) this.clahe.delete();
        
        const src = cv.imread(ctx.canvas); 
        const gray = new cv.Mat(); 
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        
        this.clahe = new cv.CLAHE(2.0, new cv.Size(8, 8)); 
        this.clahe.apply(gray, gray);
        
        const roiRect = new cv.Rect(roi.x, roi.y, roi.width, roi.height); 
        const roiMat = gray.roi(roiRect);
        
        const corners = new cv.Mat(); 
        cv.goodFeaturesToTrack(roiMat, corners, 100, 0.01, 5); // Increased points to 100 for robustness
        
        if (cv.cornerSubPix) { 
            try { 
                const termCrit = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 30, 0.01); 
                cv.cornerSubPix(roiMat, corners, new cv.Size(5, 5), new cv.Size(-1, -1), termCrit); 
            } catch (e) {} 
        }
        
        // Convert local ROI coordinates to global coordinates
        for (let i = 0; i < corners.rows; i++) { 
            corners.data32F[i * 2] += roi.x; 
            corners.data32F[i * 2 + 1] += roi.y; 
        }
        
        this.prevGray = gray; 
        this.prevPts = corners; 
        this.currentROI = roi; 
        this.isInitialized = true; 
        
        src.delete(); 
        roiMat.delete();
    }

    track(ctx: CanvasRenderingContext2D) {
        const cv = g_cv || (window as any).cv;
        if (!cv || !cv.Mat || !this.isInitialized) return null;
        
        let src, fullNextGray, nextPts, status, err, newPtsMat;
        let prevGrayRoi, nextGrayRoi, localPrevPts, localNextPts;
        
        try {
            src = cv.imread(ctx.canvas); 
            fullNextGray = new cv.Mat(); 
            
            cv.cvtColor(src, fullNextGray, cv.COLOR_RGBA2GRAY, 0); 
            this.clahe.apply(fullNextGray, fullNextGray);
            
            // --- INDUSTRIAL OPTIMIZATION: ROI Cropping ---
            const padding = 50;
            // Calculate a safe extended bounding box for tracking
            const rx = Math.max(0, this.currentROI.x - padding);
            const ry = Math.max(0, this.currentROI.y - padding);
            const rw = Math.min(fullNextGray.cols - rx, this.currentROI.width + padding * 2);
            const rh = Math.min(fullNextGray.rows - ry, this.currentROI.height + padding * 2);
            
            const roiRect = new cv.Rect(rx, ry, rw, rh);
            
            prevGrayRoi = this.prevGray.roi(roiRect);
            nextGrayRoi = fullNextGray.roi(roiRect);
            
            localPrevPts = new cv.Mat();
            this.prevPts.copyTo(localPrevPts);
            for (let i = 0; i < localPrevPts.rows; i++) {
                localPrevPts.data32F[i * 2] -= rx;
                localPrevPts.data32F[i * 2 + 1] -= ry;
            }
            
            localNextPts = new cv.Mat();
            status = new cv.Mat();
            err = new cv.Mat();
            
            // --- INDUSTRIAL OPTIMIZATION: Faster Optical Flow ---
            // winSize 15x15 and maxLevel 2 to balance speed and accuracy in offline/batch environments
            const winSize = new cv.Size(15, 15);
            
            cv.calcOpticalFlowPyrLK(
                prevGrayRoi, nextGrayRoi, localPrevPts, localNextPts, status, err, winSize, 2, 
                new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 10, 0.03)
            );

            nextPts = new cv.Mat();
            localNextPts.copyTo(nextPts);
            // Convert back to full image coordinates
            for (let i = 0; i < nextPts.rows; i++) {
                nextPts.data32F[i * 2] += rx;
                nextPts.data32F[i * 2 + 1] += ry;
            }

            // --- INDUSTRIAL FIX: Adaptive Point Pruning & GC Relief ---
            const totalPoints = status.rows;
            const validX = new Float32Array(totalPoints);
            const validY = new Float32Array(totalPoints);
            const keptPointsData = new Float32Array(totalPoints * 2);
            let validCount = 0;

            for (let i = 0; i < totalPoints; i++) {
                if (status.data[i] === 1) {
                    const p0x = this.prevPts.data32F[i * 2];
                    const p0y = this.prevPts.data32F[i * 2 + 1];
                    const p1x = nextPts.data32F[i * 2];
                    const p1y = nextPts.data32F[i * 2 + 1];

                    if (p1x >= 0 && p1x <= ctx.canvas.width && p1y >= 0 && p1y <= ctx.canvas.height) {
                        const dx = p1x - p0x;
                        const dy = p1y - p0y;
                        
                        if (dx * dx + dy * dy < 250000) {
                            validX[validCount] = dx;
                            validY[validCount] = dy;
                            keptPointsData[validCount * 2] = p1x;
                            keptPointsData[validCount * 2 + 1] = p1y;
                            validCount++;
                        }
                    }
                }
            }

            if (validCount > 0) {
                const xSub = validX.subarray(0, validCount);
                const ySub = validY.subarray(0, validCount);
                xSub.sort(); // TypedArray sort is inherently numeric
                ySub.sort();
                const medianX = xSub[Math.floor(validCount / 2)];
                const medianY = ySub[Math.floor(validCount / 2)];
                
                if (this.currentROI) {
                    this.currentROI.x += medianX;
                    this.currentROI.y += medianY;
                }

                if (this.prevPts) this.prevPts.delete();
                newPtsMat = new cv.Mat(validCount, 1, cv.CV_32FC2);
                for (let k = 0; k < validCount; k++) {
                    newPtsMat.data32F[k * 2] = keptPointsData[k * 2];
                    newPtsMat.data32F[k * 2 + 1] = keptPointsData[k * 2 + 1];
                }
                this.prevPts = newPtsMat;
                if (this.prevGray) this.prevGray.delete();
                this.prevGray = fullNextGray;
                fullNextGray = null; // Prevent deletion in finally
            } else {
                this.isInitialized = false;
            }
            
            return this.currentROI ? { ...this.currentROI } : null;
        } catch (e) {
            console.error("OpenCV Tracking Error", e);
            return null;
        } finally {
            if (src) src.delete();
            if (fullNextGray) fullNextGray.delete();
            if (nextPts) nextPts.delete();
            if (status) status.delete();
            if (err) err.delete();
            if (prevGrayRoi) prevGrayRoi.delete();
            if (nextGrayRoi) nextGrayRoi.delete();
            if (localPrevPts) localPrevPts.delete();
            if (localNextPts) localNextPts.delete();
        }
    }
    
    destroy() { if (this.prevGray) this.prevGray.delete(); if (this.prevPts) this.prevPts.delete(); if (this.clahe) this.clahe.delete(); this.isInitialized = false; }
}

export const VideoAnalyzer: React.FC<VideoAnalyzerProps> = React.memo(({ 
  videoFile, 
  onMetricsUpdate, 
  onAnalysisComplete,
  onAnalysisStart,
  onReset,
  barbellMass,
  userHeightMm,
  seekRequest,
  onFileSelect
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pathCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processingVideoRef = useRef<HTMLVideoElement>(document.createElement('video'));
  
  const lastRenderedIndexRef = useRef<number>(-1);

  const onResetRef = useRef(onReset);
  useEffect(() => { onResetRef.current = onReset; }, [onReset]);
  
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false); 
  const [videoError, setVideoError] = useState<string | null>(null);
  
  const [poseModel, setPoseModel] = useState<any>(null);
  const [cvReady, setCvReady] = useState(false);
  const [analysisState, setAnalysisState] = useState<AnalysisState>(AnalysisState.IDLE);
  const [progress, setProgress] = useState(0);
  
  const [isSelectingROI, setIsSelectingROI] = useState(false);
  const [normalizedROI, setNormalizedROI] = useState<NormalizedRect | null>(null);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [videoLayout, setVideoLayout] = useState<VideoLayout>({ width: 0, height: 0, top: 0, left: 0 });

  // --- NEW: Playback Control States ---
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const fullLiftHistory = useRef<LiftMetrics[]>([]);
  const compressedLiftHistory = useRef<LiftMetrics[]>([]);
  const renderCommandsRef = useRef<{ color: string, x: number, y: number, time: number }[]>([]);
  const startXRef = useRef<number>(0); 
  const startYRef = useRef<number>(0); 
  const pixelToMeterRef = useRef<number>(0.0025); 
  const maxVelocityRef = useRef<number>(1.5);
  const barbellMassRef = useRef(barbellMass);
  
  const rawDataRef = useRef<RawFrameData[]>([]);

  const onMetricsUpdateRef = useRef(onMetricsUpdate);
  const onAnalysisCompleteRef = useRef(onAnalysisComplete);
  const onAnalysisStartRef = useRef(onAnalysisStart);

  useEffect(() => { barbellMassRef.current = barbellMass; }, [barbellMass]);
  useEffect(() => { onMetricsUpdateRef.current = onMetricsUpdate; }, [onMetricsUpdate]);
  useEffect(() => { onAnalysisCompleteRef.current = onAnalysisComplete; }, [onAnalysisComplete]);
  useEffect(() => { onAnalysisStartRef.current = onAnalysisStart; }, [onAnalysisStart]);

  useEffect(() => {
    if (seekRequest && videoRef.current) {
        // ALWAYS seek when a new request comes in
        try {
            if (videoRef.current.readyState >= 1) {
                videoRef.current.currentTime = seekRequest.time;
            } else {
                // Wait for metadata if not ready
                const handleMetadata = () => {
                   if (videoRef.current) videoRef.current.currentTime = seekRequest.time;
                   videoRef.current?.removeEventListener('loadedmetadata', handleMetadata);
                };
                videoRef.current.addEventListener('loadedmetadata', handleMetadata);
            }
        } catch (e) {
            console.warn("Could not seek video: ", e);
        }
    }
  }, [seekRequest]);

  useEffect(() => {
    const loadPose = async () => {
      if (window.Pose) {
        const pose = new window.Pose({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
        });
        pose.setOptions({ 
          modelComplexity: 1, 
          // --- INDUSTRIAL OPTIMIZATION ---
          static_image_mode: false, // Independent frame detection, no tracking overhead
          smoothLandmarks: true,  // Disable smoothing, avoid cross-frame dependencies
          enableSegmentation: false, 
          minDetectionConfidence: 0.6, 
          minTrackingConfidence: 0.5 
        });
        setPoseModel(pose);
      }
    };
    loadPose();
  }, []);

  const [cvLoadingError, setCvLoadingError] = useState(false);

  useEffect(() => {
    let checkCv: number;
    const checkAndInitCV = async () => {
        const cv = (window as any).cv;
        if (cv && cv.Mat) {
            g_cv = cv;
            setCvReady(true);
            setCvLoadingError(false);
            if (checkCv) clearInterval(checkCv);
        } else if (cv && typeof cv === 'function') {
            if (checkCv) clearInterval(checkCv);
            try {
                const cvObj = await cv();
                g_cv = cvObj;
                // Attempt to safely export OpenCV to the global scope for integration compatibility
                try {
                    // Check if 'cv' is already defined on 'window'
                    const existingCv = (window as any).cv;
                    if (existingCv && existingCv !== cvObj) {
                        // It exists but is a different object (maybe from the script tag)
                        // If it's already working, we don't need to overwrite it.
                        // But we verify if it has a core method like 'Mat'
                        if (typeof existingCv.Mat !== 'function') {
                            // If it's just a placeholder or broken, try to define it properly
                            Object.defineProperty(window, 'cv', {
                                value: cvObj,
                                configurable: true,
                                writable: true
                            });
                        }
                    } else if (!existingCv) {
                        // Not defined yet, safe to suggest definition
                        Object.defineProperty(window, 'cv', {
                            value: cvObj,
                            configurable: true,
                            writable: true
                        });
                    }
                } catch (e) {
                    console.warn("Global 'window.cv' is restricted (Safari iOS/Strict Mode). Using internal instance.");
                }
                setCvReady(true);
                setCvLoadingError(false);
            } catch (err) {
                console.error("OpenCV init error:", err);
                setCvLoadingError(true);
            }
        }
    };

    checkCv = setInterval(checkAndInitCV, 500);
    
    // Safety timeout: if CV doesn't load in 30s, show error
    const safetyTimeout = setTimeout(() => {
        if (!cvReady) {
            console.warn("OpenCV.js loading timeout.");
            setCvLoadingError(true);
        }
    }, 30000);

    return () => {
        if (checkCv) clearInterval(checkCv);
        clearTimeout(safetyTimeout);
    };
  }, [cvReady]);

  useEffect(() => {
    if (videoFile && poseModel) {
      setVideoError(null);
      setIsVideoLoading(true);
      setNormalizedROI(null);
      setAnalysisState(AnalysisState.IDLE);
      setProgress(0);
      fullLiftHistory.current = [];
      compressedLiftHistory.current = [];
      renderCommandsRef.current = [];
      lastRenderedIndexRef.current = -1;
      const pathCtx = pathCanvasRef.current?.getContext('2d');
      if (pathCtx && pathCanvasRef.current) pathCtx.clearRect(0, 0, pathCanvasRef.current.width, pathCanvasRef.current.height);
      const overlayCtx = canvasRef.current?.getContext('2d');
      if (overlayCtx && canvasRef.current) overlayCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      rawDataRef.current = [];
      startXRef.current = 0;
      setIsPlaying(false);

      let objectUrl: string | null = null;

      prepareVideoFile(videoFile).then(url => {
          objectUrl = url;
          setVideoUrl(url);
          const hiddenVid = processingVideoRef.current;
          try {
              if (hiddenVid && hiddenVid.src !== url) {
                  // If there's an ongoing fetch, setting src interrupts it, which causes a benign abort warning.
                  // We accept this since we need the new video.
                  hiddenVid.src = url;
                  hiddenVid.muted = true;
                  hiddenVid.playsInline = true;
                  hiddenVid.crossOrigin = "anonymous";
                  
                  // 🔥 Fix 2: 同樣對隱藏的分析用影片施加 0.001 秒 Hack
                  hiddenVid.onloadeddata = () => {
                      if (hiddenVid.currentTime === 0) {
                          hiddenVid.currentTime = 0.001;
                      }
                  };

                  hiddenVid.load(); // 確保隱藏影片重新載入來源
              }
          } catch (e) {
              console.warn("Could not setup hidden analysis video: ", e);
          }
          setIsVideoLoading(false);
      }).catch(err => {
          console.error("Video Prep Error:", err);
          setVideoError("Could not load video. Format may be unsupported.");
          setIsVideoLoading(false);
      });

      return () => { 
          if (objectUrl) URL.revokeObjectURL(objectUrl); 
      };
    }
  }, [videoFile, poseModel]);

  // --- INDUSTRIAL KEYBOARD CONTROLS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!videoRef.current || analysisState !== AnalysisState.COMPLETE) return;
        
        // Prevent scrolling with Space/Arrow keys
        if ([' ', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
        }

        switch(e.key) {
            case ' ': // Toggle Play
            case 'k':
            case 'K':
                togglePlay();
                break;
            case 'j': // Rewind
            case 'J':
                stepFrame(-1);
                break;
            case 'l': // Forward
            case 'L':
                stepFrame(1);
                break;
            case 'ArrowLeft':
                stepFrame(-1);
                break;
            case 'ArrowRight':
                stepFrame(1);
                break;
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [analysisState, isPlaying]); // Depend on isPlaying to toggle correctly

  const prepareVideoFile = async (file: File): Promise<string> => {
      const rawUrl = URL.createObjectURL(file);
      return Promise.resolve(rawUrl);
  };

  const updateVideoLayout = useCallback(() => {
    if (videoRef.current && wrapperRef.current) {
        const video = videoRef.current;
        const wrapper = wrapperRef.current;
        const videoRect = video.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const elementOffsetLeft = videoRect.left - wrapperRect.left;
        const elementOffsetTop = videoRect.top - wrapperRect.top;
        const videoRatio = video.videoWidth / video.videoHeight;
        const elementRatio = videoRect.width / videoRect.height;

        let renderWidth, renderHeight, internalTop, internalLeft;

        // --- UPDATED FITTING LOGIC: MAXIMIZE SPACE ---
        if (videoRect.width > 0 && videoRect.height > 0 && video.videoWidth > 0) {
            if (elementRatio > videoRatio) {
                renderHeight = videoRect.height;
                renderWidth = renderHeight * videoRatio;
                internalTop = 0;
                internalLeft = (videoRect.width - renderWidth) / 2;
            } else {
                renderWidth = videoRect.width;
                renderHeight = renderWidth / videoRatio;
                internalLeft = 0;
                internalTop = (videoRect.height - renderHeight) / 2;
            }
        } else {
            renderWidth = 0; renderHeight = 0; internalTop = 0; internalLeft = 0;
        }

        setVideoLayout({ width: renderWidth, height: renderHeight, top: elementOffsetTop + internalTop, left: elementOffsetLeft + internalLeft });
    }
  }, []);

  useLayoutEffect(() => {
    window.addEventListener('resize', updateVideoLayout);
    return () => window.removeEventListener('resize', updateVideoLayout);
  }, [updateVideoLayout]);
  
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
      const bounds = e.currentTarget.getBoundingClientRect();
      let clientX, clientY;
      if ('touches' in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
      } else {
          clientX = (e as React.MouseEvent).clientX;
          clientY = (e as React.MouseEvent).clientY;
      }
      return {
          x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
          y: clamp((clientY - bounds.top) / bounds.height, 0, 1)
      };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isSelectingROI || !videoRef.current || videoLayout.width === 0) return;
      const coords = getCoordinates(e);
      setDragStart(coords); 
      setNormalizedROI({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (!dragStart || !isSelectingROI) return;
      const coords = getCoordinates(e);
      
      const distToLeft = dragStart.x;
      const distToRight = 1.0 - dragStart.x;
      const distToTop = dragStart.y;
      const distToBottom = 1.0 - dragStart.y;

      const maxRadiusX = Math.min(distToLeft, distToRight);
      const maxRadiusY = Math.min(distToTop, distToBottom);

      const rawDeltaX = Math.abs(coords.x - dragStart.x);
      const rawDeltaY = Math.abs(coords.y - dragStart.y);

      const deltaX = Math.min(rawDeltaX, maxRadiusX);
      const deltaY = Math.min(rawDeltaY, maxRadiusY);

      const newWidth = deltaX * 2;
      const newHeight = deltaY * 2;
      const newX = dragStart.x - deltaX;
      const newY = dragStart.y - deltaY;

      setNormalizedROI({ x: newX, y: newY, width: newWidth, height: newHeight });
  };

  const handlePointerUp = () => setDragStart(null);

  const toggleROISelection = () => {
      if (isSelectingROI) {
          setIsSelectingROI(false);
      } else {
          setIsSelectingROI(true);
          setNormalizedROI(null);
          if (videoRef.current) {
              try {
                  if (videoRef.current.readyState >= 1) {
                      videoRef.current.currentTime = 0;
                  }
              } catch (e) {
                  console.warn("Could not reset currentTime (ready state check): ", e);
              }
              videoRef.current.pause();
              setIsPlaying(false);
          }
      }
  };

  const isAnalyzingRef = useRef(false);

  const startAnalysis = async () => {
      const hiddenVid = processingVideoRef.current;
      
      // Ensure video is ready
      if (!hiddenVid.videoWidth || isNaN(hiddenVid.duration) || !isFinite(hiddenVid.duration) || hiddenVid.duration === 0) {
         console.warn("Video metadata not ready. Waiting...");
         try {
             await new Promise<void>((resolve, reject) => {
                 const timeout = setTimeout(() => reject(new Error("Video metadata timeout")), 5000);
                 const handler = () => {
                     clearTimeout(timeout);
                     hiddenVid.removeEventListener('loadedmetadata', handler);
                     resolve();
                 };
                 if (hiddenVid.readyState >= 1) handler();
                 else hiddenVid.addEventListener('loadedmetadata', handler);
             });
         } catch (e) {
             console.error(e);
             setVideoError("Video analysis failed: Metadata could not be loaded.");
             return;
         }
      }

      setIsSelectingROI(false); 
      setAnalysisState(AnalysisState.ANALYZING);
      setProgress(0);
      isAnalyzingRef.current = true;
      onAnalysisStartRef.current();
      fullLiftHistory.current = [];
      try {
        await processVideoFrameByFrame_v2(hiddenVid, poseModel);
      } catch (err) {
        console.error("Analysis Failed:", err);
        setAnalysisState(AnalysisState.IDLE);
        isAnalyzingRef.current = false;
        onAnalysisCompleteRef.current([]); // Signal completion with no data to reset UI
      }
  };

  const processVideoFrameByFrame_v2 = async (vid: HTMLVideoElement, model: any) => {
    const duration = vid.duration;
    if (isNaN(duration) || !isFinite(duration) || duration <= 0) {
        console.error("Critical: Invalid video duration for analysis:", duration);
        throw new Error("Invalid video duration");
    }
    
    // Process at 30 fps for higher temporal precision
    const step = 0.033; 
    let currentTime = 0;
    
    // Safety break for extremely long videos or infinite loops
    const maxFrames = Math.ceil(duration / step) + 50;
    
    rawDataRef.current = [];
    
    const analysisCanvas = document.createElement('canvas');
    const ctx = analysisCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    
    const TARGET_MAX_DIM = 800; 
    const cvTracker = new OpenCVTracker();
    let trackedCenter = null;
    let procW = 0, procH = 0;
    let frameIndex = 0;
    let frameResolve: ((value: PoseResult) => void) | null = null;
    
    const resultsHandler = (results: PoseResult) => { if (frameResolve) frameResolve(results); };
    model.onResults(resultsHandler);

    const waitForFrame = (targetTime: number) => new Promise<void>((resolve) => {
       let resolved = false;
       const handler = () => { 
           if (resolved) return;
           resolved = true;
           vid.removeEventListener('seeked', handler); 
           resolve(); 
       };
       vid.addEventListener('seeked', handler);
       try {
           vid.currentTime = targetTime;
       } catch (e) {
           console.warn("vid.currentTime assignment failed: ", e);
           handler();
       }
       // Fallback for seek timeout - essential for mobile stability
       setTimeout(() => { if (!resolved) { handler(); } }, 2000);
    });

    while (currentTime <= duration && frameIndex < maxFrames) {
       if (!isAnalyzingRef.current) {
          console.log("Analysis cancelled by user.");
          break;
       }
       // Yield to browser's render pipeline to keep UI (progress bar) perfectly smooth
       await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
       
       try {
           await waitForFrame(currentTime);
           
           if (currentTime === 0 && ctx) {
             const vWidth = vid.videoWidth || 1;
             const vHeight = vid.videoHeight || 1;
             const aspect = vWidth / vHeight;
             if (vWidth > vHeight) {
                 procW = TARGET_MAX_DIM;
                 procH = Math.max(1, Math.floor(TARGET_MAX_DIM / aspect));
             } else {
                 procH = TARGET_MAX_DIM;
                 procW = Math.max(1, Math.floor(TARGET_MAX_DIM * aspect));
             }
             analysisCanvas.width = procW; analysisCanvas.height = procH;
             
             if (normalizedROI) {
                 let tx = Math.floor(normalizedROI.x * procW); let ty = Math.floor(normalizedROI.y * procH);
                 let tw = Math.floor(normalizedROI.width * procW); let th = Math.floor(normalizedROI.height * procH);
                 tx = clamp(tx, 0, procW - 5);
                 ty = clamp(ty, 0, procH - 5);
                 tw = clamp(tw, 5, procW - tx);
                 th = clamp(th, 5, procH - ty);

                 if (tw > 8 && th > 8 && (g_cv || (window as any).cv)) {
                     ctx.drawImage(vid, 0, 0, procW, procH);
                     try {
                        cvTracker.initialize(ctx, procW, procH, {x: tx, y: ty, width: tw, height: th});
                        trackedCenter = { x: (tx + tw / 2) / procW, y: (ty + th / 2) / procH };
                     } catch (cvErr) {
                        console.warn("OpenCV Initialization failed:", cvErr);
                     }
                 }
             }
           }

           if (ctx && analysisCanvas.width > 0 && analysisCanvas.height > 0) {
             ctx.drawImage(vid, 0, 0, analysisCanvas.width, analysisCanvas.height);
             
             if (currentTime > 0 && cvTracker.isInitialized) {
                 try {
                    const res = cvTracker.track(ctx);
                    if (res) trackedCenter = { x: (res.x + res.width / 2) / procW, y: (res.y + res.height / 2) / procH };
                 } catch (cvTrackErr) {
                    console.warn("OpenCV Tracking error:", cvTrackErr);
                 }
             }
             
             // --- PROTECTED POSE DETECTION WITH TIMEOUT ---
             const poseResult = await new Promise<PoseResult>((resolve, reject) => { 
                const timeout = setTimeout(() => {
                    console.warn("Pose detection timeout on frame:", frameIndex);
                    resolve({ poseLandmarks: null } as any); 
                }, 4000); // Relaxed timeout for mobile

                frameResolve = (res: PoseResult) => {
                    clearTimeout(timeout);
                    resolve(res);
                };

                try {
                   model.send({ image: analysisCanvas }); 
                } catch (e) {
                   clearTimeout(timeout);
                   reject(e);
                }
             });

             if (poseResult && poseResult.poseLandmarks) {
                 rawDataRef.current.push({ index: frameIndex, time: currentTime, landmarks: poseResult.poseLandmarks, roi: trackedCenter || undefined });
                 
                 // 🔥 UX Hack: Live Preview
                 const overlayCanvas = canvasRef.current;
                 const overlayCtx = overlayCanvas?.getContext('2d');
                 if (overlayCanvas && overlayCtx && window.drawConnectors && window.drawLandmarks) {
                     const w = overlayCanvas.width;
                     const h = overlayCanvas.height;
                     overlayCtx.clearRect(0, 0, w, h);
                     
                     overlayCtx.save();
                     overlayCtx.globalAlpha = 0.8;
                     window.drawConnectors(overlayCtx, poseResult.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00ff00', lineWidth: 2 });
                     window.drawLandmarks(overlayCtx, poseResult.poseLandmarks, { color: '#ffffff', lineWidth: 1, radius: 2 });
                     overlayCtx.restore();

                     if (trackedCenter) {
                         const rx = trackedCenter.x * w;
                         const ry = trackedCenter.y * h;
                         overlayCtx.beginPath();
                         overlayCtx.arc(rx, ry, 10, 0, 2*Math.PI);
                         overlayCtx.strokeStyle = '#facc15';
                         overlayCtx.lineWidth = 3;
                         overlayCtx.stroke();
                     }
                 }
             }
           }
       } catch (frameErr) {
           console.error(`Error processing frame ${frameIndex}:`, frameErr);
           // Continue to next frame instead of crashing the whole analysis
       }

       setProgress(Math.max(0, Math.min(100, Math.round((currentTime / duration) * 100))));
       currentTime += step; 
       frameIndex++;
    }
    
    cvTracker.destroy();
    if (isAnalyzingRef.current) {
        finalizeAnalysis();
        isAnalyzingRef.current = false;
    }
  };

  const finalizeAnalysis = () => {
    const raw = rawDataRef.current.sort((a, b) => a.index - b.index);
    if (raw.length === 0) { 
        console.warn("Finalize Analysis: No landmarks detected.");
        setAnalysisState(AnalysisState.IDLE); 
        onAnalysisCompleteRef.current([]);
        return; 
    }
    
    // Eliminate landmark noise/jump offsets before processing further
    cleanSkeletonData(raw);

    const canvasW = processingVideoRef.current.videoWidth; const canvasH = processingVideoRef.current.videoHeight;
    if (normalizedROI && normalizedROI.height > 0) {
        // Evaluate the plate's vertical diameter directly against processing canvas constraints
        const platePixelHeight = normalizedROI.height * canvasH;
        if (platePixelHeight > 0) {
           pixelToMeterRef.current = 0.45 / platePixelHeight; // IWF plate is exactly 0.45m
           console.log("Calibrated scale based on plate ROI: ", pixelToMeterRef.current, "m/px");
        }
    } else {
        for (const frame of raw) {
            const ls = frame.landmarks[11], rs = frame.landmarks[12];
            if (ls.visibility > 0.5 && rs.visibility > 0.5) {
                 const dist = Math.sqrt(((ls.x - rs.x) * canvasW)**2 + ((ls.y - rs.y) * canvasH)**2);
                 if (dist > 0) { 
                     pixelToMeterRef.current = 0.4 / dist; 
                     console.log("Calibrated scale based on shoulder width: ", pixelToMeterRef.current, "m/px");
                     break; 
                 }
            }
        }
    }
    const n = raw.length;
    const xVals = new Float64Array(n);
    const yVals = new Float64Array(n);
    const confs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const f = raw[i];
        if (f.roi) { 
            xVals[i] = f.roi.x; yVals[i] = f.roi.y; confs[i] = 5.0; 
        } else {
            const lw = f.landmarks[15], rw = f.landmarks[16], totalConf = lw.visibility + rw.visibility;
            if (totalConf > 0.1) { 
                xVals[i] = (lw.x * lw.visibility + rw.x * rw.visibility) / totalConf; 
                yVals[i] = (lw.y * lw.visibility + rw.y * rw.visibility) / totalConf; 
                confs[i] = totalConf / 2; 
            } else { 
                xVals[i] = (lw.x + rw.x) / 2; yVals[i] = (lw.y + rw.y) / 2; 
                confs[i] = 0.1; 
            }
        }
    }
    const kX = new KalmanSmoother1D(xVals[0], 5e-5, 1e-4);
    const kY = new KalmanSmoother1D(yVals[0], 5e-5, 1e-4);
    const smoothedX = kX.smoothBatch(xVals, n, confs);
    const smoothedY = kY.smoothBatch(yVals, n, confs);
    
    // --- 導入 HPC 運算管線 (Pipeline) ---
    const trackingBuffer = new TrackingBuffer(n);
    const calibration = new CalibrationEngineHPC();
    const depthCalibrator = new DepthCalibratorHPC();
    
    // 計算初始幀的像素尺寸以餵給雙錨定系統
    let platePixelHeight = 0;
    if (normalizedROI && normalizedROI.height > 0) {
        platePixelHeight = normalizedROI.height * canvasH;
    }
    
    let bodyPixelHeight = 0;
    if (raw.length > 0) {
        const frame0 = raw[0];
        // 頭頂通常用 nose(0) 或 eye(1,2,3,4,5,6), 這裡取 nose
        // 腳底取左右腳跟的平均 (29, 30) 或腳趾 (31, 32)
        const top = frame0.landmarks[0]?.y;
        const heelL = frame0.landmarks[29]?.y;
        const heelR = frame0.landmarks[30]?.y;
        if (top !== undefined && heelL !== undefined && heelR !== undefined) {
             const bottom = Math.max(heelL, heelR);
             bodyPixelHeight = (bottom - top) * canvasH;
        }
    }

    if (bodyPixelHeight === 0) bodyPixelHeight = canvasH * 0.8; // 備用方案
    if (platePixelHeight === 0) platePixelHeight = canvasH * 0.2; // 備用方案

    // 初始化 HPC 深度校準系統
    depthCalibrator.calibrate(platePixelHeight, bodyPixelHeight, userHeightMm);
    const isDualAnchored = depthCalibrator.isHighPrecisionMode();
    console.log("Calibration Mode: ", isDualAnchored ? "Dual Anchored (Bi-Planar)" : "Single Anchored");

    for (let i = 0; i < n; i++) {
        // 先將 normalized (0~1) 轉為像素坐標
        // 因為後續物理引擎需要 Y 向上，我們在此處先將 Y 翻轉: (1 - y) * canvasH
        trackingBuffer.push(smoothedX[i] * canvasW, (1.0 - smoothedY[i]) * canvasH, 0, raw[i].time);
    }
    
    // 利用 HPC 執行整批座標轉換 (像素轉真實物理空間 mm)
    // 我們建立一個長度為 n 的 boolean array, 表示這些都是槓鈴節點
    const isBarbellArray = new Array(n).fill(true);
    depthCalibrator.transformToPhysicalSpace(trackingBuffer.x, trackingBuffer.y, trackingBuffer.head, isBarbellArray);

    // 我們將 mm 轉回 Meters，以確保後方物理引擎的公式無縫接軌 (Power, Velocity 單位 = m/s)
    for (let i = 0; i < trackingBuffer.head; i++) {
        trackingBuffer.x[i] /= 1000.0;
        trackingBuffer.y[i] /= 1000.0;
    }

    // 將 1:1 的單位矩陣傳給舊有的 perspective engine (因為我們已經計算過比例與反轉了)
    calibration.updateHomography([
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
    ]);

    // 批次 3D 透視校正 (O(n) Zero-Allocation)
    calibration.applyPerspectiveTransform(trackingBuffer);

    const outKinetics = new Float32Array(n * 4);
    
    // 批次物理動力計算 (O(n) Zero-Allocation)
    PhysicsEngineHPC.computeKinetics(trackingBuffer, outKinetics, barbellMassRef.current);

    const metrics: LiftMetrics[] = []; let maxVel = 0;

    for (let i = 0; i < n; i++) {
        const frame = raw[i], sX = smoothedX[i], sY = smoothedY[i];
        
        // 提取計算好的 3D 物理座標
        const physX = trackingBuffer.x[i];
        const physY = trackingBuffer.y[i];
        
        const kOffset = i * 4;
        let velocity = outKinetics[kOffset];
        const accel = outKinetics[kOffset + 1];
        const force = outKinetics[kOffset + 2];
        const power = outKinetics[kOffset + 3];

        // 加上合理的邊界保護如同舊有邏輯
        velocity = Math.max(-5, Math.min(5, velocity)); 

        if (Math.abs(velocity) > maxVel) maxVel = Math.abs(velocity);
        
        const kneeAngle = calculateAngle(frame.landmarks[23], frame.landmarks[25], frame.landmarks[27]);
        const hipAngle = calculateAngle(frame.landmarks[11], frame.landmarks[23], frame.landmarks[25]);
        const ankleAngle = calculateAngle(frame.landmarks[25], frame.landmarks[27], frame.landmarks[31]);
        const backAngle = calculateAngleToHorizontal(frame.landmarks[11], frame.landmarks[23]);
        
        metrics.push({ 
            time: frame.time.toFixed(3), 
            velocity: Math.max(0, velocity), 
            height: Math.max(0, physY), 
            acceleration: accel || 0,
            force: Math.max(0, force || 0),
            power: Math.max(0, power || 0), 
            x: sX, // 將原始的 X, Y 保留，供前端畫 2D 軌跡使用
            y: sY, 
            kneeAngle, 
            hipAngle,
            ankleAngle,
            backAngle
        });
    }

    if (metrics.length > 5) {
        let maxP = -1; let pIdx = 0;
        metrics.forEach((m, i) => { if (m.power > maxP) { maxP = m.power; pIdx = i; } });
        let zeroIdx = 0;
        const floor = Math.max(15, maxP * 0.005);
        for (let i = pIdx; i >= 0; i--) {
            if (metrics[i].power <= floor) { zeroIdx = i; break; }
        }
        startXRef.current = metrics[zeroIdx].x;
    } else {
        startXRef.current = metrics[0]?.x || 0;
    }
    startYRef.current = smoothedY[0]; 

    const highResMetrics = upsampleData(metrics, 4);
    // Advanced Compression: RDP simplifies the path while keeping the shape perfectly
    const compressedMetrics = rdpCompress(highResMetrics, 0.0005); 
    maxVelocityRef.current = maxVel; 
    fullLiftHistory.current = metrics;
    compressedLiftHistory.current = compressedMetrics;
    
    // --- PRECOMPUTE RENDERING COMMANDS ---
    const precomputed = compressedMetrics.map(curr => {
        const time = typeof curr.time === 'string' ? parseFloat(curr.time) : curr.time;
        const ratio = clamp(curr.velocity / maxVel, 0, 1);
        const color = getHeatColor(ratio * maxVel, 0, maxVel);
        return { x: curr.x, y: curr.y, time, color };
    });
    renderCommandsRef.current = precomputed;
    lastRenderedIndexRef.current = -1;
    const pathCtx = pathCanvasRef.current?.getContext('2d');
    if (pathCtx && pathCanvasRef.current) pathCtx.clearRect(0,0, pathCanvasRef.current.width, pathCanvasRef.current.height);
    
    if (videoRef.current) {
        try {
            if (videoRef.current.readyState >= 1) {
                // 🔥 將 0 改為 0.001，這與解決手機端黑屏有關 (下面會解釋)
                videoRef.current.currentTime = 0.001; 
            }
            videoRef.current.playbackRate = playbackSpeed;
        } catch (e) {
            console.warn("Could not init playback state: ", e);
        }
    }
    
    // 🔥 Fix 1: 清除 Live Preview 的綠色骨架殘影
    const overlayCanvas = canvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (overlayCanvas && overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    setAnalysisState(AnalysisState.COMPLETE); 
    onAnalysisCompleteRef.current(metrics);
    onMetricsUpdateRef.current(metrics[0], metrics);

    // 🔥 手動補畫第一幀的乾淨 UI（只顯示追蹤點與數據，不顯示骨架）
    drawOverlay(metrics[0], 0);
  };

  const rafIdRef = useRef<number | null>(null);
  const lastMetricsUpdateTimeRef = useRef<number>(0);

  const renderFrameUpdates = useCallback(() => {
     if (!videoRef.current || fullLiftHistory.current.length === 0) return;
     const t = videoRef.current.currentTime;
     
     // Binary search for closest metric
     const history = fullLiftHistory.current;
     let left = 0, right = history.length - 1;
     let closestIdx = 0;
     while (left <= right) {
         const mid = Math.floor((left + right) / 2);
         if (parseFloat(history[mid].time) <= t) {
             closestIdx = mid;
             left = mid + 1;
         } else {
             right = mid - 1;
         }
     }
     const closest = history[closestIdx];

     // Binary search for raw frame
     let rawFrame = null;
     const rawData = rawDataRef.current;
     if (rawData.length > 0) {
         let rLeft = 0, rRight = rawData.length - 1;
         let rawIdx = 0;
         while (rLeft <= rRight) {
             const mid = Math.floor((rLeft + rRight) / 2);
             if (rawData[mid].time <= t) {
                 rawIdx = mid;
                 rLeft = mid + 1;
             } else {
                 rRight = mid - 1;
             }
         }
         if (Math.abs(rawData[rawIdx].time - t) < 0.1) {
             rawFrame = rawData[rawIdx];
         }
     }

     drawOverlay(closest, closestIdx, rawFrame?.landmarks);

     // Now that we use imperative DOM updates instead of React state, we can run at 30-60fps
     const now = performance.now();
     if (now - lastMetricsUpdateTimeRef.current > 33) {
         onMetricsUpdateRef.current(closest, history);
         lastMetricsUpdateTimeRef.current = now;
     }

     if (!videoRef.current.paused) {
         if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
             // @ts-ignore
             rafIdRef.current = videoRef.current.requestVideoFrameCallback(renderFrameUpdates);
         } else {
             rafIdRef.current = requestAnimationFrame(renderFrameUpdates);
         }
     }
  }, []);

  const handleTimeUpdate = () => {
    // Only used as fallback or when paused tracking (scrubbing)
    if (videoRef.current && videoRef.current.paused) {
       renderFrameUpdates();
    }
  };

  const drawOverlay = (metric: LiftMetrics, currentIndex: number, landmarks?: Keypoint[]) => {
      const overlayCanvas = canvasRef.current; const overlayCtx = overlayCanvas?.getContext('2d'); if (!overlayCanvas || !overlayCtx) return;
      const pathCanvas = pathCanvasRef.current; const pathCtx = pathCanvas?.getContext('2d'); if (!pathCanvas || !pathCtx) return;
      const w = overlayCanvas.width; const h = overlayCanvas.height; 
      
      overlayCtx.clearRect(0,0,w,h);

      if (landmarks && window.drawConnectors && window.drawLandmarks) {
         overlayCtx.save(); overlayCtx.globalAlpha = 0.5; 
         window.drawConnectors(overlayCtx, landmarks, window.POSE_CONNECTIONS, { color: 'rgba(255,255,255,0.6)', lineWidth: 2 });
         window.drawLandmarks(overlayCtx, landmarks, { color: '#ffffff', lineWidth: 1, radius: 2 });
         overlayCtx.restore();
         const fontSize = Math.max(12, w * 0.025); overlayCtx.font = `bold ${fontSize}px sans-serif`; overlayCtx.textBaseline = 'middle';
         const drawBadge = (text: string, x: number, y: number, color: string) => {
             const padding = 4; const metrics = overlayCtx.measureText(text); const bgW = metrics.width + padding * 2; const bgH = fontSize + padding * 2;
             overlayCtx.save(); overlayCtx.fillStyle = 'rgba(0,0,0,0.7)'; overlayCtx.beginPath(); overlayCtx.roundRect(x, y - bgH/2, bgW, bgH, 4); overlayCtx.fill();
             overlayCtx.fillStyle = color; overlayCtx.fillText(text, x + padding, y); overlayCtx.restore();
         };
         const kneeIdx = landmarks[25].visibility > landmarks[26].visibility ? 25 : 26;
         if (landmarks[kneeIdx].visibility > 0.3) { const val = calculateAngle(landmarks[kneeIdx-2], landmarks[kneeIdx], landmarks[kneeIdx+2]); drawBadge(`K: ${val.toFixed(0)}°`, landmarks[kneeIdx].x * w + 15, landmarks[kneeIdx].y * h, '#facc15'); }
         
         const ankleIdx = landmarks[27].visibility > landmarks[28].visibility ? 27 : 28;
         if (landmarks[ankleIdx].visibility > 0.3) {
             const val = calculateAngle(landmarks[ankleIdx-2], landmarks[ankleIdx], landmarks[ankleIdx+4]);
             drawBadge(`A: ${val.toFixed(0)}°`, landmarks[ankleIdx].x * w + 15, landmarks[ankleIdx].y * h, '#10b981');
         }

         const hipIdx = landmarks[23].visibility > landmarks[24].visibility ? 23 : 24;
         if (landmarks[hipIdx].visibility > 0.3) { 
             const val = calculateAngle(landmarks[hipIdx-12], landmarks[hipIdx], landmarks[hipIdx+2]); 
             drawBadge(`H: ${val.toFixed(0)}°`, landmarks[hipIdx].x * w + 15, landmarks[hipIdx].y * h, '#60a5fa'); 
             
             // Back angle badge
             const shoulderIdx = hipIdx - 12;
             if (landmarks[shoulderIdx].visibility > 0.3) {
                 const backAngle = calculateAngleToHorizontal(landmarks[shoulderIdx], landmarks[hipIdx]);
                 const midX = (landmarks[shoulderIdx].x + landmarks[hipIdx].x) / 2;
                 const midY = (landmarks[shoulderIdx].y + landmarks[hipIdx].y) / 2;
                 drawBadge(`B: ${backAngle.toFixed(0)}°`, midX * w + 15, midY * h, '#a78bfa');
             }
         }
      }

      const zx = startXRef.current * w; const zy = startYRef.current * h;
      overlayCtx.beginPath(); overlayCtx.moveTo(zx, 0); overlayCtx.lineTo(zx, h); overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; overlayCtx.setLineDash([4, 4]); overlayCtx.lineWidth = 2; overlayCtx.stroke(); overlayCtx.setLineDash([]);
      overlayCtx.beginPath(); overlayCtx.arc(zx, zy, 4, 0, 2*Math.PI); overlayCtx.fillStyle = 'white'; overlayCtx.fill();

      // --- ADVANCED COMPRESSION RENDERING (LTS: LAYERED TIME-STATE ZERO-ALLOCATION) ---
      const currentT = typeof metric.time === 'string' ? parseFloat(metric.time) : metric.time;
      const commands = renderCommandsRef.current;

      let targetIdx = 0;
      if (commands.length > 0) {
          let left = 0, right = commands.length - 1;
          while (left <= right) {
              const mid = Math.floor((left + right) / 2);
              if (commands[mid].time <= currentT) {
                  targetIdx = mid;
                  left = mid + 1;
              } else {
                  right = mid - 1;
              }
          }
      }

      const lastIdx = lastRenderedIndexRef.current;

      if (commands.length > 1 && targetIdx !== lastIdx) {
          const delta = targetIdx - lastIdx;
          pathCtx.lineWidth = 4; pathCtx.lineCap = 'round'; pathCtx.lineJoin = 'round';

          if (delta > 0 && delta <= 30 && lastIdx >= 0) {
              // Incremental Draw
              pathCtx.beginPath();
              pathCtx.moveTo(commands[lastIdx].x * w, commands[lastIdx].y * h);
              
              let lastColor = commands[lastIdx].color;
              for (let i = lastIdx + 1; i <= targetIdx; i++) {
                  const cmd = commands[i];
                  if (cmd.color !== lastColor) {
                      pathCtx.strokeStyle = lastColor;
                      pathCtx.stroke();
                      pathCtx.beginPath();
                      pathCtx.moveTo(commands[i-1].x * w, commands[i-1].y * h);
                      lastColor = cmd.color;
                  }
                  pathCtx.lineTo(cmd.x * w, cmd.y * h);
              }
              pathCtx.strokeStyle = lastColor;
              pathCtx.stroke();
          } else if (delta < -2 || delta > 30 || lastIdx === -1) {
              // Full redraw on seek
              pathCtx.clearRect(0, 0, w, h);
              if (targetIdx > 0) {
                  pathCtx.beginPath();
                  pathCtx.moveTo(commands[0].x * w, commands[0].y * h);
                  let lastColor = commands[0].color;
                  for (let i = 1; i <= targetIdx; i++) {
                      const cmd = commands[i];
                      if (cmd.color !== lastColor) {
                          pathCtx.strokeStyle = lastColor;
                          pathCtx.stroke();
                          pathCtx.beginPath();
                          pathCtx.moveTo(commands[i-1].x * w, commands[i-1].y * h);
                          lastColor = cmd.color;
                      }
                      pathCtx.lineTo(cmd.x * w, cmd.y * h);
                  }
                  pathCtx.strokeStyle = lastColor;
                  pathCtx.stroke();
              }
          }
          lastRenderedIndexRef.current = targetIdx;
      }

      // Draw the "live" segment to the absolute current metric on the overlay so it updates at 60fps
      if (commands.length > 0 && targetIdx >= 0 && targetIdx < commands.length) {
          const cmd = commands[targetIdx];
          if (currentT >= cmd.time) {
              overlayCtx.beginPath();
              overlayCtx.moveTo(cmd.x * w, cmd.y * h);
              overlayCtx.lineTo(metric.x * w, metric.y * h);
              overlayCtx.strokeStyle = cmd.color;
              overlayCtx.lineWidth = 4; overlayCtx.lineCap = 'round'; overlayCtx.lineJoin = 'round';
              overlayCtx.stroke();
          }
      }

      const cx = metric.x * w; const cy = metric.y * h;
      overlayCtx.beginPath(); overlayCtx.arc(cx, cy, 8, 0, 2*Math.PI); overlayCtx.fillStyle = '#facc15'; overlayCtx.strokeStyle = 'rgba(0,0,0,0.5)'; overlayCtx.lineWidth = 2; overlayCtx.fill(); overlayCtx.stroke();
      const devCm = (metric.x - startXRef.current) * 200; const devX = cx + 20; const devY = cy;
      overlayCtx.save(); overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.7)'; overlayCtx.roundRect(devX - 4, devY - 10, 60, 20, 4); overlayCtx.fill(); overlayCtx.fillStyle = devCm > 0 ? '#ef4444' : '#10b981'; overlayCtx.font = 'bold 12px monospace'; overlayCtx.fillText(`${devCm > 0 ? '+' : ''}${devCm.toFixed(1)}cm`, devX, devY + 4); overlayCtx.restore();
  };

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => { updateVideoLayout(); });
    resizeObserver.observe(videoRef.current); if (wrapperRef.current) resizeObserver.observe(wrapperRef.current);
    return () => resizeObserver.disconnect();
  }, [videoUrl, updateVideoLayout]);

  const shouldShowROI = (isSelectingROI || (normalizedROI && analysisState !== AnalysisState.COMPLETE));
  
  const handleInternalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0] && onFileSelect) {
          onFileSelect(e.target.files[0]);
          e.target.value = '';
      }
  };

  const handleVideoError = () => {
      setVideoError("Format unsupported by this browser. If it is an iPhone .MOV, try using Safari or changing iOS camera format to 'Most Compatible'.");
      setIsVideoLoading(false);
  };

  const handleCanPlay = () => {
      setIsVideoLoading(false);
      
      // 🔥 Fix 2: iOS Safari MOV 黑畫面 Hack
      if (videoRef.current) {
          // 如果時間是 0，強制跳轉到 0.001 秒，迫使 iOS 渲染第一幀預覽
          if (videoRef.current.currentTime === 0) {
              videoRef.current.currentTime = 0.001;
          }
      }
  };

  // --- NEW: Playback Control Functions ---
  useEffect(() => {
    if (videoRef.current) {
        try {
            videoRef.current.playbackRate = playbackSpeed;
        } catch (e) {
            console.warn("Could not set playbackRate: ", e);
        }
    }
  }, [playbackSpeed, isPlaying]);
  
  useEffect(() => {
     const cancelRaf = (id: number) => {
         if (videoRef.current && 'cancelVideoFrameCallback' in HTMLVideoElement.prototype) {
             // @ts-ignore
             videoRef.current.cancelVideoFrameCallback(id);
         } else {
             cancelAnimationFrame(id);
         }
     };

     if (isPlaying) {
         if (rafIdRef.current) cancelRaf(rafIdRef.current);
         if (videoRef.current && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
             // @ts-ignore
             rafIdRef.current = videoRef.current.requestVideoFrameCallback(renderFrameUpdates);
         } else {
             rafIdRef.current = requestAnimationFrame(renderFrameUpdates);
         }
     } else {
         if (rafIdRef.current) cancelRaf(rafIdRef.current);
     }
     return () => {
        if (rafIdRef.current) cancelRaf(rafIdRef.current);
     };
  }, [isPlaying, renderFrameUpdates]);

  const togglePlay = () => {
      if (!videoRef.current) return;
      if (videoRef.current.paused) {
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
              playPromise.catch((error) => {
                  console.warn("Video play interrupted:", error);
                  setIsPlaying(false);
              });
          }
          setIsPlaying(true);
      } else {
          videoRef.current.pause();
          setIsPlaying(false);
      }
  };

  const changeSpeed = (speed: number) => {
      setPlaybackSpeed(speed);
      if (videoRef.current) {
          try {
              videoRef.current.playbackRate = speed;
          } catch (e) {
              console.warn("Could not set playbackRate: ", e);
          }
      }
  };

  const stepFrame = (direction: number) => {
      if (!videoRef.current) return;
      videoRef.current.pause();
      setIsPlaying(false);
      // Industrial standard: approx 1 frame at 30fps = 0.033s
      try {
          videoRef.current.currentTime += direction * 0.033;
      } catch (e) {
          console.warn("Could not step frame: ", e);
      }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center bg-zinc-950 p-0 overflow-hidden select-none group min-h-0 min-w-0">
      {isVideoLoading ? (
         <div className="flex flex-col items-center justify-center gap-4">
             <div className="w-12 h-12 border-4 border-zinc-600 border-t-yellow-500 rounded-full animate-spin"></div>
             <p className="text-zinc-400 text-sm animate-pulse">Preparing Video...</p>
         </div>
      ) : videoError ? (
         <div className="text-center p-6 bg-zinc-900 rounded-xl border border-red-900/50">
             <div className="text-red-500 font-bold mb-2">Video Error</div>
             <p className="text-zinc-400 text-xs mb-4">{videoError}</p>
             <label className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-2 rounded cursor-pointer text-xs font-bold border border-red-600/50 transition-colors">
                 TRY DIFFERENT FILE
                 <input type="file" accept="video/mp4,video/quicktime,video/*" className="hidden" onChange={handleInternalUpload} />
             </label>
         </div>
      ) : videoUrl ? (
        <div ref={wrapperRef} className="relative w-full h-full flex items-center justify-center bg-black min-h-0 min-w-0">
          <video
            ref={videoRef}
            src={videoUrl}
            className={`w-full h-full object-contain block ${analysisState === AnalysisState.ANALYZING ? 'opacity-30' : ''}`}
            style={{ transform: 'translateZ(0)', willChange: 'transform' }}
            // Remove default controls to use custom industrial controls
            controls={false}
            muted={isMuted}
            playsInline
            preload="auto"
            onTimeUpdate={handleTimeUpdate}
            onError={handleVideoError}
            onCanPlay={handleCanPlay}
            onLoadedData={handleCanPlay}
            onLoadedMetadata={updateVideoLayout}
            onPlay={updateVideoLayout} 
            onEnded={() => setIsPlaying(false)}
            crossOrigin="anonymous"
          />
          
          <canvas ref={pathCanvasRef} className="absolute pointer-events-none z-10" style={{ top: videoLayout.top, left: videoLayout.left, width: videoLayout.width, height: videoLayout.height, transform: 'translateZ(0)', willChange: 'transform' }} width={videoLayout.width} height={videoLayout.height} />
          <canvas ref={canvasRef} className="absolute pointer-events-none z-20" style={{ top: videoLayout.top, left: videoLayout.left, width: videoLayout.width, height: videoLayout.height, transform: 'translateZ(0)', willChange: 'transform' }} width={videoLayout.width} height={videoLayout.height} />

          {shouldShowROI && (
              <div 
                 className={`absolute z-10 ${isSelectingROI ? 'cursor-crosshair' : 'pointer-events-none'}`}
                 style={{ width: videoLayout.width, height: videoLayout.height, top: videoLayout.top, left: videoLayout.left, }}
                 onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp}
                 onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp}
              >
                  {normalizedROI && (
                      <div className="absolute border-2 border-yellow-500 bg-yellow-500/20" style={{ left: `${normalizedROI.x * 100}%`, top: `${normalizedROI.y * 100}%`, width: `${normalizedROI.width * 100}%`, height: `${normalizedROI.height * 100}%` }}>
                          {isSelectingROI && (
                            <>
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border-l border-t border-yellow-400/80"></div>
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border-r border-b border-yellow-400/80"></div>
                            </>
                          )}
                          <div className="absolute -top-6 left-0 bg-yellow-500 text-black text-[10px] font-bold px-1 whitespace-nowrap">TRACKING TARGET</div>
                      </div>
                  )}
              </div>
          )}

          {/* HEADS-UP ROI CONTROLS (Top Right) */}
          {analysisState === AnalysisState.IDLE && (
              <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                  {!isSelectingROI ? (
                     <button 
                        onClick={toggleROISelection}
                        className="bg-zinc-900/90 text-white backdrop-blur-md px-4 py-2 rounded-lg text-xs font-bold tracking-wider border border-zinc-700 shadow-xl hover:bg-zinc-800 transition-all flex items-center gap-2"
                     >
                         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                         SET TARGET
                     </button>
                  ) : (
                      <div className="flex gap-2 animate-in slide-in-from-top-2 fade-in">
                          <button 
                             onClick={() => setIsSelectingROI(false)}
                             className="bg-zinc-800/90 text-zinc-400 backdrop-blur-md px-3 py-2 rounded-lg text-xs font-bold border border-zinc-600 hover:text-white transition-all"
                          >
                             CANCEL
                          </button>
                          {normalizedROI && (
                            <div className="relative">
                              <button 
                                 onClick={startAnalysis} 
                                 disabled={!cvReady}
                                 className={`px-4 py-2 rounded-lg text-xs font-bold tracking-wider text-white border border-blue-400/50 shadow-xl backdrop-blur-md flex items-center gap-2 ${cvReady ? 'bg-blue-600 hover:bg-blue-500' : 'bg-zinc-600 cursor-not-allowed'}`}
                              >
                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                 {cvReady ? 'START TRACKING' : (cvLoadingError ? 'CORE ERROR' : 'LOADING...')}
                              </button>
                              {cvLoadingError && !cvReady && (
                                  <div className="absolute top-full mt-2 right-0 w-48 text-[10px] text-red-400 bg-black/80 p-2 rounded border border-red-500/30">
                                      Vision engine failed to load. Please refresh or check your connection.
                                  </div>
                              )}
                            </div>
                          )}
                      </div>
                  )}
                  {isSelectingROI && !normalizedROI && (
                      <div className="bg-black/60 backdrop-blur text-white text-[10px] px-3 py-1.5 rounded-full border border-yellow-500/30 text-center animate-pulse">
                          Click Center of Plate & Drag Out
                      </div>
                  )}
              </div>
          )}

          {/* ANALYSIS PROGRESS */}
          {analysisState === AnalysisState.ANALYZING && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-50">
                  <div className="bg-black/80 backdrop-blur-md p-6 rounded-2xl border border-yellow-500/30 flex flex-col items-center shadow-2xl">
                      <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <h3 className="text-yellow-400 font-bold tracking-widest text-sm mb-1">ANALYZING</h3>
                      <p className="text-zinc-500 text-[10px] font-mono mb-4">MEDIA-PIPE BIOMECHANICS V2</p>
                      <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                      </div>
                      <span className="text-xs text-zinc-500 mt-2 font-mono">{progress}%</span>
                      
                      <button 
                         onClick={() => {
                             setAnalysisState(AnalysisState.IDLE);
                             isAnalyzingRef.current = false;
                             onResetRef.current?.();
                             onAnalysisCompleteRef.current([]);
                         }} 
                         className="mt-6 text-[10px] text-zinc-500 hover:text-red-400 underline underline-offset-4 tracking-widest"
                      >
                         CANCEL ANALYSIS
                      </button>
                  </div>
              </div>
          )}

          {/* NEW: INDUSTRIAL PLAYBACK CONTROLS (Bottom Center Overlay) */}
          {analysisState === AnalysisState.COMPLETE && (
            <>
              {/* Reset Button (Top Right) */}
              <div className="absolute top-4 right-4 z-20 animate-fade-in group-hover:opacity-100 opacity-0 transition-opacity">
                  <button 
                      onClick={() => {
                          setAnalysisState(AnalysisState.IDLE);
                          setNormalizedROI(null);
                          onResetRef.current?.();
                      }}
                      className="bg-zinc-900/80 backdrop-blur-md text-zinc-400 hover:text-white px-3 py-2 rounded-lg text-xs font-bold border border-zinc-700 shadow-xl flex items-center gap-2 transition-all"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74-2.74L3 12"/></svg>
                      NEW ANALYSIS
                  </button>
              </div>

              {/* Control Bar */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 bg-zinc-900/90 backdrop-blur-md border border-zinc-700/50 rounded-full px-4 py-2 flex items-center gap-4 shadow-2xl animate-fade-in group-hover:opacity-100 opacity-0 transition-opacity duration-300">
                  
                  {/* Step Back */}
                  <button onClick={() => stepFrame(-1)} className="text-zinc-400 hover:text-white transition-colors" title="Previous Frame (Left Arrow / J)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
                  </button>

                  {/* Play/Pause */}
                  <button onClick={togglePlay} className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:bg-yellow-400 transition-colors shadow-lg" title="Play/Pause (Space)">
                      {isPlaying ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                      ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      )}
                  </button>

                  {/* Step Forward */}
                  <button onClick={() => stepFrame(1)} className="text-zinc-400 hover:text-white transition-colors" title="Next Frame (Right Arrow / L)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                  </button>
                  
                  {/* Speed Divider */}
                  <div className="w-px h-4 bg-zinc-700"></div>

                  {/* Sound Control */}
                  <button onClick={() => setIsMuted(!isMuted)} className={`text-zinc-400 hover:text-white transition-colors ${isMuted ? 'opacity-50' : ''}`} title="Toggle Sound">
                      {isMuted ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                      ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      )}
                  </button>

                  <div className="w-px h-4 bg-zinc-700"></div>

                  {/* Speed Control */}
                  <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Speed</span>
                      <select 
                          value={playbackSpeed} 
                          onChange={(e) => changeSpeed(parseFloat(e.target.value))}
                          className="bg-transparent text-white text-xs font-mono font-bold focus:outline-none cursor-pointer hover:text-yellow-400"
                      >
                          <option value={0.25}>0.25x</option>
                          <option value={0.5}>0.5x</option>
                          <option value={1}>1.0x</option>
                          <option value={1.5}>1.5x</option>
                          <option value={2}>2.0x</option>
                      </select>
                  </div>
              </div>
              
              {/* Keyboard Shortcut Hint */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] text-zinc-600 font-mono opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none whitespace-nowrap">
                   Space: Play • Arrows: Step • J/K/L: Edit Mode
              </div>
            </>
          )}

        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-zinc-900/50 transition-colors group">
            <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center border border-zinc-800 group-hover:scale-110 transition-transform shadow-xl">
                 <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 group-hover:text-yellow-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div className="mt-4 text-center">
                <span className="block text-sm font-bold text-zinc-300 group-hover:text-white tracking-wide">TAP TO UPLOAD VIDEO</span>
                <span className="block text-[10px] text-zinc-600 mt-1 uppercase font-bold">Supports iOS .MOV & MP4</span>
            </div>
            <input 
                type="file" 
                accept="video/mp4,video/quicktime,video/*" 
                className="hidden" 
                onChange={handleInternalUpload}
            />
        </label>
      )}
    </div>
  );
});
