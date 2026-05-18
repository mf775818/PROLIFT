import { LiftMetricsBuffer } from '../lib/hpc/LiftMetricsBuffer';
import { CalibrationEngine } from '../lib/hpc/CalibrationEngine';
import { TrackingBuffer } from '../lib/hpc/TrackingBuffer';
import { PhysicsEngineHPC } from '../lib/hpc/PhysicsEngineHPC';
import { RobustKalmanFilter } from '../lib/hpc/RobustKalmanFilter';
import { OneEuroFilter } from '../lib/hpc/OneEuroFilter';

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

let barbellMass = 20;

let lastTime = 0;

// Pre-allocated array for reading transformed coords
const physicalCoords = new Float64Array(2);

// 緩存上一個有效的角度值，防守 0 值陷阱
const lastValidAngles = { knee: 90, hip: 90, ankle: 90, back: 90 };

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
            if (!metricsBuffer || !trackingBuffer || !rkfY) return;
            
            const { time, pixelX, pixelY, knee, hip, ankle, back } = payload;

            // 1. 即時轉換從 Pixels 空間到 3D Physical Space
            calibrationEngine.applyTransform(physicalCoords, pixelX, pixelY);
            const physX = physicalCoords[0];
            const rawPhysY = physicalCoords[1];

            // 更新 Last Valid Value 防守 0 值陷阱
            if (knee !== undefined && knee !== null && !isNaN(knee)) lastValidAngles.knee = knee;
            if (hip !== undefined && hip !== null && !isNaN(hip)) lastValidAngles.hip = hip;
            if (ankle !== undefined && ankle !== null && !isNaN(ankle)) lastValidAngles.ankle = ankle;
            if (back !== undefined && back !== null && !isNaN(back)) lastValidAngles.back = back;

            const dt = lastTime > 0 ? (time - lastTime) : (1/30);
            lastTime = time;
            
            const smoothPhysY = rkfY.filter(rawPhysY, dt);
            const sKnee = oneEuroKnee!.filter(lastValidAngles.knee, dt);
            const sHip = oneEuroHip!.filter(lastValidAngles.hip, dt);
            const sAnkle = oneEuroAnkle!.filter(lastValidAngles.ankle, dt);
            const sBack = oneEuroBack!.filter(lastValidAngles.back, dt);

            trackingBuffer.push(physX, smoothPhysY, 0, time, sKnee, sHip, sAnkle, sBack);

            // 即時 O(1) 動力學估算 (利用差分)
            const idx = trackingBuffer.head - 1;
            let vel = 0, accel = 0, force = 0, power = 0;
            
            if (idx >= 1) {
                const prevY = trackingBuffer.y[idx - 1];
                vel = (smoothPhysY - prevY) / dt; // 簡易即時速度
                // 力與功的即時估算 (假設等速)
                force = barbellMass * 9.81; 
                power = force * Math.max(0, vel); 
            }

            // 直接推入 SAB 供給 UI 即時渲染
            metricsBuffer.push(time, physX, smoothPhysY, vel, accel, force, power, sKnee, sHip, sAnkle, sBack);
            break;
        }

        case 'FINISH_VIDEO': {
            // 離線 O(N) 雙向濾波精算
            if (!trackingBuffer) return;
            console.log("Worker: Video Finished. Running O(N) Offline Butterworth Pass...");
            
            const outKinetics = new Float32Array(trackingBuffer.head * 4);
            const outKnee = new Float32Array(trackingBuffer.head);
            const outHip = new Float32Array(trackingBuffer.head);
            const outAnkle = new Float32Array(trackingBuffer.head);
            const outBack = new Float32Array(trackingBuffer.head);

            PhysicsEngineHPC.computeKinetics(trackingBuffer, outKinetics, barbellMass);
            PhysicsEngineHPC.smoothAngles(trackingBuffer, outKnee, outHip, outAnkle, outBack);

            // 這裡可以選擇將數據回寫 SAB，或者透過 postMessage 傳給主執行緒
            _self.postMessage({ type: 'OFFLINE_ANALYSIS_COMPLETE', head: trackingBuffer.head });
            break;
        }
    }
};
