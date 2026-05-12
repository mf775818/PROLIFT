export interface OnsetDetectorConfig {
  /**
   * 噪音容忍度 (Slack Value, k)
   * 用於 CUSUM 演算法，代表每次迭代允許的訊號負向漂移量。
   */
  slack?: number;
  
  /**
   * 觸發閾值 (Threshold, h)
   * 當 CUSUM 統計量累積超過此數值時，判定為發力起始 (Onset)。
   */
  threshold?: number;
  
  /**
   * 初始化校正幀數 (Warm-up Frames)
   * 用於動態計算環境底噪的均值 (mu) 與標準差 (sigma)。
   */
  warmupFrames: number;

  /**
   * 靈敏度系數 (Sensitivity Multiplier)
   * 自動計算時，閾值為：sigma * sensitivity。
   * 建議值：4 ~ 6 (Sigma 越大，抗雜訊越強，但延遲略增)
   */
  sensitivity?: number;
}

export enum LiftPhase {
  WARMUP = 'WARMUP',
  IDLE = 'IDLE',
  LIFTING = 'LIFTING',
}

/**
 * 舉重做功起始點 (Onset) 偵測器 - 工業級 DSP 實作 (多峰集群分類 + 逆向回溯)
 */
export class OnsetDetectorHPC {
  /**
   * 工業級集群分析法 (Industrial Cluster Analysis & Signal Gating):
   * 1. 全局底噪：識別整段影片的靜態基線與最大功率。
   * 2. 硬雜訊閘 (Hard Noise Gate)：扣除底噪與微小抖動，將零碎的雜訊波形「歸零」，以此切割出乾淨的波形。
   * 3. 集群化 (Clustering)：將連續高於零的區段識別為單獨的「動作塊 (Macro-phase)」。
   * 4. 偽訊號過濾：剃除雖然突破底噪，但累積峰值過低的非發力微動 (如：抓桿時的拉扯)。
   * 5. 逆向回溯 (Retrograde Convergence)：定位出最早出現的核心發力集群後，往回尋找絕對突破靜止域的精確點。
   * 
   * @param powers 整段功率序列
   * @param sensitivity 統計門檻系數 (預設 5)
   */
  public static detectBatchOnset(powers: number[], sensitivity: number = 5): number {
    if (powers.length < 20) return 0;

    // 1. 全局底噪統計 (取功率最低的 30% 作為絕對靜止背景)
    const sorted = [...powers].sort((a, b) => a - b);
    const noiseSample = sorted.slice(0, Math.floor(sorted.length * 0.3));
    const bgMean = noiseSample.reduce((a, b) => a + b, 0) / noiseSample.length;
    const bgVariance = noiseSample.reduce((a, b) => a + Math.pow(b - bgMean, 2), 0) / noiseSample.length;
    const bgSigma = Math.sqrt(bgVariance) || 0.1;

    const globalMax = Math.max(...powers);

    // 工業級信號閘門 (Noise Gate)：
    // a. 基於統計的敏感度門檻 (bgMean + bgSigma * sensitivity)
    // b. 基於整體最高爆發力的絕對下限 (globalMax * 0.05)。
    // 作用：如果影片跟蹤雜訊極低，統計 Sigma 可能趨近於 0，會導致任何微小抖動被過度放大。
    //       強制設定一個與全局峰值掛鉤的 5% 下限，可以將物理學上的無效做功直接截斷。
    const noiseGate = Math.max(bgMean + bgSigma * sensitivity, globalMax * 0.05);

    // 2. 扣除底噪 (Signal Gating)：低於閘門的值強制歸零，切割出獨立的工作高峰
    const cleanPowers = powers.map(p => Math.max(0, p - noiseGate));

    // 3. 信號集群化 (Signal Clustering)
    const clusters: { start: number; end: number; peakP: number; peakIdx: number, duration: number }[] = [];
    let currentCluster: any = null;

    for (let i = 0; i < cleanPowers.length; i++) {
        if (cleanPowers[i] > 0) {
            if (!currentCluster) {
                currentCluster = { start: i, end: i, peakP: cleanPowers[i], peakIdx: i, duration: 1 };
            } else {
                currentCluster.end = i;
                currentCluster.duration++;
                if (cleanPowers[i] > currentCluster.peakP) {
                    currentCluster.peakP = cleanPowers[i];
                    currentCluster.peakIdx = i;
                }
            }
        } else {
            if (currentCluster) {
                // 4. Macro-phase 篩選：
                // 排除時間極短 (< 3 幀) 的突波，且要求該群集的最高峰值至少達全局最大功率的 10%。
                // 完美過濾架上預備動作的晃動，保留 First Pull (>20%)、Second Pull(100%) 以及 Jerk。
                if (currentCluster.duration >= 3 && currentCluster.peakP > globalMax * 0.10) {
                    clusters.push(currentCluster);
                }
                currentCluster = null;
            }
        }
    }
    // 結尾處理
    if (currentCluster && currentCluster.duration >= 3 && currentCluster.peakP > globalMax * 0.10) {
        clusters.push(currentCluster);
    }

    if (clusters.length === 0) {
        // 退避策略 (Fallback)：當參數過度嚴苛導致無有效集群時的單峰回溯安全網
        let maxIdx = 0;
        let zeroIdx = 0;
        for (let i = 0; i < powers.length; i++) { if (powers[i] === globalMax) maxIdx = i; }
        for (let i = maxIdx; i >= 0; i--) {
            if (powers[i] <= bgMean + bgSigma * 2) { zeroIdx = i; break; }
        }
        return Math.max(0, zeroIdx);
    }

    // 5. 尋找最早的有效波谷群
    clusters.sort((a, b) => a.start - b.start);
    const firstValidCluster = clusters[0];

    // 6. 逆向精確回溯 (Retrograde Convergence)：
    // 集群的 start 是指「突破 noiseGate (e.g. 50W)」的瞬間，但為了符合物理起點，
    // 需從 start 向前尋找信號真正離開絕對靜止區間的臨界點。
    const absoluteBaseThresh = Math.max(bgMean + bgSigma * 1.5, globalMax * 0.01);
    let onsetIdx = firstValidCluster.start;
    
    for (let i = firstValidCluster.start; i >= 0; i--) {
        if (powers[i] <= absoluteBaseThresh) {
            onsetIdx = i;
            break; // 成功沉到底噪
        }
        onsetIdx = i; // 若一直未穿透，保持更新至最源頭
    }

    console.log(`[OnsetDetector] Global Max: ${globalMax.toFixed(1)}W, Gate: ${noiseGate.toFixed(1)}W. Clusters found: ${clusters.length}. Onset resolved at index: ${onsetIdx}`);
    return Math.max(0, onsetIdx);
  }

  public process(power: number): number {
    return -1;
  }
}
