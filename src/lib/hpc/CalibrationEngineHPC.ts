import { TrackingBuffer } from './TrackingBuffer';

export class CalibrationEngineHPC {
  // 3x3 單應性矩陣 (Homography Matrix) 以一維陣列儲存以利 CPU 快取
  private homographyMatrix: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);

  /**
   * 更新透視矩陣 (可由 OpenCV findHomography 算出演算結果傳入)
   */
  public updateHomography(matrix: number[]): void {
    for (let i = 0; i < 9; i++) {
      this.homographyMatrix[i] = matrix[i];
    }
  }

  /**
   * 批次轉換：將整個 Buffer 的點位在 O(N) 內完成三維校正
   * 方法論：Data-Oriented Design, Loop Unrolling
   */
  public applyPerspectiveTransform(buffer: TrackingBuffer): void {
    const data = buffer.data;
    const len = buffer.head;
    const m = this.homographyMatrix;

    // 將區域變數提至迴圈外，幫助 JIT 編譯器進行 Register Allocation
    let x, y, z, w, nx, ny;

    for (let i = 0; i < len; i++) {
      const offset = i * 4;
      x = data[offset];
      y = data[offset + 1];
      z = data[offset + 2]; // 保留供真實 3D 使用

      // 矩陣乘法展開 (Matrix Multiplication Unrolling)
      // [x', y', w'] = H * [x, y, 1]
      nx = m[0] * x + m[1] * y + m[2];
      ny = m[3] * x + m[4] * y + m[5];
      w  = m[6] * x + m[7] * y + m[8];

      // 避免除以零的硬體中斷
      const invW = w !== 0 ? 1.0 / w : 1.0;

      // 原地覆寫，達成 Zero-Allocation
      data[offset] = nx * invW;
      data[offset + 1] = ny * invW;
      // Z 軸在多鏡頭立體視覺中會透過對極幾何 (Epipolar) 重新計算
    }
  }
}
