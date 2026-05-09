/**
 * High-Performance Computing: Biomechanics Projective Cross-Analysis
 * 結合槓鈴剛體與骨架平面的射影幾何分析引擎。
 * 全程使用 Float64Array in-place 運算，確保 V8 引擎 O(1) 效能。
 */
export class BiomechanicsProjectiveHPC {
    // 預分配內部暫存區，避免 GC
    private static tempLineBar: Float64Array = new Float64Array(3);
    private static tempLineShoulder: Float64Array = new Float64Array(3);
    private static tempLineHip: Float64Array = new Float64Array(3);
    private static tempVanishingPoint: Float64Array = new Float64Array(3);

    /**
     * 計算 2D 齊次坐標的叉積 (Cross Product)
     * out = a x b (可用於: 兩點求線, 或兩線求交點)
     */
    public static crossProduct(out: Float64Array, a: Float64Array, b: Float64Array): void {
        out[0] = a[1] * b[2] - a[2] * b[1];
        out[1] = a[2] * b[0] - a[0] * b[2];
        out[2] = a[0] * b[1] - a[1] * b[0];
    }

    /**
     * 交叉分析：計算骨架平面的「扭轉/失衡度」
     * @param outMetrics Float64Array[2] - 輸出指標: [0] 肩膀失衡度, [1] 髖部失衡度 (數值越接近0越好)
     * @param barLeft 槓鈴左真實中心 (來自極點計算) [x, y, 1]
     * @param barRight 槓鈴右真實中心 [x, y, 1]
     * @param shoulderLeft 左肩關節 [x, y, 1]
     * @param shoulderRight 右肩關節 [x, y, 1]
     * @param hipLeft 左髖關節 [x, y, 1]
     * @param hipRight 右髖關節 [x, y, 1]
     */
    public static analyzeSkeletalTwist(
        outMetrics: Float64Array,
        barLeft: Float64Array, barRight: Float64Array,
        shoulderLeft: Float64Array, shoulderRight: Float64Array,
        hipLeft: Float64Array, hipRight: Float64Array
    ): void {
        // 1. 求出槓鈴的射影直線 (L_bar)
        this.crossProduct(this.tempLineBar, barLeft, barRight);

        // 2. 求出肩膀與髖部的射影直線
        this.crossProduct(this.tempLineShoulder, shoulderLeft, shoulderRight);
        this.crossProduct(this.tempLineHip, hipLeft, hipRight);

        // 3. 求出槓鈴與肩膀的交點 (理論上如果是平行的，會交於無窮遠處的消失點)
        this.crossProduct(this.tempVanishingPoint, this.tempLineBar, this.tempLineShoulder);
        
        // 正規化消失點 (轉換回 2D 歐氏空間進行距離評估)
        let w = this.tempVanishingPoint[2];
        let twistShoulder = 0;
        if (Math.abs(w) > 1e-7) {
             // 這裡計算的是射影空間中的散度。
             // 工業級做法：計算肩膀線段的方向向量與槓鈴線段方向向量的偏差角
             twistShoulder = this.calculateAngularDivergence(this.tempLineBar, this.tempLineShoulder);
        }

        // 4. 計算髖部偏差
        let twistHip = this.calculateAngularDivergence(this.tempLineBar, this.tempLineHip);

        // 輸出結果 (可輸入至 KalmanSmoother 或直接顯示在 UI 儀表板)
        outMetrics[0] = twistShoulder;
        outMetrics[1] = twistHip;
    }

    /**
     * 利用槓鈴直線，強制約束/修正 AI 抓取的手部節點 (消除抖動)
     * 物理法則：手必須握在槓鈴上。將有誤差的手部座標投影到精準的槓鈴直線上。
     * @param outHand Float64Array[3] - 修正後的手部齊次座標
     * @param rawHand Float64Array[3] - AI 預測的手部坐標
     * @param barLeft 槓鈴左真實中心
     * @param barRight 槓鈴右真實中心
     */
    public static constrainHandToBarbell(
        outHand: Float64Array,
        rawHand: Float64Array,
        barLeft: Float64Array, 
        barRight: Float64Array
    ): void {
        // 求槓鈴直線 a*x + b*y + c = 0
        this.crossProduct(this.tempLineBar, barLeft, barRight);
        const a = this.tempLineBar[0];
        const b = this.tempLineBar[1];
        const c = this.tempLineBar[2];

        // 點到直線的垂直投影點公式
        const x0 = rawHand[0] / rawHand[2];
        const y0 = rawHand[1] / rawHand[2];
        const denominator = a * a + b * b;

        if (denominator < 1e-10) {
            outHand[0] = rawHand[0]; outHand[1] = rawHand[1]; outHand[2] = 1;
            return;
        }

        // 寫入修正後的坐標 (完美貼合剛體軸線)
        outHand[0] = (b * (b * x0 - a * y0) - a * c) / denominator;
        outHand[1] = (a * (-b * x0 + a * y0) - b * c) / denominator;
        outHand[2] = 1.0;
    }

    // 內部計算兩直線夾角 (簡化版，利用法向量)
    private static calculateAngularDivergence(lineA: Float64Array, lineB: Float64Array): number {
        const dot = lineA[0] * lineB[0] + lineA[1] * lineB[1];
        const magA = Math.sqrt(lineA[0] * lineA[0] + lineA[1] * lineA[1]);
        const magB = Math.sqrt(lineB[0] * lineB[0] + lineB[1] * lineB[1]);
        
        if (magA < 1e-7 || magB < 1e-7) return 0;
        
        let cosTheta = dot / (magA * magB);
        // 確保在合法範圍內
        cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta)); 
        // 回傳角度差 (Degrees)
        return Math.acos(cosTheta) * (180.0 / Math.PI);
    }
}
