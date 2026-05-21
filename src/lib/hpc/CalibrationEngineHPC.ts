import { TrackingBuffer } from './TrackingBuffer';
import { PerspectiveMath } from './PerspectiveMath';

export class CalibrationEngineHPC {
  // 3x3 單應性矩陣 (Homography Matrix) 以一維陣列儲存以利 CPU 快取
  private readonly homographyMatrix = new Float64Array(9); 
  private readonly homographyMatrixF32 = new Float32Array(9);
  
  private readonly matrixA = new Float64Array(8 * 9);
  private readonly tempH = new Float64Array(9);
  
  // Hartley 正規化所需參數
  private readonly srcNorm = new Float64Array(8);
  private readonly dstNorm = new Float64Array(8);
  private readonly T_src = new Float64Array(9); 
  private readonly T_dst_inv = new Float64Array(9); 
  
  // SVD 所需緩衝區
  private readonly matrixAtA = new Float64Array(9 * 9);
  private readonly matrixV = new Float64Array(9 * 9);

  // PerspectiveMath 實例用於矩陣運算
  private readonly perspectiveMath = new PerspectiveMath();

  public updateHomography(matrix: number[]): void {
    for (let i = 0; i < 9; i++) {
        this.homographyMatrix[i] = matrix[i];
    }
  }

  public getHomography(): Float32Array {
      for (let i = 0; i < 9; i++) {
          this.homographyMatrixF32[i] = this.homographyMatrix[i];
      }
      return this.homographyMatrixF32;
  }

  /**
   * 內部方法：Hartley 等向縮放正規化 (O(1) 效能)
   */
  private normalize(pts: ArrayLike<number>, outNorm: Float64Array, outT: Float64Array, invert: boolean = false): void {
      let cx = 0, cy = 0;
      for (let i = 0; i < 4; i++) {
          cx += pts[i * 2];
          cy += pts[i * 2 + 1];
      }
      cx *= 0.25; cy *= 0.25;

      let avgDist = 0;
      for (let i = 0; i < 4; i++) {
          const dx = pts[i * 2] - cx;
          const dy = pts[i * 2 + 1] - cy;
          avgDist += Math.sqrt(dx * dx + dy * dy);
      }
      avgDist *= 0.25;

      const scale = avgDist > 1e-10 ? Math.SQRT2 / avgDist : 1.0;

      if (invert) {
          outT[0] = 1/scale; outT[1] = 0;       outT[2] = cx;
          outT[3] = 0;       outT[4] = 1/scale; outT[5] = cy;
          outT[6] = 0;       outT[7] = 0;       outT[8] = 1;
      } else {
          outT[0] = scale;   outT[1] = 0;       outT[2] = -scale * cx;
          outT[3] = 0;       outT[4] = scale;   outT[5] = -scale * cy;
          outT[6] = 0;       outT[7] = 0;       outT[8] = 1;
      }

      for (let i = 0; i < 4; i++) {
          outNorm[i * 2] = (pts[i * 2] - cx) * scale;
          outNorm[i * 2 + 1] = (pts[i * 2 + 1] - cy) * scale;
      }
  }
  
  /**
   * 藉由 Jacobi Eigenvalue Algorithm 求解 A^T * A 的最小特徵向量
   */
  private solveSVD_Jacobi(): void {
      const AtA = this.matrixAtA;
      const V = this.matrixV;
      const A = this.matrixA;
      
      AtA.fill(0);
      for (let i = 0; i < 9; i++) {
          for (let j = 0; j < 9; j++) {
              let sum = 0;
              for (let k = 0; k < 8; k++) {
                  sum += A[k * 9 + i] * A[k * 9 + j];
              }
              AtA[i * 9 + j] = sum;
          }
      }

      V.fill(0);
      for (let i = 0; i < 9; i++) V[i * 9 + i] = 1.0;

      const MAX_ITER = 50;
      const EPS = 1e-12;
      for (let iter = 0; iter < MAX_ITER; iter++) {
          let maxVal = 0;
          let p = 0, q = 1;
          for (let i = 0; i < 9; i++) {
              for (let j = i + 1; j < 9; j++) {
                  let val = Math.abs(AtA[i * 9 + j]);
                  if (val > maxVal) { maxVal = val; p = i; q = j; }
              }
          }

          if (maxVal < EPS) break;

          const spp = AtA[p * 9 + p];
          const sqq = AtA[q * 9 + q];
          const spq = AtA[p * 9 + q];
          
          let theta;
          if (sqq === spp) {
             theta = spq > 0 ? Math.PI / 4 : -Math.PI / 4;
          } else {
             theta = 0.5 * Math.atan2(2.0 * spq, sqq - spp);
          }

          const c = Math.cos(theta);
          const s = Math.sin(theta);

          for (let i = 0; i < 9; i++) {
              if (i !== p && i !== q) {
                  const api = AtA[p * 9 + i];
                  const aqi = AtA[q * 9 + i];
                  AtA[p * 9 + i] = c * api - s * aqi;
                  AtA[i * 9 + p] = AtA[p * 9 + i];
                  AtA[q * 9 + i] = s * api + c * aqi;
                  AtA[i * 9 + q] = AtA[q * 9 + i];
              }
          }
          
          AtA[p * 9 + p] = c * c * spp - 2.0 * s * c * spq + s * s * sqq;
          AtA[q * 9 + q] = s * s * spp + 2.0 * s * c * spq + c * c * sqq;
          AtA[p * 9 + q] = 0;
          AtA[q * 9 + p] = 0;

          for (let i = 0; i < 9; i++) {
              const vip = V[i * 9 + p];
              const viq = V[i * 9 + q];
              V[i * 9 + p] = c * vip - s * viq;
              V[i * 9 + q] = s * vip + c * viq;
          }
      }

      let minEval = AtA[0];
      let minIdx = 0;
      for (let i = 1; i < 9; i++) {
          if (AtA[i * 9 + i] < minEval) {
              minEval = AtA[i * 9 + i];
              minIdx = i;
          }
      }

      for (let i = 0; i < 9; i++) {
          this.tempH[i] = V[i * 9 + minIdx];
      }
  }

