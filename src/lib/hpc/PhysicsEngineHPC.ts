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

    // 2. 第一階段：零相位低通濾波 (Zero-Phase Low-Pass Filtering)
    // 模擬 WL Analysis 的降噪曲線，使用 5 點滑動平均 (約對應 5Hz 截斷頻率於 30fps)
    const windowSize = 5;
    const halfWin = Math.floor(windowSize / 2);
    
    const smoothY = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let sumY = 0;
      let count = 0;
      const startIdx = Math.max(0, i - halfWin);
      const endIdx = Math.min(len - 1, i + halfWin);
      for (let j = startIdx; j <= endIdx; j++) {
        sumY += y[j];
        count++;
      }
      smoothY[i] = sumY / count;
    }

    // 3. 第二階段：使用「中心差分法」計算平滑後的速度
    const smoothVel = new Float32Array(len);
    for (let i = 1; i < len - 1; i++) {
      const dt = t[i + 1] - t[i - 1];
      const dtClamped = Math.max(dt, 1e-5);
      smoothVel[i] = (smoothY[i + 1] - smoothY[i - 1]) / dtClamped;
    }
    smoothVel[0] = smoothVel[1];
    smoothVel[len - 1] = smoothVel[len - 2];

    // 4. 第三階段：使用「中心差分法」計算平滑後的加速度
    const smoothAccel = new Float32Array(len);
    for (let i = 1; i < len - 1; i++) {
      const dt = t[i + 1] - t[i - 1];
      const dtClamped = Math.max(dt, 1e-5);
      smoothAccel[i] = (smoothVel[i + 1] - smoothVel[i - 1]) / dtClamped;
    }
    smoothAccel[0] = smoothAccel[1];
    smoothAccel[len - 1] = smoothAccel[len - 2];

    // 5. 第四階段：計算物理量 (Force & Power)
    for (let i = 0; i < len; i++) {
      const vel = smoothVel[i];
      const accel = smoothAccel[i];

      // 使用平滑後的加速度計算真實受力
      const force = barbellMass * (this.GRAVITY + accel);
      
      const rawPower = force * vel;
      // 去分支取正功: (x + |x|)/2 = max(0, x)
      const power = (rawPower + Math.abs(rawPower)) * 0.5;

      // 寫入預分配的輸出陣列
      const offset = i * 4;
      outKinetics[offset]     = vel;
      outKinetics[offset + 1] = accel;
      outKinetics[offset + 2] = force;
      outKinetics[offset + 3] = power;
    }
  }
}
