import { TrackingBuffer } from './TrackingBuffer';

export class PhysicsEngineHPC {
  private static readonly GRAVITY = 9.80665;

  /**
   * 批次計算物理指標，輸出至預先分配的陣列中
   * 輸出結構：[velocity, accel, force, power] 每個幀 4 個 float
   */
  public static computeKinetics(
    inputBuffer: TrackingBuffer, 
    outKinetics: Float32Array, 
    barbellMass: number
  ): void {
    const { y, t, head: len } = inputBuffer;
    
    if (len < 2) return;

    // 預先分配中心差分運算的暫存變數
    let prevVel = 0;

    // 從第一點開始，到最後一點 (len - 1)
    for (let i = 0; i < len; i++) {
      const currY = y[i];
      const currT = t[i];
      
      let vel, accel;

      // 1. 運動學計算：邊界降級與三點中心差分 (Central Difference)
      if (i === 0) {
        // 頭部邊界：前向差分
        const dt = Math.max(t[1] - t[0], 1e-7);
        vel = (y[1] - y[0]) / dt;
      } else if (i === len - 1) {
        // 尾部邊界：後向差分
        const dt = Math.max(t[i] - t[i - 1], 1e-7);
        vel = (y[i] - y[i - 1]) / dt;
      } else {
        // 內部節點：三點中心差分，消除一階截斷誤差
        const dt = Math.max(t[i + 1] - t[i - 1], 1e-7);
        vel = (y[i + 1] - y[i - 1]) / dt;
      }

      // 2. 加速度計算：基於速度的一階差分 (亦可視需求升級中心差分)
      if (i === 0) {
        accel = 0;
      } else {
        const dtStep = Math.max(currT - t[i - 1], 1e-7);
        accel = (vel - prevVel) / dtStep;
      }

      // 動力學計算 (Kinetics)
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

      // 更新前一幀狀態
      prevVel = vel;
    }
  }
}
