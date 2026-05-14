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

    // 2. 預計算初步的動力學特徵，用於判斷「動態自適應濾波器 (Adaptive Smoothing)」的視窗長度
    for (let i = 1; i < len - 1; i++) {
      const dt = t[i + 1] - t[i - 1];
      const dtClamped = Math.max(dt, 1e-5);
      rawVel[i] = (y[i + 1] - y[i - 1]) / dtClamped;
    }
    rawVel[0] = rawVel[1];
    rawVel[len - 1] = rawVel[len - 2];

    for (let i = 1; i < len - 1; i++) {
        const dt = t[i + 1] - t[i - 1];
        const dtClamped = Math.max(dt, 1e-5);
        rawAccel[i] = (rawVel[i + 1] - rawVel[i - 1]) / dtClamped;
    }
    rawAccel[0] = rawAccel[1];
    rawAccel[len - 1] = rawAccel[len - 2];

    // 3. 第一階段：零相位低通濾波 (Zero-Phase Low-Pass Filtering) - 搭配動態自適應視窗
    const smoothY = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const currentVel = Math.abs(rawVel[i]);
      const currentAccel = Math.abs(rawAccel[i]);

      // [核心突破]: 物理防呆與平滑度自適應
      // 人類舉重極限速度約為 2-3 m/s，這裡容許到 3.5 m/s。
      // 當超出這個範圍，絕對是因為像素點抖動 (Tracking Jitter) 或相機 FPS 誤差產生的無物理意義瞬移。
      // 我們不允許它產生破萬的 Power 虛假峰值，因此直接給予強力平滑 (Window=9) 抑制它。
      const MAX_PLAUSIBLE_VEL = 3.5;
      const MAX_PLAUSIBLE_ACCEL = 30.0;
      
      let dynamicWindowSize = 5;
      
      if (currentVel > MAX_PLAUSIBLE_VEL || currentAccel > MAX_PLAUSIBLE_ACCEL) {
          // 出現非物理跳躍，強力強壓制
          dynamicWindowSize = 9;
      } else {
          // 【運動科學：Winter (2009) 截斷頻率理論】
          // 人類隨意運動的有效頻率極少超過 5Hz。在 30fps 下，Window=5 約等價於 5Hz 的低通濾波。
          // 若降至 Window=3 (約 10Hz)，會讓 AI 動態模糊產生的「高頻空間雜訊」被二次微分放大，
          // 導致功率圖出現物理上不可能的「鋸齒狀三連峰 (Shark-fins)」。
          
          // 解法：引入 Logistic Sigmoid S型函數，將平滑視窗「鎖死最低為 5」。
          // 在靜止/低速區，提升至 9 完全壓平 AI 微抖動；
          // 在大發力高速區，平滑過渡並貼地飛行於 5，過濾高頻噪聲同時完美保留爆發力真實峰值。
          const v = Math.abs(currentVel);
          const w_min = 5.0; // 絕對物理下限
          const w_range = 4.0; // 活動範圍 (從 5 爬升到 9)
          const slope = 5.0; // Sigmoid 的下降斜率敏感度
          const v_mid = 0.3; // Sigmoid 的反曲點 (m/s)
          
          // Sigmoid Mapping: v=0 -> window 近似 9, v>1.0 -> window 近似 5
          const exactWindow = w_min + w_range / (1.0 + Math.exp(slope * (v - v_mid)));
          
          // 強制轉換為 5, 7, 9 的奇數視窗 (bitwise OR 1 保證奇數)
          dynamicWindowSize = Math.max(5, Math.min(9, Math.round(exactWindow) | 1));
      }

      const halfWin = Math.floor(dynamicWindowSize / 2);
      
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
