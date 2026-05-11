export class KalmanSmoother1D {
  private x: number;
  private p: number;
  private baseQ: number;
  private q_adaptive: number;
  private r: number;

  constructor(initialValue: number, processNoise = 1e-4, measurementNoise = 1e-2) {
    this.x = initialValue;
    this.p = 1;
    this.baseQ = processNoise;
    this.q_adaptive = processNoise;
    this.r = measurementNoise;
  }

  public update(measurement: number): number {
    // 自適應創新機制 (Adaptive Kalman Filter, AKF)
    const innovation = measurement - this.x;
    
    // 如果創新值 (殘差) 激增，代表物體正發生非線性加速 (如爆發期)，動態放大 q
    const scale = 1.0 + Math.min(50.0, Math.abs(innovation) * 20.0);
    this.q_adaptive = this.baseQ * scale;

    const p_pred = this.p + this.q_adaptive;
    const k = p_pred / (p_pred + this.r);
    this.x = this.x + k * innovation;
    this.p = (1 - k) * p_pred;
    return this.x;
  }

  public smoothBatch(measurements: Float64Array | number[], n: number, confs?: Float64Array | number[]): Float64Array {
    const forward = new Float64Array(n);
    const forwardP = new Float64Array(n);
    const forwardQ = new Float64Array(n); // 記錄正向運算時的適應性 q，供反向平滑使用
    const smoothed = new Float64Array(n);

    let x = measurements[0], p = 1.0;

    for (let k = 0; k < n; k++) {
      // 創新機制動態調整 q
      const innovation = measurements[k] - x;
      const scale = 1.0 + Math.min(50.0, Math.abs(innovation) * 20.0);
      const currentQ = this.baseQ * scale;
      forwardQ[k] = currentQ;

      const p_pred = p + currentQ;
      const R = confs ? this.r / Math.max(0.001, confs[k]) : this.r;
      const K = p_pred / (p_pred + R);
      x = x + K * innovation;
      p = (1 - K) * p_pred;
      forward[k] = x;
      forwardP[k] = p;
    }

    let x_b = forward[n - 1]; // p_b = forwardP[n - 1] is not needed directly
    smoothed[n - 1] = x_b;

    for (let k = n - 2; k >= 0; k--) {
      // 在後向平滑中套用各自節點對應的 q 值
      const C = forwardP[k] / (forwardP[k] + forwardQ[k]);
      smoothed[k] = forward[k] + C * (smoothed[k + 1] - forward[k]);
    }

    return smoothed;
  }
}
