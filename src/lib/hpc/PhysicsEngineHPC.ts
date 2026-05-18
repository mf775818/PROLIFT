import { TrackingBuffer } from './TrackingBuffer';

export class PhysicsEngineHPC {
  private static readonly GRAVITY = 9.80665;
  private bufferPool: Map<string, Float32Array> = new Map();

  private getBuffer(key: string, requiredLength: number): Float32Array {
      let buf = this.bufferPool.get(key);
      if (!buf || buf.length < requiredLength) {
          const newSize = Math.max(requiredLength, (buf?.length || 1024) * 1.5);
          buf = new Float32Array(newSize);
          this.bufferPool.set(key, buf);
      }
      return buf;
  }

  /**
   * 業界標準：Zero-Lag Butterworth Low-Pass Filter (filtfilt)
   * 用於去除非連續高頻雜訊，維持零相位延遲。
   */
  private filtfilt(data: Float32Array, len: number, dt: number, cutoff: number, outBuffer: Float32Array): void {
    if (len < 5) {
        for(let i=0; i<len; i++) outBuffer[i] = data[i];
        return;
    }
    const fs = 1.0 / dt;
    
    // 如果取樣頻率過低或是 cutoff 超過 Nyquist 頻率，安全回退
    if (cutoff >= fs / 2) {
        for(let i=0; i<len; i++) outBuffer[i] = data[i];
        return;
    }

    const wc = Math.tan(Math.PI * cutoff / fs);
    const wc2 = wc * wc;
    const sqrt2 = Math.SQRT2;
    const c0 = 1 + sqrt2 * wc + wc2;
    const a1 = 2 * (wc2 - 1) / c0;
    const a2 = (1 - sqrt2 * wc + wc2) / c0;
    const b0 = wc2 / c0;
    const b1 = 2 * b0;
    const b2 = b0;

    const forward = this.getBuffer('filt_fwd', len);
    const backward = this.getBuffer('filt_bck', len);

    // 前向濾波 (Forward Pass)
    let x1 = data[0], x2 = data[0], y1 = data[0], y2 = data[0];
    for (let i = 0; i < len; i++) {
        const x0 = data[i];
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        forward[i] = y0;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
    }

    // 反向濾波 (Backward Pass) 消除相位延遲 (Zero-Phase)
    x1 = forward[len-1]; x2 = forward[len-1]; y1 = forward[len-1]; y2 = forward[len-1];
    for (let i = len - 1; i >= 0; i--) {
        const x0 = forward[i];
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        backward[i] = y0;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
    }
    
    for(let i=0; i<len; i++) outBuffer[i] = backward[i];
  }

  /**
   * 🐒C++++ 修正版：生物力學標準動力引擎 (Butterworth filtfilt 雙向濾波)
   */
  public computeKinetics(
    inputBuffer: TrackingBuffer, 
    outKinetics: Float32Array, 
    barbellMass: number
  ): void {
    const { y, t, head: len } = inputBuffer;
    
    // 若幀數過少無法進行差分與過濾，直接中斷
    if (len < 5) return;

    // 1. 計算平均取樣時間 (dt)
    let totalTime = t[len - 1] - t[0];
    let avgDt = Math.max(totalTime / (len - 1), 0.016); // 最低保護確保合理 fs

    // 2. 獲取原始高度軌跡的陣列切片
    const rawY = this.getBuffer('rawY', len);
    for (let i = 0; i < len; i++) rawY[i] = y[i];

    // --- 運動科學標準：位移訊號低通濾波 (對抗 MediaPipe 座標抖動) ---
    const smoothY = this.getBuffer('smoothY', len);
    this.filtfilt(rawY, len, avgDt, 7.0, smoothY);

    // 3. 一階微分：計算速度
    const rawVel = this.getBuffer('rawVel', len);
    for (let i = 1; i < len - 1; i++) {
      const dtClamped = Math.max(t[i + 1] - t[i - 1], 1e-5);
      rawVel[i] = (smoothY[i + 1] - smoothY[i - 1]) / dtClamped;
    }
    rawVel[0] = rawVel[1];
    rawVel[len - 1] = rawVel[len - 2];

    // 微分會放大雜訊
    const smoothVel = this.getBuffer('smoothVel', len);
    this.filtfilt(rawVel, len, avgDt, 5.0, smoothVel);

    // 4. 二階微分：計算加速度
    const rawAccel = this.getBuffer('rawAccel', len);
    for (let i = 1; i < len - 1; i++) {
      const dtClamped = Math.max(t[i + 1] - t[i - 1], 1e-5);
      rawAccel[i] = (smoothVel[i + 1] - smoothVel[i - 1]) / dtClamped;
    }
    rawAccel[0] = rawAccel[1];
    rawAccel[len - 1] = rawAccel[len - 2];

    // 針對加速度最後一次強力平滑 (對抗二次微分極端雜訊)， cutoff = 4.0Hz 保留核心力量峰值
    const smoothAccel = this.getBuffer('smoothAccel', len);
    this.filtfilt(rawAccel, len, avgDt, 4.0, smoothAccel);

    // 5. 第四階段：計算物理量 (Force & Power)
    for (let i = 0; i < len; i++) {
      const vel = smoothVel[i];
      const accel = smoothAccel[i];

      // 使用平滑後的加速度計算真實受力
      const force = barbellMass * (PhysicsEngineHPC.GRAVITY + accel);
      
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
   * 📐 關節角度平滑引擎 (Zero-Lag Butterworth)
   */
  public smoothAngles(
    inputBuffer: TrackingBuffer,
    outKnee: Float32Array,
    outHip: Float32Array,
    outAnkle: Float32Array,
    outBack: Float32Array
  ): void {
    const { kneeAngle, hipAngle, ankleAngle, backAngle, t, head: len } = inputBuffer;
    if (len < 5) return;

    let totalTime = t[len - 1] - t[0];
    let avgDt = Math.max(totalTime / (len - 1), 0.016);
    
    // 關節角度變化較為連續，使用 3.5Hz 的 cutoff 能提供極致滑順的視角感受，不會丟失屈伸的核心範圍
    const cutoffFreq = 3.5;

    const arrays = [kneeAngle, hipAngle, ankleAngle, backAngle];
    const outputs = [outKnee, outHip, outAnkle, outBack];
    const keys = ['knee', 'hip', 'ankle', 'back'];

    for (let axis = 0; axis < 4; axis++) {
      const rawBuf = arrays[axis];
      const rawData = this.getBuffer(`raw_${keys[axis]}`, len);
      for(let i = 0; i < len; i++) rawData[i] = rawBuf[i];

      this.filtfilt(rawData, len, avgDt, cutoffFreq, outputs[axis]);
    }
  }
}
