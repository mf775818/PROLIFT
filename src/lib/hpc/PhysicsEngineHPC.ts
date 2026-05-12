import { TrackingBuffer } from './TrackingBuffer';

export class PhysicsEngineHPC {
  private static readonly GRAVITY = 9.80665;

  /**
   * 🐒C++++ 修正版：生物力學標準動力引擎
   * 採用 中心差分法 (Central Difference) + 零相位平滑 (Zero-Phase Smoothing)
   */
  public static computeKinetics(
    inputBuffer: TrackingBuffer, 
    outKinetics: Float32Array, 
    barbellMass: number
  ): void {
    const { y, t, head: len } = inputBuffer;
    
    // 若幀數過少無法進行差分，直接中斷
    if (len < 3) return;

    // 1. 分配中繼緩存陣列 (HPC 寫法：避免迴圈內創建)
    const rawVel = new Float32Array(len);
    const rawAccel = new Float32Array(len);

    // 2. 第一階段：使用「中心差分法」計算原始速度
    // 捨棄 (curr - prev)/dt，改用 (next - prev) / 2dt 以降低截斷誤差
    for (let i = 1; i < len - 1; i++) {
      const dt = t[i + 1] - t[i - 1];
      const dtClamped = Math.max(dt, 1e-5);
      rawVel[i] = (y[i + 1] - y[i - 1]) / dtClamped;
    }
    // 邊界處理 (複製鄰近值)
    rawVel[0] = rawVel[1];
    rawVel[len - 1] = rawVel[len - 2];

    // 3. 第二階段：使用「中心差分法」計算原始加速度
    for (let i = 1; i < len - 1; i++) {
      const dt = t[i + 1] - t[i - 1];
      const dtClamped = Math.max(dt, 1e-5);
      rawAccel[i] = (rawVel[i + 1] - rawVel[i - 1]) / dtClamped;
    }
    rawAccel[0] = rawAccel[1];
    rawAccel[len - 1] = rawAccel[len - 2];

    // 4. 第三階段：零相位低通濾波 (Zero-Phase Low-Pass Filtering)
    // 模擬 WL Analysis 的降噪曲線，使用 5 點滑動平均 (約對應 5Hz 截斷頻率於 30fps)
    const windowSize = 5;
    const halfWin = Math.floor(windowSize / 2);

    for (let i = 0; i < len; i++) {
      let sumVel = 0;
      let sumAccel = 0;
      let count = 0;

      // 邊界安全防護的滑動視窗
      const startIdx = Math.max(0, i - halfWin);
      const endIdx = Math.min(len - 1, i + halfWin);

      for (let j = startIdx; j <= endIdx; j++) {
        sumVel += rawVel[j];
        sumAccel += rawAccel[j];
        count++;
      }

      // 取得平滑後的動力學參數 (斬斷了虛假的高頻峰值)
      const smoothVel = sumVel / count;
      const smoothAccel = sumAccel / count;

      // 5. 第四階段：計算物理量 (Force & Power)
      // 使用平滑後的加速度計算真實受力
      const force = barbellMass * (this.GRAVITY + smoothAccel);
      
      const rawPower = force * smoothVel;
      // 去分支取正功: (x + |x|)/2 = max(0, x)
      const power = (rawPower + Math.abs(rawPower)) * 0.5;

      // 寫入預分配的輸出陣列
      const offset = i * 4;
      outKinetics[offset]     = smoothVel;
      outKinetics[offset + 1] = smoothAccel;
      outKinetics[offset + 2] = force;
      outKinetics[offset + 3] = power;
    }
  }
}