  public computeHomographyFrom4Points(srcPts: Float32Array | number[], dstPts: Float32Array | number[]): boolean {
    // 1. Hartley 正規化 (解決數值爆炸 BUG)
    this.normalize(srcPts, this.srcNorm, this.T_src, false);
    this.normalize(dstPts, this.dstNorm, this.T_dst_inv, true); 

    this.matrixA.fill(0);
    const A = this.matrixA;

    // 2. 使用正規化後的座標建構 DLT 矩陣
    for (let i = 0; i < 4; i++) {
      const u = this.srcNorm[i * 2], v = this.srcNorm[i * 2 + 1];
      const x = this.dstNorm[i * 2], y = this.dstNorm[i * 2 + 1];
      
      const row1 = i * 18; // 2 * i * 9
      A[row1 + 0] = -u; A[row1 + 1] = -v; A[row1 + 2] = -1;
      A[row1 + 3] = 0;  A[row1 + 4] = 0;  A[row1 + 5] = 0;
      A[row1 + 6] = u * x; A[row1 + 7] = v * x; A[row1 + 8] = x;

      const row2 = row1 + 9;
      A[row2 + 0] = 0;  A[row2 + 1] = 0;  A[row2 + 2] = 0;
      A[row2 + 3] = -u; A[row2 + 4] = -v; A[row2 + 5] = -1;
      A[row2 + 6] = u * y; A[row2 + 7] = v * y; A[row2 + 8] = y;
    }

    // 3. 以 Jacobi SVD 取代單純的高斯消去法，提取特徵向量作為暫存 H (Zero-Allocation)
    this.solveSVD_Jacobi();

    // 4. 去正規化 Denormalization: H_final = T_dst_inv * H * T_src
    this.perspectiveMath.multiplyMat3Mat3(this.homographyMatrix, this.T_dst_inv, this.tempH);
    this.perspectiveMath.multiplyMat3Mat3(this.homographyMatrix, this.homographyMatrix, this.T_src);

    // 確保 H[8] 不為 0 後縮放
    const w = this.homographyMatrix[8];
    if (Math.abs(w) > 1e-10) {
        const invW = 1.0 / w;
        for (let i = 0; i < 9; i++) this.homographyMatrix[i] *= invW;
    }

    return true;
  }

  public applyTransform(out: Float64Array | Float32Array, x: number, y: number): void {
    const m = this.homographyMatrix;
    const nx = m[0] * x + m[1] * y + m[2];
    const ny = m[3] * x + m[4] * y + m[5];
    const w  = m[6] * x + m[7] * y + m[8];

    // 安全除法防護 (Div-By-Zero)
    const invW = Math.abs(w) > 1e-8 ? 1.0 / w : 0;
    out[0] = nx * invW;
    out[1] = ny * invW;
  }

  public applyPerspectiveTransform(buffer: TrackingBuffer): void {
    const { x, y, head } = buffer;
    const m = this.homographyMatrix;

    const m0 = m[0], m1 = m[1], m2 = m[2];
    const m3 = m[3], m4 = m[4], m5 = m[5];
    const m6 = m[6], m7 = m[7], m8 = m[8];

    for (let i = 0; i < head; i++) {
      const xi = x[i];
      const yi = y[i];

      const nx = m0 * xi + m1 * yi + m2;
      const ny = m3 * xi + m4 * yi + m5;
      const w  = m6 * xi + m7 * yi + m8;

      // 安全除法防護 (Div-By-Zero)
      const invW = Math.abs(w) > 1e-8 ? 1.0 / w : 0;
      x[i] = nx * invW;
      y[i] = ny * invW;
    }
  }

  // 為了相容原本的 CalibrationEngine API，增加 calibrate alias
  public calibrate(srcPts: number[], dstPts: number[]): boolean {
    if (srcPts.length !== 8 || dstPts.length !== 8) return false;
    const success = this.computeHomographyFrom4Points(srcPts, dstPts);
    if (!success) {
      this.homographyMatrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    return success;
  }
}
