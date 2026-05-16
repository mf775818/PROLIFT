import { LiftMetricsBuffer } from '../lib/hpc/LiftMetricsBuffer';
import { CalibrationEngine } from '../lib/hpc/CalibrationEngine';
import { TrackingBuffer } from '../lib/hpc/TrackingBuffer';
import { PhysicsEngineHPC } from '../lib/hpc/PhysicsEngineHPC';
import { RobustKalmanFilter } from '../lib/hpc/RobustKalmanFilter';

// Prevent TypeScript from complaining about `self`
const _self = self as unknown as Worker;

let metricsBuffer: LiftMetricsBuffer | null = null;
const calibrationEngine = new CalibrationEngine();
let trackingBuffer: TrackingBuffer | null = null;
let rkfY: RobustKalmanFilter | null = null;
let oneEuroKnee: OneEuroFilter | null = null;
let oneEuroHip: OneEuroFilter | null = null;
let oneEuroAnkle: OneEuroFilter | null = null;
let oneEuroBack: OneEuroFilter | null = null;

let outKinetics: Float32Array | null = null;
let outKnee: Float32Array | null = null;
let outHip: Float32Array | null = null;
let outAnkle: Float32Array | null = null;
let outBack: Float32Array | null = null;

let barbellMass = 20;

const DELAY_FRAMES = 5; // 延遲緩衝幀數，配合零相位平滑視窗
let processedHead = 0; // 已處理並寫入 LiftMetricsBuffer 的指標
let lastTime = 0;

// Pre-allocated array for reading transformed coords
const physicalCoords = new Float64Array(2);

_self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT_SAB': {
            // Receive SharedArrayBuffer from Main Thread Zero-Copy
            const sab = (payload?.sab || payload) as SharedArrayBuffer;
            barbellMass = payload?.barbellMass || 20;
            metricsBuffer = new LiftMetricsBuffer(1000, 11, sab);
            trackingBuffer = new TrackingBuffer(1000); // 獨立的內部 Track Buffer
            
            // RKF Filter for Barbell Y (Height):
            // Default parameters: processNoise=0.001, measureNoise=0.01
            // Provides built-in Gating (Outlier Rejection) to handle video jump noise.
            rkfY = new RobustKalmanFilter(0.001, 0.01); 
            oneEuroKnee = new OneEuroFilter(1.0, 0.01, 1.0);
            oneEuroHip = new OneEuroFilter(1.0, 0.01, 1.0);
            oneEuroAnkle = new OneEuroFilter(1.0, 0.01, 1.0);
            oneEuroBack = new OneEuroFilter(1.0, 0.01, 1.0);
            
            outKinetics = new Float32Array(4000);
            outKnee = new Float32Array(1000);
            outHip = new Float32Array(1000);
            outAnkle = new Float32Array(1000);
            outBack = new Float32Array(1000);

            processedHead = 0;
            lastTime = 0;
            console.log("Worker: Mounted SharedArrayBuffer with Industrial 1€ + Sigmoid pipeline.");
            break;
        }

        case 'CALIBRATE': {
            // payload = { srcPts: number[], dstPts: number[] }
            calibrationEngine.calibrate(payload.srcPts, payload.dstPts);
            break;
        }

        case 'PROCESS_FRAME': {
            if (!metricsBuffer || !trackingBuffer || !rkfY || !outKinetics) return;
            if (!outKnee || !outHip || !outAnkle || !outBack) return;
            
            const { time, pixelX, pixelY, knee, hip, ankle, back } = payload;

            // 1. 即時轉換從 Pixels 空間到 3D Physical Space
            calibrationEngine.applyTransform(physicalCoords, pixelX, pixelY);
            const physX = physicalCoords[0];
            const rawPhysY = physicalCoords[1];

            // 2. RKF Filter 前置去噪 (取代 1€)
            const dt = lastTime > 0 ? (time - lastTime) : (1/30);
            lastTime = time;
            
            const smoothPhysY = rkfY.filter(rawPhysY, dt);
            const sKnee = oneEuroKnee!.filter(knee || 0, dt);
            const sHip = oneEuroHip!.filter(hip || 0, dt);
            const sAnkle = oneEuroAnkle!.filter(ankle || 0, dt);
            const sBack = oneEuroBack!.filter(back || 0, dt);

            trackingBuffer.push(physX, smoothPhysY, 0, time, sKnee, sHip, sAnkle, sBack);

            // 3. 延遲處理與並行校正 (Delay Buffer Pipeline)
            if (trackingBuffer.head >= processedHead + DELAY_FRAMES) {
                // 重算動力學
                PhysicsEngineHPC.computeKinetics(trackingBuffer, outKinetics, barbellMass);
                // 重算平滑角度 (Industrial 1€ + Sigmoid)
                PhysicsEngineHPC.smoothAngles(trackingBuffer, outKnee, outHip, outAnkle, outBack);
                
                while (processedHead < trackingBuffer.head - (DELAY_FRAMES - 1)) {
                    const idx = processedHead;
                    const x = trackingBuffer.x[idx];
                    const y = trackingBuffer.y[idx];
                    const t = trackingBuffer.t[idx];
                    
                    const kOff = idx * 4;
                    const vel = outKinetics[kOff];
                    const accel = outKinetics[kOff + 1];
                    const force = outKinetics[kOff + 2];
                    const power = outKinetics[kOff + 3];

                    const sk = outKnee[idx];
                    const sh = outHip[idx];
                    const sa = outAnkle[idx];
                    const sb = outBack[idx];

                    // 寫入 SAB (現在 stride 為 11)
                    metricsBuffer.push(t, x, y, vel, accel, force, power, sk, sh, sa, sb);
                    processedHead++;
                }
            }
            
            break;
        }
    }
};
