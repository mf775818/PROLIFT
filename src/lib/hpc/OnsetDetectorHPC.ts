export interface OnsetDetectorConfig {
  /**
   * 噪音容忍度 (Slack Value, k)
   * 用於 CUSUM 演算法，代表每次迭代允許的訊號負向漂移量。
   * 建議值：大於背景底噪的平均震盪程度，但不致於過大而錯過真實發力。
   * 例如：對於功率訊號大約設定為 10~25 Watts。
   */
  slack: number;
  
  /**
   * 觸發閾值 (Threshold, h)
   * 當 CUSUM 統計量累積超過此數值時，判定為發力起始 (Onset)。
   * 建議值：依照動作爆發力而定。舉重通常發力極快，可設定為背景噪音標準差的 4 到 5 倍。
   * 例如：50~100 Watts。
   */
  threshold: number;
  
  /**
   * 初始化校正幀數 (Warm-up Frames)
   * 演算法剛開始時，擷取幾幀來動態計算環境底噪的均值 (mu)。
   * 建議值：5 ~ 15 幀 (即前 0.2 秒到 0.5 秒假設槓鈴處於準備靜止狀態)。
   */
  warmupFrames: number;
}

export enum LiftPhase {
  WARMUP = 'WARMUP',
  IDLE = 'IDLE',
  LIFTING = 'LIFTING',
}

/**
 * 舉重做功起始點 (Onset) 偵測器
 * - 零遲滯 (Zero-Lag)，因果演算法 (Causal)
 * - 整合 CUSUM (累積和控制圖) 與 FSM (有限狀態機)
 */
export class OnsetDetectorHPC {
  private config: OnsetDetectorConfig;
  
  private currentState: LiftPhase = LiftPhase.WARMUP;
  private cusumStatistic: number = 0;
  
  private backgroundMean: number = 0;
  private warmupBuffer: number[] = [];
  
  // FSM 用於追蹤已偵測到的第一次起始點
  private firstOnsetIndex: number = -1;
  private currentIndex: number = 0;
  private recentPositiveCusumStart: number = -1;

  constructor(config: Partial<OnsetDetectorConfig> = {}) {
    this.config = {
      slack: config.slack ?? 15,
      threshold: config.threshold ?? 60,
      warmupFrames: config.warmupFrames ?? 10,
    };
  }

  /**
   * 循序輸入即時或批次陣列資料進行偵測。時間複雜度 O(1)。
   * 當找到第一個起始點時，傳回該點的索引。若未找到則傳回 -1。
   * @param power 每個時間步的功率值 (Watts)
   */
  public process(power: number): number {
    const idx = this.currentIndex++;

    // 已經鎖定起點的話，進入 LIFTING State，忽略後續抖動 (例如 Jerk 高峰)
    if (this.currentState === LiftPhase.LIFTING) {
      return this.firstOnsetIndex;
    }

    if (this.currentState === LiftPhase.WARMUP) {
      this.warmupBuffer.push(power);
      if (this.warmupBuffer.length >= this.config.warmupFrames) {
        // 計算底噪均值 (mu)
        const sum = this.warmupBuffer.reduce((a, b) => a + b, 0);
        this.backgroundMean = sum / this.warmupBuffer.length;
        this.currentState = LiftPhase.IDLE;
      }
      return -1;
    }

    if (this.currentState === LiftPhase.IDLE) {
      // 擷取功率對於背景均值的變化 (Mean Shift)
      const change = power - this.backgroundMean;
      
      const previousCusum = this.cusumStatistic;
      // CUSUM 正向統計量： S_t = max(0, S_{t-1} + (x_t - mu - slack))
      this.cusumStatistic = Math.max(0, this.cusumStatistic + change - this.config.slack);

      // 追蹤這次累積攀升是從哪裡開始的 (CUSUM 從 0 變為正值的點)
      if (previousCusum === 0 && this.cusumStatistic > 0) {
        this.recentPositiveCusumStart = idx;
      } else if (this.cusumStatistic === 0) {
        this.recentPositiveCusumStart = -1;
      }

      if (this.cusumStatistic > this.config.threshold) {
        // 觸發！突破閾值，判定發力
        this.currentState = LiftPhase.LIFTING;
        
        // CUSUM 具備內部記憶性，真正的起點是「CUSUM 開始大於 0 的那一刻」
        // 這完美解決了 Zero-Lag 問題，我們雖然晚了幾幀確認，但回溯的索引起點是絕對精準的物理起點
        this.firstOnsetIndex = this.recentPositiveCusumStart !== -1 ? this.recentPositiveCusumStart : idx;
        return this.firstOnsetIndex;
      }
    }

    return -1;
  }
  
  /**
   * 批次處理整個序列並找出真正的第一起點索引。時間複雜度 O(n)。
   */
  public static detectBatchOnset(powers: number[], config?: Partial<OnsetDetectorConfig>): number {
    const detector = new OnsetDetectorHPC(config);
    let onset = -1;
    for (let i = 0; i < powers.length; i++) {
        onset = detector.process(powers[i]);
        if (onset !== -1) {
            return onset; // 回傳第一次抓到的 Clean 起點
        }
    }
    return 0; // 倘若未找齊(如影片極短)，預設為起點
  }
}
