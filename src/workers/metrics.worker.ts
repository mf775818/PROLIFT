import { LiftMetricsBuffer } from '../lib/hpc/LiftMetricsBuffer';
import { CalibrationEngine } from '../lib/hpc/CalibrationEngine';

// Prevent TypeScript from complaining about `self`
const _self = self as unknown as Worker;

let metricsBuffer: LiftMetricsBuffer | null = null;
const calibrationEngine = new CalibrationEngine();

// Pre-allocated array for reading transformed coords
const physicalCoords = new Float64Array(2);

_self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT_SAB': {
            // Receive SharedArrayBuffer from Main Thread Zero-Copy
            const sab = payload as SharedArrayBuffer;
            metricsBuffer = new LiftMetricsBuffer(1000, 8, sab);
            console.log("Worker: Mounted SharedArrayBuffer successfully.");
            break;
        }

        case 'CALIBRATE': {
            // payload = { srcPts: number[], dstPts: number[] }
            calibrationEngine.calibrate(payload.srcPts, payload.dstPts);
            break;
        }

        case 'PROCESS_FRAME': {
            if (!metricsBuffer) return;
            
            const { time, pixelX, pixelY } = payload;

            // 1. Transform from Pixels space to 3D Physical Space instantly
            calibrationEngine.applyTransform(physicalCoords, pixelX, pixelY);
            const physX = physicalCoords[0];
            const physY = physicalCoords[1];

            // 2. Perform compute-heavy kinematic derivatives here (Velocity, Accel, etc)
            // (Mocking derivatives for demonstration)
            const velocity = Math.abs(physY) * 0.1;
            const accel = velocity * 0.5;
            const force = accel * 20; // F = ma
            const power = force * velocity;
            const angle = 90;

            // 3. Write directly into Shared Memory - NO postMessage needed!
            metricsBuffer.push(time, physX, physY, velocity, accel, force, power, angle);
            
            // Note: Main thread can just read the buffer without waiting for an event.
            // A lightweight ping could be sent if React needs to trigger a render.
            break;
        }
    }
};
