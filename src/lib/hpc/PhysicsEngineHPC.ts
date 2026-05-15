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
      const v = Math.abs(rawVel[i]);
      const a = Math.abs(rawAccel[i]);

      // 【工業級優化：運動科學二維自適應核心】
      // 使用者需求：加速度高時視窗須指數下行以捕捉峰值 (capture Second Pull explosion)
      const v_crit = 0.8;      // 速度臨界點 (捕捉發力期)
      const w_max = 11.0;     // 靜止期：最大量平滑消除像素顫動
      const w_min = 3.0;      // 爆發期：最小量延遲，保留原始加速度峰值
      
      // 複合強度因子 (Composite intensity factor)
      // 加權速度與加速度，對爆發力進行超敏感響應
      const intensity = (v * 0.6) + (Math.max(0, a - 5) / 15.0) * 0.4;
      
      // 二維 Sigmoid 自適應函數
      const sigmoid_mid = 0.5;
      const sigmoid_k = 10.0;
      let ew = w_min + (w_max - w_min) / (1.0 + Math.exp(sigmoid_k * (intensity - sigmoid_mid)));
      
      // 雜訊門檻：若加速度超過 60 (非人類物理極限)，視為 AI 誤判
      if (a > 60.0) ew = Math.max(ew, 13);

      const dynamicWindowSize = Math.max(3, Math.min(15, Math.round(ew) | 1));
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

  /**
   * 📐 工業級關節角度平滑引擎 (1€ + Sigmoid 零相位濾波)
   */
  public static smoothAngles(
    inputBuffer: TrackingBuffer,
    outKnee: Float32Array,
    outHip: Float32Array,
    outAnkle: Float32Array,
    outBack: Float32Array
  ): void {
    const { kneeAngle, hipAngle, ankleAngle, backAngle, t, head: len } = inputBuffer;
    if (len < 5) return;

    // 我們使用槓鈴的高度速度作為「全域運動活躍度」來調節所有關節的觀測視窗
    // 這是基於運動鏈 (Kinetic Chain) 原理，槓鈴爆發時關節角速度通常也最高
    const rawVelY = new Float32Array(len);
    for (let i = 1; i < len - 1; i++) {
      rawVelY[i] = Math.abs((inputBuffer.y[i + 1] - inputBuffer.y[i - 1]) / (t[i + 1] - t[i - 1] || 0.01));
    }

    const arrays = [kneeAngle, hipAngle, ankleAngle, backAngle];
    const outputs = [outKnee, outHip, outAnkle, outBack];

    for (let axis = 0; axis < 4; axis++) {
      const raw = arrays[axis];
      const out = outputs[axis];

      for (let i = 0; i < len; i++) {
        const v = rawVelY[i]; // 參考全域速度
        
        // Sigmoid 視窗映射
        const v_crit = 0.4;
        const k_slope = 10.0;
        const w_max = 11.0;
        const w_min = 5.0;
        const exactWindowSize = w_min + (w_max - w_min) / (1.0 + Math.exp(k_slope * (v - v_crit)));
        
        const dynamicWindowSize = Math.max(5, Math.min(13, Math.round(exactWindowSize) | 1));
        const halfWin = Math.floor(dynamicWindowSize / 2);

        let sum = 0;
        let count = 0;
        const startIdx = Math.max(0, i - halfWin);
        const endIdx = Math.min(len - 1, i + halfWin);
        for (let j = startIdx; j <= endIdx; j++) {
            sum += raw[j];
            count++;
        }
        out[i] = sum / count;
      }
    }
  }
}
