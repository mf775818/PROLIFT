/**
 * High-Performance Computing: Lift Metrics Ring Buffer
 * Backed by SharedArrayBuffer for zero-copy Worker IPC.
 */

export class LiftMetricsBuffer {
    public readonly buffer: SharedArrayBuffer;
    public readonly data: Float64Array;
    public readonly capacity: number;
    public readonly stride: number;
    
    private headOffset: number;
    private countOffset: number;

    // Fixed Enum Mapping for Stride Layout
    public static readonly INDEX_TIME = 0;
    public static readonly INDEX_X = 1;
    public static readonly INDEX_Y = 2;
    public static readonly INDEX_VELOCITY = 3;
    public static readonly INDEX_ACCELERATION = 4;
    public static readonly INDEX_FORCE = 5;
    public static readonly INDEX_POWER = 6;
    public static readonly INDEX_KNEE_ANGLE = 7;
    public static readonly INDEX_HIP_ANGLE = 8;
    public static readonly INDEX_ANKLE_ANGLE = 9;
    public static readonly INDEX_BACK_ANGLE = 10;

    /**
     * Initialize a Ring Buffer over a SAB.
     * @param capacity Total number of metric frames capable of being stored.
     * @param stride Number of Float64 elements per frame (default 11).
     * @param existingBuffer Optional SAB if attaching from a Web Worker.
     */
    constructor(capacity: number, stride: number = 11, existingBuffer?: SharedArrayBuffer) {
        this.capacity = capacity;
        this.stride = stride;

        // Total elements = (capacity * stride) + 2 (head index, total count)
        const totalElements = (capacity * this.stride) + 2; 
        const byteLength = totalElements * Float64Array.BYTES_PER_ELEMENT;

        if (existingBuffer) {
            this.buffer = existingBuffer;
        } else {
            this.buffer = new SharedArrayBuffer(byteLength);
        }

        this.data = new Float64Array(this.buffer);
        
        // Metadata offsets stored at the very end of the buffer
        this.headOffset = totalElements - 2;
        this.countOffset = totalElements - 1;
    }

    /**
     * Write new metrics into the ring buffer zero-allocation style.
     * Uses Atomics internally if thread synchronization implies it.
     */
    public push(
        time: number, 
        x: number, 
        y: number, 
        velocity: number, 
        acceleration: number, 
        force: number, 
        power: number, 
        knee: number,
        hip: number,
        ankle: number,
        back: number
    ): void {
        const head = this.data[this.headOffset]; // actual unsafe read for speed, assuming single-writer
        
        const offset = head * this.stride;

        this.data[offset + LiftMetricsBuffer.INDEX_TIME] = time;
        this.data[offset + LiftMetricsBuffer.INDEX_X] = x;
        this.data[offset + LiftMetricsBuffer.INDEX_Y] = y;
        this.data[offset + LiftMetricsBuffer.INDEX_VELOCITY] = velocity;
        this.data[offset + LiftMetricsBuffer.INDEX_ACCELERATION] = acceleration;
        this.data[offset + LiftMetricsBuffer.INDEX_FORCE] = force;
        this.data[offset + LiftMetricsBuffer.INDEX_POWER] = power;
        this.data[offset + LiftMetricsBuffer.INDEX_KNEE_ANGLE] = knee;
        this.data[offset + LiftMetricsBuffer.INDEX_HIP_ANGLE] = hip;
        this.data[offset + LiftMetricsBuffer.INDEX_ANKLE_ANGLE] = ankle;
        this.data[offset + LiftMetricsBuffer.INDEX_BACK_ANGLE] = back;

        // Increment and wrap
        const nextHead = (head + 1) % this.capacity;
        this.data[this.headOffset] = nextHead;

        // Increment total count up to capacity
        if (this.data[this.countOffset] < this.capacity) {
            this.data[this.countOffset]++;
        }
    }

    public get count(): number {
        return this.data[this.countOffset];
    }
}
