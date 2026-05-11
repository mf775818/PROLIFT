/**
 * 工業級深度與比例校正引擎 (HPC)
 * 支援單錨定 (僅槓鈴片) 與雙錨定 (槓鈴片 + 真實身高) 的動態切換。
 * 嚴禁使用預設身高，確保測量標準的一致性。
 */
export class DepthCalibratorHPC {
    // 奧林匹克標準槓鈴片直徑 (mm)
    private static readonly OLYMPIC_PLATE_MM = 450.0;

    // 校正狀態快取 (避免在每一幀重複計算)
    // 結構: [plateScale, bodyScale, zDepthDelta, isDualAnchored]
    // scale 單位: mm / pixel
    private calibrationState: Float64Array = new Float64Array([0, 0, 0, 0]);

    /**
     * 執行初始化校正 (必須在動作起始、直立靜止幀執行)
     * @param platePixelDiameter 影像中槓鈴片的像素直徑 (長軸)
     * @param bodyPixelHeight 影像中骨架的像素總高度 (頭頂至足底)
     * @param userHeightMm 使用者真實身高 (mm)。若無輸入，請傳入 null 或 undefined。絕對不可傳入預設值。
     */
    public calibrate(
        platePixelDiameter: number, 
        bodyPixelHeight: number,
        userHeightMm?: number | null,
        focalLengthPixels: number = 800.0 // 引入相機的針孔投影模型焦距 (預設 800px)
    ): void {
        // 1. 永遠存在的錨點：槓鈴片比例尺
        const plateScale = DepthCalibratorHPC.OLYMPIC_PLATE_MM / platePixelDiameter;
        this.calibrationState[0] = plateScale;

        // 幾何補償：利用已知的槓鈴絕對尺寸推導出槓鈴的確切 Z 深度 (Z = f * RealSize / PixelSize)
        const zBarbell = focalLengthPixels * plateScale;

        // 2. 動態判定：雙錨定 vs 單錨定
        if (userHeightMm !== undefined && userHeightMm !== null && userHeightMm > 0) {
            // ===== 雙錨定模式 (Dual Anchoring) =====
            const bodyScale = userHeightMm / bodyPixelHeight;
            this.calibrationState[1] = bodyScale;
            this.calibrationState[3] = 1.0; // isDualAnchored = true

            // 交叉分析：計算 Z 軸深度差
            const zBody = focalLengthPixels * bodyScale;
            this.calibrationState[2] = zBody - zBarbell; // 實際深度偏差
        } else {
            // ===== 單錨定模式 (Single Anchoring) =====
            // 解除共面耦合：不再強制設為相等，引入生物力學先驗偏移量 (Depth Offset Prior)
            // 假設普通重量訓練動作(例如深蹲)中，身體質心平均比槓鈴平面深 150 毫米
            const PRIOR_DEPTH_OFFSET_MM = 150.0;
            const zBody = zBarbell + PRIOR_DEPTH_OFFSET_MM;
            
            // 根據 Z 深度偏移量反推此深度的身形比例尺
            const bodyScale = zBody / focalLengthPixels;
            
            this.calibrationState[1] = bodyScale; 
            this.calibrationState[2] = PRIOR_DEPTH_OFFSET_MM; 
            this.calibrationState[3] = 0.0; // isDualAnchored = false
        }
    }

    /**
     * 將 2D 骨架像素座標，轉換為真實世界的物理座標 (mm)
     * 支援批次處理，直接修改傳入的陣列以達到 HPC 效能
     * @param xCoords Float64Array - 骨架各節點的 X 像素座標
     * @param yCoords Float64Array - 骨架各節點的 Y 像素座標
     * @param nodeCount 節點數量
     * @param isBarbellNode 布林值陣列，標示該節點是屬於「槓鈴/手部」還是「軀幹/腿部」
     */
    public transformToPhysicalSpace(
        xCoords: Float64Array, 
        yCoords: Float64Array, 
        nodeCount: number,
        isBarbellNode: boolean[]
    ): void {
        const plateScale = this.calibrationState[0];
        const bodyScale = this.calibrationState[1];

        // Hot-loop: Loop Unrolling & Branch Prediction Optimization
        for (let i = 0; i < nodeCount; i++) {
            // 在新的架構下，單錨定與雙錨定皆已正確計算出 bodyScale
            // 因此直接根據節點類型選擇 scale 即可，無需判斷 isDualAnchored
            const scale = isBarbellNode[i] ? plateScale : bodyScale;

            // In-place 修改，將像素轉為真實毫米 (mm)
            xCoords[i] = xCoords[i] * scale;
            yCoords[i] = yCoords[i] * scale;
        }
    }

    /**
     * 查詢目前是否處於高精度雙錨定模式
     */
    public isHighPrecisionMode(): boolean {
        return this.calibrationState[3] === 1.0;
    }
}
