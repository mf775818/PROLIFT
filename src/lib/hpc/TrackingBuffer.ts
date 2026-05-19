export class TrackingBuffer {
  public readonly buffer: SharedArrayBuffer | ArrayBuffer;
  public readonly x: Float32Array;
  public readonly y: Float32Array;
  public readonly z: Float32Array;
  public readonly t: Float32Array;
  public readonly kneeAngle: Float32Array;
  public readonly hipAngle: Float32Array;
  public readonly ankleAngle: Float32Array;
  public readonly backAngle: Float32Array;
  public readonly lKneeAngle: Float32Array;
  public readonly rKneeAngle: Float32Array;
  public readonly lHipAngle: Float32Array;
  public readonly rHipAngle: Float32Array;
  public readonly lAnkleAngle: Float32Array;
  public readonly rAnkleAngle: Float32Array;
  
  public readonly capacity: number;
  private readonly meta: Int32Array; // 儲存 head 等元數據

  constructor(maxFrames: number = 3000, existingBuffer?: SharedArrayBuffer | ArrayBuffer) {
    this.capacity = maxFrames;
    const size = maxFrames * 14; // 14 個 float 分量
    const byteLength = size * 4 + 128; // 預留 bytes 給 metadata 與對齊

    this.buffer = existingBuffer || (typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength));
    
    // 手動劃分連續內存區塊
    let offset = 0;
    this.x = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.y = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.z = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.t = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.kneeAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.hipAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.ankleAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.backAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.lKneeAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.rKneeAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.lHipAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.rHipAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.lAnkleAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    this.rAnkleAngle = new Float32Array(this.buffer, offset, maxFrames); offset += maxFrames * 4;
    
    this.meta = new Int32Array(this.buffer, offset, 4);
  }

  public push(
    x: number, y: number, z: number, t: number, 
    knee: number = 0, hip: number = 0, ankle: number = 0, back: number = 0,
    lKnee: number = 0, rKnee: number = 0, lHip: number = 0, rHip: number = 0,
    lAnkle: number = 0, rAnkle: number = 0
  ): void {
    const head = this.meta[0];
    if (head >= this.capacity) return;

    this.x[head] = x;
    this.y[head] = y;
    this.z[head] = z;
    this.t[head] = t;
    this.kneeAngle[head] = knee;
    this.hipAngle[head] = hip;
    this.ankleAngle[head] = ankle;
    this.backAngle[head] = back;
    this.lKneeAngle[head] = lKnee;
    this.rKneeAngle[head] = rKnee;
    this.lHipAngle[head] = lHip;
    this.rHipAngle[head] = rHip;
    this.lAnkleAngle[head] = lAnkle;
    this.rAnkleAngle[head] = rAnkle;

    this.meta[0] = head + 1;
  }

  public get head(): number { return this.meta[0]; }
}
