import { TrackingBuffer } from './TrackingBuffer';
import { MetricTensorHPC } from './MetricTensorHPC';

export class PhysicsEngineHPC {
  private static readonly GRAVITY = 9.80665;

  /**
   * 批次計算物理指標，輸出至預先分配的陣列中
   * 輸出結構：[velocity, accel, force, power] 每個幀 4 個 float
   */
  public static computeKinetics(
    inputBuffer: TrackingBuffer, 
    outKinetics: Float32Array, 
    barbellMass: number,
    metricTensor?: MetricTensorHPC
  ): void {
    const { x, y, t, head: len } = inputBuffer;
    
    if (len < 2) return;

    let prevX = x[0], prevY = y[0], prevT = t[0];
    let currX, currY, currT, dt, invDt, vel, accel, force, power;
    let prevVel = 0;

    // 從第二個點開始計算 (Index 1)
    for (let i = 1; i < len; i++) {
      currX = x[i];
      currY = y[i];
      currT = t[i];
      
      dt = currT - prevT;
      const dtClamped = Math.max(dt, 1e-7); // 避免 dt = 0 造成 NaN
      invDt = 1.0 / dtClamped;
      
      // 運動學計算 (Kinematics)
      // Y 軸位移，假設向上為正
      if (metricTensor) {
          // [工業級優化] 使用度規張量計算真實 3D 距離偏移量
          const trueDistance = metricTensor.computePhysicalDistance(prevX, prevY, currX, currY);
          // 保留 Y 軸的運動方向 (向上為正, 向下為負)
          const signY = (currY - prevY) >= 0 ? 1 : -1;
          vel = signY * trueDistance * invDt;
      } else {
          vel = (currY - prevY) * invDt; 
      }
      accel = (vel - prevVel) * invDt;

      // 動力學計算 (Kinetics)
      force = barbellMass * (this.GRAVITY + accel);
      
      const rawPower = force * vel;
      // 去分支取正功: (x + |x|)/2 = max(0, x)
      power = (rawPower + Math.abs(rawPower)) * 0.5;

      // 寫入預分配的輸出陣列
      const offset = i * 4;
      outKinetics[offset]     = vel;
      outKinetics[offset + 1] = accel;
      outKinetics[offset + 2] = force;
      outKinetics[offset + 3] = power;

      // 更新前一幀狀態
      prevX = currX;
      prevY = currY;
      prevT = currT;
      prevVel = vel;
    }
  }
}
