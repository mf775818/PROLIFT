import { LiftMetricsBuffer } from '../lib/hpc/LiftMetricsBuffer';
import { CalibrationEngine } from '../lib/hpc/CalibrationEngine';
import { TrackingBuffer } from '../lib/hpc/TrackingBuffer';
import { PhysicsEngineHPC } from '../lib/hpc/PhysicsEngineHPC';
import { KalmanSmoother1D } from '../lib/hpc/KalmanSmoother';

// Prevent TypeScript from complaining about `self`
const _self = self as unknown as Worker;

let metricsBuffer: LiftMetricsBuffer | null = null;
const calibrationEngine = new CalibrationEngine();
let trackingBuffer: TrackingBuffer | null = null;
let kalmanY: KalmanSmoother1D | null = null;
let outKinetics: Float32Array | null = null;
let barbellMass = 20;

const DELAY_FRAMES = 5; // 延遲緩衝幀數，配合零相位平滑視窗
let processedHead = 0; // 已處理並寫入 LiftMetricsBuffer 的指標

// Pre-allocated array for reading transformed coords
const physicalCoords = new Float64Array(2);

_self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT_SAB': {
            // Receive SharedArrayBuffer from Main Thread Zero-Copy
            const sab = (payload?.sab || payload) as SharedArrayBuffer;
            barbellMass = payload?.barbellMass || 20;
            metricsBuffer = new LiftMetricsBuffer(1000, 8, sab);
            trackingBuffer = new TrackingBuffer(1000); // 獨立的內部 Track Buffer
            kalmanY = new KalmanSmoother1D(0, 1e-3, 1e-1); // 輕量級即時濾波參數
            outKinetics = new Float32Array(4000);
            processedHead = 0;
            console.log("Worker: Mounted SharedArrayBuffer successfully with delayed HPC pipeline.");
            break;
        }

        case 'CALIBRATE': {
            // payload = { srcPts: number[], dstPts: number[] }
            calibrationEngine.calibrate(payload.srcPts, payload.dstPts);
            break;
        }

        case 'PROCESS_FRAME': {
            if (!metricsBuffer || !trackingBuffer || !kalmanY || !outKinetics) return;
            
            const { time, pixelX, pixelY } = payload;

            // 1. 即時轉換從 Pixels 空間到 3D Physical Space
            calibrationEngine.applyTransform(physicalCoords, pixelX, pixelY);
            const physX = physicalCoords[0];
            const rawPhysY = physicalCoords[1];

            // 2. 活化卡爾曼濾波 (Activate Kalman)
            // 推入 TrackingBuffer 前，用卡爾曼濾波進行即時去噪，拯救後續的微分放大效應
            // 如果是第一幀，重置濾波器初始值
            if (trackingBuffer.head === 0) {
                kalmanY = new KalmanSmoother1D(rawPhysY, 1e-3, 1e-1);
            }
            const smoothPhysY = kalmanY.update(rawPhysY);

            trackingBuffer.push(physX, smoothPhysY, 0, time);

            // 3. 延遲處理與並行校正 (Delay Buffer Pipeline)
            // 當緩衝達到特定長度時，透過 PhysicsEngineHPC 計算落後幀
            if (trackingBuffer.head >= processedHead + DELAY_FRAMES) {
                // 重算這整段序列的動力學 (因為零相位濾波需要未來幀)
                PhysicsEngineHPC.computeKinetics(trackingBuffer, outKinetics, barbellMass);
                
                // 將已經確定不受邊界變動影響的落後幀，正式寫入 SharedArrayBuffer
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

                    // 寫入 SAB (透過 Atomicity 或是純 RingBuffer 寫入)
                    metricsBuffer.push(t, x, y, vel, accel, force, power, 90);
                    processedHead++;
                }
            }
            
            break;
        }
    }
};
