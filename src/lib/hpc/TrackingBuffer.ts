export class TrackingBuffer {
  public readonly buffer: SharedArrayBuffer | ArrayBuffer;
  public readonly x: Float32Array;
  public readonly y: Float32Array;
  public readonly z: Float32Array;
  public readonly t: Float32Array;
  
  public readonly capacity: number;
  private readonly meta: Int32Array; // 儲存 head 等元數據

  constructor(maxFrames: number = 3000, existingBuffer?: SharedArrayBuffer | ArrayBuffer) {
    this.capacity = maxFrames;
    const size = maxFrames * 4; // 4 個 float 分量
    const byteLength = size * 4 + 64; // 預留 64 bytes 給 metadata 與對齊

    this.buffer = existingBuffer || (typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength));
    
    // 手動劃分連續內存區塊
    let offset = 0;
    this.x = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.y = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.z = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.t = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    
    this.meta = new Int32Array(this.buffer, offset, 4);
  }

  public push(x: number, y: number, z: number, t: number): void {
    const head = this.meta[0];
    if (head >= this.capacity) return;

    this.x[head] = x;
    this.y[head] = y;
    this.z[head] = z;
    this.t[head] = t;

    this.meta[0] = head + 1;
  }

  public get head(): number { return this.meta[0]; }
}
