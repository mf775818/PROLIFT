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

    let prevY = y[0], prevT = t[0];
    let currY, currT, dt, invDt, vel, accel, force, power;
    let prevVel = 0;

    // 從第二個點開始計算 (Index 1)
    for (let i = 1; i < len; i++) {
      currY = y[i];
      currT = t[i];
      
      dt = currT - prevT;
      // 避免 dt = 0 造成 NaN，並使用乘法代替除法加速
      invDt = dt > 0.001 ? 1.0 / dt : 0; 

      // 運動學計算 (Kinematics)
      // Y 軸位移，假設向上為正
      vel = (currY - prevY) * invDt; 
      accel = (vel - prevVel) * invDt;

      // 動力學計算 (Kinetics)
      force = barbellMass * (this.GRAVITY + accel);
      power = Math.max(0, force * vel);

      // 寫入預分配的輸出陣列
      const offset = i * 4;
      outKinetics[offset]     = vel;
      outKinetics[offset + 1] = accel;
      outKinetics[offset + 2] = force;
      outKinetics[offset + 3] = power;

      // 更新前一幀狀態
      prevY = currY;
      prevT = currT;
      prevVel = vel;
    }
  }
}
