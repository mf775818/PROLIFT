/**
 * 工業級剛體約束引擎 (Rigid-Body Constraint HPC)
 * 利用標準槓鈴的絕對物理尺寸，反向約束與校正生物力學場。
 */
export class BarbellRigidBodyHPC {
    // 國際標準槓鈴物理常數 (單位: mm)
    private static readonly BAR_TOTAL_LENGTH = 2200.0;
    private static readonly INNER_SLEEVE_DIST = 1310.0;
    private static readonly PLATE_DIAMETER = 450.0;
    
    // (2200 - 1310) / 2 = 445mm (單側袖套+擋片的物理長度)
    private static readonly SLEEVE_LENGTH = 445.0; 

    // 預分配記憶體：避免 GC 停頓
    private static barbellCenter3D = new Float64Array(3);
    private static cameraPerspectiveMatrix = new Float64Array(9);

    /**
     * 核心演算法：利用交比 (Cross-Ratio) 與已知長度，強制校正 AI 骨架的人體中心
     * @param outCorrectedCenter Float64Array[3] - 輸出：修正後的絕對人體 3D 中心
     * @param leftPlateCenter Float64Array[3] - AI 抓到的左槓片 2D/3D 極點
     * @param rightPlateCenter Float64Array[3] - AI 抓到的右槓片 2D/3D 極點
     * @param rawBodyCenter Float64Array[3] - AI 骨架預測的人體中心 (如左右髖關節中點)
     * @param isSetupPhase boolean - 是否為預備靜止狀態
     */
    public static enforceCenterSymmetry(
        outCorrectedCenter: Float64Array,
        leftPlateCenter: Float64Array,
        rightPlateCenter: Float64Array,
        rawBodyCenter: Float64Array,
        isSetupPhase: boolean
    ): void {
        // 1. 計算絕對剛體中心 (The Absolute Truth)
        // 既然槓鈴是 2200mm，且對稱，左右槓片極點的中點必定是絕對物理中心
        this.barbellCenter3D[0] = (leftPlateCenter[0] + rightPlateCenter[0]) * 0.5;
        this.barbellCenter3D[1] = (leftPlateCenter[1] + rightPlateCenter[1]) * 0.5;
        this.barbellCenter3D[2] = (leftPlateCenter[2] + rightPlateCenter[2]) * 0.5; // Z軸深度中心

        // 2. 幾何先驗誤差計算 (Geometric Prior Error)
        // 計算 AI 骨架中心與絕對剛體中心的偏差
        const driftX = rawBodyCenter[0] - this.barbellCenter3D[0];
        const driftY = rawBodyCenter[1] - this.barbellCenter3D[1];

        // 3. 智慧融合修正 (Smart Fusion)
        if (isSetupPhase) {
            // 在起槓預備時，人體"必定"在正中央。
            // 我們完全捨棄 AI 骨架的 X 軸與 Z 軸預測，強制綁定於槓鈴中心
            outCorrectedCenter[0] = this.barbellCenter3D[0];
            outCorrectedCenter[1] = rawBodyCenter[1]; // Y軸(高度)保留，因為深蹲高低有差異
            outCorrectedCenter[2] = this.barbellCenter3D[2];
        } else {
            // 運動過程中 (動態狀態)
            // 將原本固定的 50mm 閾值改為「特徵距離百分比」：以內部袖套距離 (約相近於握距) 的 10% 為基準
            // 動態適應不同體型
            const dynamicThreshold = this.INNER_SLEEVE_DIST * 0.10; // 約 131mm
            
            const currentDrift = Math.sqrt(driftX * driftX + driftY * driftY);

            // 實作彈簧阻尼融合模型 (Soft Blending - Sigmoid/Smoothstep)
            // 摒棄 if-else 硬切斷，計算信賴權重 w (0 代表完全信任 AI 預測, 1 代表完全服格於物理剛體約束)
            let w = 0.0;
            const lowerBound = dynamicThreshold * 0.4;
            const upperBound = dynamicThreshold * 1.5;

            if (currentDrift <= lowerBound) {
                w = 0.0;
            } else if (currentDrift >= upperBound) {
                w = 1.0;
            } else {
                // 平滑過渡 (Smoothstep): 一階連續性 (C1 Continuity)
                const t = (currentDrift - lowerBound) / (upperBound - lowerBound);
                w = t * t * (3.0 - 2.0 * t);
            }

            // 平滑插值結合預測座標與理論絕對座標
            outCorrectedCenter[0] = rawBodyCenter[0] * (1.0 - w) + this.barbellCenter3D[0] * w;
            outCorrectedCenter[1] = rawBodyCenter[1]; // Y軸始終交由動力學引擎處理
            outCorrectedCenter[2] = rawBodyCenter[2] * (1.0 - w) + this.barbellCenter3D[2] * w;
        }
    }

    /**
     * 計算抓握有效性 (Grip Validity)
     * 利用 1310mm 極限距離來剔除不合理的 2D 手部辨識噪點
     */
    public static validateGripWidth(leftHand: Float64Array, rightHand: Float64Array, scaleMmPerPx: number): boolean {
        const dx = (leftHand[0] - rightHand[0]) * scaleMmPerPx;
        const dy = (leftHand[1] - rightHand[1]) * scaleMmPerPx;
        const gripWidthMm = Math.sqrt(dx * dx + dy * dy);

        // 如果 AI 算出手距大於 1310mm，或是小於 100mm(雙手重疊)，代表辨識嚴重失誤
        // 需捨棄該幀手部數據，交由 KalmanSmoother.ts 推測
        return (gripWidthMm <= this.INNER_SLEEVE_DIST + 10.0) && (gripWidthMm >= 100.0);
    }
}
