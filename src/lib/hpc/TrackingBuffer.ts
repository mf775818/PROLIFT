export class TrackingBuffer {
  public data: Float32Array;
  public capacity: number;
  public head: number = 0;

  constructor(maxFrames: number = 3000) { // 預設支援 100 秒 (30fps)
    this.capacity = maxFrames;
    this.data = new Float32Array(maxFrames * 4); // 每個幀佔用 4 個 float (16 bytes)
  }

  // O(1) 零分配寫入
  public push(x: number, y: number, z: number, time: number): void {
    if (this.head >= this.capacity) return; // 環形緩衝區或阻擋機制
    const offset = this.head * 4;
    this.data[offset] = x;
    this.data[offset + 1] = y;
    this.data[offset + 2] = z;
    this.data[offset + 3] = time;
    this.head++;
  }
}
