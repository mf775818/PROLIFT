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
    const { x, y, head } = buffer;
    const m = this.homographyMatrix;

    // 提取矩陣參數到寄存器
    const m0 = m[0], m1 = m[1], m2 = m[2];
    const m3 = m[3], m4 = m[4], m5 = m[5];
    const m6 = m[6], m7 = m[7], m8 = m[8];

    // 高速連續訪問循環
    for (let i = 0; i < head; i++) {
      const xi = x[i];
      const yi = y[i];

      // 矩陣乘法展開
      const nx = m0 * xi + m1 * yi + m2;
      const ny = m3 * xi + m4 * yi + m5;
      const w  = m6 * xi + m7 * yi + m8;

      const invW = w !== 0 ? 1.0 / w : 1.0;

      // 原地回寫到連續內存區塊
      x[i] = nx * invW;
      y[i] = ny * invW;
    }
  }
}
