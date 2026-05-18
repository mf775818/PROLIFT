/**
 * 高效能腳踝運動學計算引擎 (Ankle Kinematics HPC)
 * 負責計算腳踝相對於腳底板平面的真實夾角，支援 DLT/螢幕雙模態自動切換與零分配防守
 */
export class AnkleKinematicsHPC {
    // MediaPipe 關鍵點索引常數
    private static readonly LEFT_KNEE = 25;
    private static readonly RIGHT_KNEE = 26;
    private static readonly LEFT_ANKLE = 27;
    private static readonly RIGHT_ANKLE = 28;
    private static readonly LEFT_HEEL = 29;
    private static readonly RIGHT_HEEL = 30;
    private static readonly LEFT_FOOT_INDEX = 31;
    private static readonly RIGHT_FOOT_INDEX = 32;

    // 預分配實例級別緩存區，徹底根除 Hot-loop 中的 GC 壓力（保證執行緒安全）
    private readonly pKnee = new Float64Array(2);
    private readonly pAnkle = new Float64Array(2);
    private readonly pHeel = new Float64Array(2);
    private readonly pToe = new Float64Array(2);
    
    private readonly rad2deg = 180.0 / Math.PI;

    /**
     * 計算相對腳底板平面的腳踝夾角 (直立90度, 深蹲背屈<90度, 墊腳尖蹠屈>90度)
     * @param landmarks MediaPipe 原始關鍵點數據
     * @param dltEngine 可選的 CalibrationEngineHPC 實例 (若未注入則自動退化至螢幕空間)
     * @returns number - 腳踝夾角 (Degree)
     */
    public calculateAnkleAngle(landmarks: any[], dltEngine?: any | null): number {
        // 【防守 1】輸入邊界校驗，防止特徵點丟失時崩潰
        if (!landmarks || landmarks.length <= AnkleKinematicsHPC.RIGHT_FOOT_INDEX) {
            return 90.0; // 降級回傳標準直立夾角
        }

        // 1. 動態智慧選擇可見度（Visibility）較高的一側，避開槓鈴片與肢體遮擋的噪點
        const leftVis = (landmarks[AnkleKinematicsHPC.LEFT_KNEE]?.visibility ?? 0) + 
                        (landmarks[AnkleKinematicsHPC.LEFT_ANKLE]?.visibility ?? 0) + 
                        (landmarks[AnkleKinematicsHPC.LEFT_HEEL]?.visibility ?? 0) + 
                        (landmarks[AnkleKinematicsHPC.LEFT_FOOT_INDEX]?.visibility ?? 0);

        const rightVis = (landmarks[AnkleKinematicsHPC.RIGHT_KNEE]?.visibility ?? 0) + 
                         (landmarks[AnkleKinematicsHPC.RIGHT_ANKLE]?.visibility ?? 0) + 
                         (landmarks[AnkleKinematicsHPC.RIGHT_HEEL]?.visibility ?? 0) + 
                         (landmarks[AnkleKinematicsHPC.RIGHT_FOOT_INDEX]?.visibility ?? 0);

        const isLeft = leftVis > rightVis;

        const kneeIdx  = isLeft ? AnkleKinematicsHPC.LEFT_KNEE : AnkleKinematicsHPC.RIGHT_KNEE;
        const ankleIdx = isLeft ? AnkleKinematicsHPC.LEFT_ANKLE : AnkleKinematicsHPC.RIGHT_ANKLE;
        const heelIdx  = isLeft ? AnkleKinematicsHPC.LEFT_HEEL : AnkleKinematicsHPC.RIGHT_HEEL;
        const toeIdx   = isLeft ? AnkleKinematicsHPC.LEFT_FOOT_INDEX : AnkleKinematicsHPC.RIGHT_FOOT_INDEX;

        const rawKnee  = landmarks[kneeIdx];
        const rawAnkle = landmarks[ankleIdx];
        const rawHeel  = landmarks[heelIdx];
        const rawToe   = landmarks[toeIdx];

        if (!rawKnee || !rawAnkle || !rawHeel || !rawToe) return 90.0;

        let fx = 0, fy = 0; // 腳底板平面向量 (Heel -> Toe)
        let sx = 0, sy = 0; // 小腿剛體向量 (Ankle -> Knee)

        // 【防守 2】核心雙模態切換 (DLT 物理正交空間 vs 螢幕像素空間)
        if (dltEngine && typeof dltEngine.applyTransform === 'function') {
            try {
                // 模式 A：使用 DLT 校正 (投影到真實物理世界的 X-Y 平面)
                dltEngine.applyTransform(this.pKnee, rawKnee.x, rawKnee.y);
                dltEngine.applyTransform(this.pAnkle, rawAnkle.x, rawAnkle.y);
                dltEngine.applyTransform(this.pHeel, rawHeel.x, rawHeel.y);
                dltEngine.applyTransform(this.pToe, rawToe.x, rawToe.y);

                // 檢查 DLT 計算是否產生奇異值 NaN 污染
                if (isNaN(this.pKnee[0]) || isNaN(this.pAnkle[0]) || isNaN(this.pHeel[0]) || isNaN(this.pToe[0])) {
                    throw new Error("DLT output contains NaN");
                }

                // 物理空間座標計算
                fx = this.pToe[0] - this.pHeel[0];
                fy = this.pToe[1] - this.pHeel[1];
                sx = this.pKnee[0] - this.pAnkle[0];
                sy = this.pKnee[1] - this.pAnkle[1];
            } catch (e) {
                // 【優雅降級】若 DLT 爆掉，Fallback 到螢幕空間，確保產線不斷線
                console.warn("AnkleKinematicsHPC: DLT failed, falling back to Screen space.");
                fx = rawToe.x - rawHeel.x;
                fy = rawToe.y - rawHeel.y;
                sx = rawKnee.x - rawAnkle.x;
                sy = rawKnee.y - rawAnkle.y;
            }
        } else {
            // 模式 B：未注入 DLT 四點校正，直接以螢幕 2D 平面計算相對夾角
            fx = rawToe.x - rawHeel.x;
            fy = rawToe.y - rawHeel.y;
            sx = rawKnee.x - rawAnkle.x;
            sy = rawKnee.y - rawAnkle.y;
        }

        // 2. 向量幾何運算
        const dot = fx * sx + fy * sy;                     // 內積
        const magF = Math.sqrt(fx * fx + fy * fy);         // 腳底向量模長
        const magS = Math.sqrt(sx * sx + sy * sy);         // 小腿向量模長

        // 【防守 3】避免分母為 0（例如特徵點極端重合時）導致除以零崩潰
        if (magF < 1e-7 || magS < 1e-7) {
            return 90.0;
        }

        // 3. 計算餘弦夾角並鉗制（Clamp）邊界值，防止浮點數微小誤差超出 [-1, 1] 導致 acos 傳回 NaN
        let cosTheta = dot / (magF * magS);
        cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta));

        // 4. 反餘弦求出精確夾角
        return Math.acos(cosTheta) * this.rad2deg;
    }
}
