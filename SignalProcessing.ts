/**
 * 工業級舉重起始點檢測算法
 * 解決 Clean & Jerk 中 Jerk 功率過大導致基準線偏移的問題
 */

export interface SignalPoint {
  time: number; // 秒
  power: number; // 瓦特
}

export class WeightliftingOnsetDetector {
  
  // 配置參數 (可根據採樣率微調)
  private readonly SMOOTHING_WINDOW = 5; // 平滑窗口大小 (個數)
  private readonly THRESHOLD_SIGMAS = 4; // 觸發閾值倍數 (Mean + 4*Sigma)
  private readonly MIN_BURST_DURATION_MS = 150; // 最小持續時間 (毫秒)，防止誤觸

  /**
   * 核心檢測函數
   * @param data XY數據陣列
   * @param samplingRate 採樣率 (Hz/FPS)
   * @returns 起始點索引 (Index)
   */
  public detectStartPoint(data: SignalPoint[], samplingRate: number = 30): number {
    if (data.length < 10) return -1;

    // 1. 預處理：平滑信號 (移動平均)，去除高頻噪聲但保留上升沿
    // 注意：為了減少延遲，我們只取當前點和前幾個點的平均 (Causal Moving Average)
    const smoothedData = this.applyCausalMovingAverage(data, this.SMOOTHING_WINDOW);

    // 2. 估計底噪 (Noise Floor)
    // 假設前 1.0 秒是靜止狀態
    const baselineDurationSec = 1.0; 
    const baselineSamples = Math.floor(baselineDurationSec * samplingRate);
    const baselineSlice = smoothedData.slice(0, Math.min(baselineSamples, smoothedData.length));
    
    // 如果數據太短，退而求其次使用前 10%
    const finalBaselineSlice = baselineSlice.length > 5 
        ? baselineSlice 
        : smoothedData.slice(0, Math.max(1, Math.floor(smoothedData.length * 0.1)));

    const noiseStats = this.calculateStats(finalBaselineSlice.map(d => d.power));
    
    // 設置啟動閾值：均值 + N倍標準差。
    // 同時設定一個保守的最低門檻 (例如 15W)，避免在極低噪聲下過度敏感
    const activationThreshold = Math.max(15, noiseStats.mean + (this.THRESHOLD_SIGMAS * noiseStats.stdDev));

    // 3. 尋找第一個 "Burst" (爆發段)
    let consecutiveAboveThreshold = 0;
    const minBurstSamples = Math.max(1, Math.floor(this.MIN_BURST_DURATION_MS / 1000 * samplingRate));

    for (let i = 0; i < smoothedData.length; i++) {
      if (smoothedData[i].power > activationThreshold) {
        consecutiveAboveThreshold++;
        
        // 如果持續時間足夠，則判定為有效動作開始
        if (consecutiveAboveThreshold >= minBurstSamples) {
          return i - consecutiveAboveThreshold + 1; // 回溯到剛超過閾值的那一點
        }
      } else {
        // 如果中間掉下去了，重置計數 (處理不連續的噪聲)
        if (smoothedData[i].power < activationThreshold * 0.8) {
             consecutiveAboveThreshold = 0;
        }
      }
    }

    return -1;
  }

  private applyCausalMovingAverage(data: SignalPoint[], windowSize: number): SignalPoint[] {
    return data.map((point, index) => {
      let sum = 0;
      let count = 0;
      for (let j = 0; j < windowSize; j++) {
        if (index - j >= 0) {
          sum += data[index - j].power;
          count++;
        }
      }
      return { ...point, power: sum / count };
    });
  }

  private calculateStats(values: number[]): { mean: number; stdDev: number } {
    const n = values.length;
    if (n === 0) return { mean: 0, stdDev: 0 };
    
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    
    return { mean, stdDev: Math.sqrt(variance) };
  }
}
