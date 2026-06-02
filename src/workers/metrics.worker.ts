import { LiftMetricsBuffer } from '../lib/hpc/LiftMetricsBuffer';
import { CalibrationEngineHPC } from '../lib/hpc/CalibrationEngineHPC';
import { TrackingBuffer } from '../lib/hpc/TrackingBuffer';
import { PhysicsEngineHPC } from '../lib/hpc/PhysicsEngineHPC';
import { RobustKalmanFilter } from '../lib/hpc/RobustKalmanFilter';
import { OneEuroFilter } from '../lib/hpc/OneEuroFilter';

// Prevent TypeScript from complaining about `self`
const _self = self as unknown as Worker;

const calibrationEngine = new CalibrationEngineHPC();
let trackingBuffer: TrackingBuffer | null = null;
const physicsEngine = new PhysicsEngineHPC();
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
        case 'INIT_WORKER': {
            barbellMass = payload?.barbellMass || 20;
            trackingBuffer = new TrackingBuffer(5000); // 獨立的內部 Track Buffer
            
            // RKF Filter for Barbell Y (Height):
            rkfY = new RobustKalmanFilter(0.001, 0.01); 
            oneEuroKnee = new OneEuroFilter(1.0, 0.01, 1.0);
            oneEuroHip = new OneEuroFilter(1.0, 0.01, 1.0);
            oneEuroAnkle = new OneEuroFilter(1.0, 0.01, 1.0);
            oneEuroBack = new OneEuroFilter(1.0, 0.01, 1.0);
            
            lastTime = 0;
            console.log("Worker: Pipeline initialized.");
            break;
        }

        case 'CALIBRATE': {
            // payload = { hMatrix: number[] }
            calibrationEngine.updateHomography(payload.hMatrix);
            break;
        }

        case 'PROCESS_FRAME': {
            if (!trackingBuffer || !rkfY) return;
            // ... wait, if we do frame by frame processing in the worker, the main thread needs to wait?
            // Actually, for heavy lifting, the worker can do the full O(N) pass at the end instead!
            break;
        }

        case 'FINISH_VIDEO': {
            // 離線 O(N) 雙向濾波精算 & 動力學計算
            const trackingData = payload.trackingData; // { x: Float64Array, y: ..., head: number }
            barbellMass = payload.barbellMass;

            if (!trackingData || trackingData.head === 0) return;
            console.log("Worker: Video Finished. Running O(N) Offline Butterworth Pass...");
            
            // Reconstruct TrackingBuffer locally
            const tb = new TrackingBuffer(trackingData.head);
            for(let i=0; i<trackingData.head; i++) {
                 tb.push(
                     trackingData.x[i], trackingData.y[i], 0, trackingData.t[i],
                     trackingData.kneeAngle[i], trackingData.hipAngle[i], trackingData.ankleAngle[i], trackingData.backAngle[i],
                     trackingData.lKneeAngle[i], trackingData.rKneeAngle[i], trackingData.lHipAngle[i], trackingData.rHipAngle[i],
                     trackingData.lAnkleAngle[i], trackingData.rAnkleAngle[i]
                 );
            }

            const outKinetics = new Float32Array(tb.head * 4);
            const outKnee = new Float32Array(tb.head);
            const outHip = new Float32Array(tb.head);
            const outAnkle = new Float32Array(tb.head);
            const outBack = new Float32Array(tb.head);
            const outLKnee = new Float32Array(tb.head);
            const outRKnee = new Float32Array(tb.head);
            const outLHip = new Float32Array(tb.head);
            const outRHip = new Float32Array(tb.head);
            const outLAnkle = new Float32Array(tb.head);
            const outRAnkle = new Float32Array(tb.head);

            physicsEngine.computeKinetics(tb, outKinetics, barbellMass);
            physicsEngine.smoothAngles(tb, outKnee, outHip, outAnkle, outBack, outLKnee, outRKnee, outLHip, outRHip, outLAnkle, outRAnkle);

            _self.postMessage({ 
                type: 'OFFLINE_ANALYSIS_COMPLETE', 
                kinetics: outKinetics,
                angles: {
                    knee: outKnee, hip: outHip, ankle: outAnkle, back: outBack,
                    lKnee: outLKnee, rKnee: outRKnee, lHip: outLHip, rHip: outRHip,
                    lAnkle: outLAnkle, rAnkle: outRAnkle
                }
            });
            break;
        }
    }
};
