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
        userHeightMm?: number | null
    ): void {
        // 1. 永遠存在的錨點：槓鈴片比例尺
        const plateScale = DepthCalibratorHPC.OLYMPIC_PLATE_MM / platePixelDiameter;
        this.calibrationState[0] = plateScale;

        // 2. 動態判定：雙錨定 vs 單錨定
        if (userHeightMm !== undefined && userHeightMm !== null && userHeightMm > 0) {
            // ===== 雙錨定模式 (Dual Anchoring) =====
            const bodyScale = userHeightMm / bodyPixelHeight;
            this.calibrationState[1] = bodyScale;
            this.calibrationState[3] = 1.0; // isDualAnchored = true

            // 交叉分析：計算 Z 軸深度差 (假設相似三角形透視原理)
            // 比例尺越小，代表物體離相機越近。藉此可推斷槓鈴與人體的相對深度。
            this.calibrationState[2] = (bodyScale - plateScale) * 1000; // 簡易深度偏差指標 (供後續矩陣微調用)

        } else {
            // ===== 單錨定模式 (Single Anchoring) =====
            // 無身高輸入時，強制讓身體比例尺等於槓鈴比例尺 (降級為共面假設)
            this.calibrationState[1] = plateScale; 
            this.calibrationState[2] = 0.0; // 無深度差
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
        const isDualAnchored = this.calibrationState[3] === 1.0;

        // Hot-loop: Loop Unrolling & Branch Prediction Optimization
        for (let i = 0; i < nodeCount; i++) {
            // 根據是否為雙錨定，以及節點的物理歸屬，套用不同的比例尺
            // 如果是單錨定，bodyScale 本身就等於 plateScale，邏輯依然成立且無須多餘的 if 判斷
            const scale = (isDualAnchored && !isBarbellNode[i]) ? bodyScale : plateScale;

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

    /**
     * 計算影像平面轉換為真實 3D 空間的逆變換矩陣 H_inv (支援度規張量初始化)
     * 在雙錨定模式下，H_inv 會利用身高的深度計算出透視張量的非對角項 (Skew/Foreshortening)
     */
    public getInverseHomography(): Float64Array {
        const plateScale = this.calibrationState[0];
        const bodyScale  = this.calibrationState[1];
        const isDualAnchored = this.calibrationState[3] === 1.0;
        
        // 因為 trackingBuffer在傳入物理引擎前，已經被整體乘上了 plateScale / 1000 (轉為 Meter)，
        // 所以度規張量面對的基底座標系(Basis)的單位已經是(基於槓片的)公尺。
        // 我們這裡輸出的 H_inv 是用來修正「相對」於槓片的透視變形。
        const relativeBodyScale = plateScale > 0 ? bodyScale / plateScale : 1.0;
        
        // H_inv 是一維 Float64Array 3x3 矩陣
        const H_inv = new Float64Array([
            1.0, 0, 0,
            0, 1.0, 0, 
            0, 0, 1
        ]);
        
        // 如果是雙錨定 (45 度拍攝)，深度的比例差異 (relativeBodyScale - 1) 代表了相對透視變形
        if (isDualAnchored) {
             const skew = (relativeBodyScale - 1.0) * 0.5;
             H_inv[1] = skew; // H_inv_01 (y 對 x 的協方差生成源)
             H_inv[3] = skew; // H_inv_10
             H_inv[4] = relativeBodyScale;  // Y axis scale correction
        }
        
        return H_inv;
    }
}
