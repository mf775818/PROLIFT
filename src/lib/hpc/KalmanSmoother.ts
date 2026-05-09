export class KalmanSmoother1D {
  private x: number;
  private p: number;
  private q: number;
  private r: number;

  constructor(initialValue: number, processNoise = 1e-4, measurementNoise = 1e-2) {
    this.x = initialValue;
    this.p = 1;
    this.q = processNoise;
    this.r = measurementNoise;
  }

  public update(measurement: number): number {
    const p_pred = this.p + this.q;
    const k = p_pred / (p_pred + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * p_pred;
    return this.x;
  }

  public smoothBatch(measurements: Float64Array | number[], n: number, confs?: Float64Array | number[]): Float64Array {
    const forward = new Float64Array(n);
    const forwardP = new Float64Array(n);
    const smoothed = new Float64Array(n);

    let x = measurements[0], p = 1.0;

    for (let k = 0; k < n; k++) {
      const p_pred = p + this.q;
      const R = confs ? this.r / Math.max(0.001, confs[k]) : this.r;
      const K = p_pred / (p_pred + R);
      x = x + K * (measurements[k] - x);
      p = (1 - K) * p_pred;
      forward[k] = x;
      forwardP[k] = p;
    }

    let x_b = forward[n - 1], p_b = forwardP[n - 1];
    smoothed[n - 1] = x_b;

    for (let k = n - 2; k >= 0; k--) {
      const C = forwardP[k] / (forwardP[k] + this.q);
      smoothed[k] = forward[k] + C * (smoothed[k + 1] - forward[k]);
    }

    return smoothed;
  }
}
