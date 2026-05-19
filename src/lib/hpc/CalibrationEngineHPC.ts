import { TrackingBuffer } from './TrackingBuffer';

export class CalibrationEngineHPC {
  // 3x3 單應性矩陣 (Homography Matrix) 以一維陣列儲存以利 CPU 快取
  private homographyMatrix: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);

  // 用於高斯消去的預分配記憶體 (避免 GC)
  private matrixA: Float64Array = new Float64Array(8 * 9); 

  /**
   * 更新透視矩陣 (可由 OpenCV findHomography 算出演算結果傳入)
   */
  public updateHomography(matrix: number[]): void {
    for (let i = 0; i < 9; i++) {
      this.homographyMatrix[i] = matrix[i];
    }
  }

  public getHomography(): Float32Array {
      return this.homographyMatrix;
  }

  /**
   * [新增] 核心 DLT 求解器 (Direct Linear Transformation)
   * 傳入畫面上的 4 點 (畸變四邊形) 與 現實對應的 4 點 (完美矩形)
   * srcPts: [u0, v0, u1, v1, u2, v2, u3, v3] (前上, 後上, 後下, 前下 的像素座標)
   * dstPts: [x0, y0, x1, y1, x2, y2, x3, y3] (對應的真實物理座標，可自訂比例)
   */
  public computeHomographyFrom4Points(srcPts: Float32Array | number[], dstPts: Float32Array | number[]): boolean {
    this.matrixA.fill(0);
    const A = this.matrixA;

    // 建立 8x9 矩陣
    for (let i = 0; i < 4; i++) {
      const u = srcPts[i * 2], v = srcPts[i * 2 + 1];
      const x = dstPts[i * 2], y = dstPts[i * 2 + 1];
      
      const row1 = i * 18; // 2 * i * 9
      A[row1 + 0] = -u; A[row1 + 1] = -v; A[row1 + 2] = -1;
      A[row1 + 3] = 0;  A[row1 + 4] = 0;  A[row1 + 5] = 0;
      A[row1 + 6] = u * x; A[row1 + 7] = v * x; A[row1 + 8] = x;

      const row2 = row1 + 9;
      A[row2 + 0] = 0;  A[row2 + 1] = 0;  A[row2 + 2] = 0;
      A[row2 + 3] = -u; A[row2 + 4] = -v; A[row2 + 5] = -1;
      A[row2 + 6] = u * y; A[row2 + 7] = v * y; A[row2 + 8] = y;
    }

    // 簡易高斯消去法解 Ah = 0 (固定 H[8] = 1)
    for (let i = 0; i < 8; i++) {
      // 找最大主元 (Pivoting)
      let maxRow = i;
      let maxVal = Math.abs(A[i * 9 + i]);
      for (let j = i + 1; j < 8; j++) {
        let val = Math.abs(A[j * 9 + i]);
        if (val > maxVal) { maxVal = val; maxRow = j; }
      }
      if (maxVal < 1e-10) return false; // 矩陣奇異 (點重合或共線)

      // 交換行
      if (maxRow !== i) {
        for (let k = i; k < 9; k++) {
          let tmp = A[i * 9 + k];
          A[i * 9 + k] = A[maxRow * 9 + k];
          A[maxRow * 9 + k] = tmp;
        }
      }

      // 消去
      for (let j = i + 1; j < 8; j++) {
        let factor = A[j * 9 + i] / A[i * 9 + i];
        for (let k = i; k < 9; k++) {
          A[j * 9 + k] -= factor * A[i * 9 + k];
        }
      }
    }

    // 回代求解 H
    const H = new Float64Array(9);
    H[8] = 1.0;
    for (let i = 7; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < 9; j++) {
        sum += A[i * 9 + j] * H[j];
      }
      H[i] = -sum / A[i * 9 + i];
    }

    // 更新到實例的 Homography Matrix
    for (let i = 0; i < 9; i++) this.homographyMatrix[i] = H[i];
    return true;
  }

  /**
   * 將單一點轉換到真實物理空間
   */
  public applyTransform(out: Float64Array | Float32Array, x: number, y: number): void {
    const m = this.homographyMatrix;
    const nx = m[0] * x + m[1] * y + m[2];
    const ny = m[3] * x + m[4] * y + m[5];
    const w  = m[6] * x + m[7] * y + m[8];

    const invW = w !== 0 ? 1.0 / w : 1.0;
    out[0] = nx * invW;
    out[1] = ny * invW;
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
