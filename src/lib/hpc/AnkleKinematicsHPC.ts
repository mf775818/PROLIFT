/**
 * 高效能腳踝運動學計算引擎 (Ankle Kinematics HPC)
 * 負責計算腳踝相對於腳底板平面的真實夾角，支援 DLT/螢幕雙模態自動切換與零分配防守
 */
export class AnkleKinematicsHPC {
    // MediaPipe 關鍵點索引常數
    private static readonly NOSE = 0;
    private static readonly LEFT_EAR = 7;
    private static readonly RIGHT_EAR = 8;

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
     * 內部分守：安全取得朝向 (1 表示朝右, -1 表示朝左)
     */
    private getFacingDirection(landmarks: any[], dltEngine?: any | null): number {
        if (!landmarks || landmarks.length === 0) return 1.0; 
        
        // 優先邏輯：DLT 標定提示
        if (dltEngine && dltEngine.facingHint !== undefined) {
            return dltEngine.facingHint;
        }

        // 次要邏輯：腳踝 -> 腳尖
        if (landmarks.length > AnkleKinematicsHPC.RIGHT_FOOT_INDEX) {
            const leftAnkle = landmarks[AnkleKinematicsHPC.LEFT_ANKLE];
            const leftToe = landmarks[AnkleKinematicsHPC.LEFT_FOOT_INDEX];
            const rightAnkle = landmarks[AnkleKinematicsHPC.RIGHT_ANKLE];
            const rightToe = landmarks[AnkleKinematicsHPC.RIGHT_FOOT_INDEX];

            const leftVis = leftAnkle?.visibility ?? 0;
            const rightVis = rightAnkle?.visibility ?? 0;

            if (leftVis > 0.5 || rightVis > 0.5) {
                const ankle = (leftVis > rightVis) ? leftAnkle : rightAnkle;
                const toe = (leftVis > rightVis) ? leftToe : rightToe;
                if (ankle && toe && Math.abs(toe.x - ankle.x) > 0.01) {
                    return (toe.x > ankle.x) ? 1.0 : -1.0;
                }
            }
        }

        // 最終回退：鼻部 -> 耳朵
        const nose = landmarks[AnkleKinematicsHPC.NOSE];
        const leftEar = landmarks[AnkleKinematicsHPC.LEFT_EAR];
        const rightEar = landmarks[AnkleKinematicsHPC.RIGHT_EAR];
        const ear = ((leftEar?.visibility ?? 0) > (rightEar?.visibility ?? 0)) ? leftEar : rightEar;
        if (nose && ear && Math.abs(nose.x - ear.x) > 0.01) {
             return (nose.x > ear.x) ? 1.0 : -1.0;
        }

        return 1.0;
    }

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

        // 【工業級強化】增加切換遲滯 (Hysteresis)，減少在正側身時左右腳切換導致的跳動
        const isLeft = leftVis >= (rightVis * 0.95);

        const kneeIdx  = isLeft ? AnkleKinematicsHPC.LEFT_KNEE : AnkleKinematicsHPC.RIGHT_KNEE;
        const ankleIdx = isLeft ? AnkleKinematicsHPC.LEFT_ANKLE : AnkleKinematicsHPC.RIGHT_ANKLE;
        const heelIdx  = isLeft ? AnkleKinematicsHPC.LEFT_HEEL : AnkleKinematicsHPC.RIGHT_HEEL;
        const toeIdx   = isLeft ? AnkleKinematicsHPC.LEFT_FOOT_INDEX : AnkleKinematicsHPC.RIGHT_FOOT_INDEX;

        const rawKnee  = landmarks[kneeIdx];
        const rawAnkle = landmarks[ankleIdx];
        const rawHeel  = landmarks[heelIdx];
        const rawToe   = landmarks[toeIdx];

        if (!rawKnee || !rawAnkle) return 90.0;

        // 【防守 2】判斷腳底特徵點是否被遮擋 (信賴度不足)
        // 腳跟或腳尖可見度過低時（< 0.5 代表有明顯遮擋），觸發防守機制
        const heelVis = rawHeel?.visibility ?? 0;
        const toeVis = rawToe?.visibility ?? 0;
        const isFootOccluded = (!rawHeel || !rawToe) || (heelVis < 0.8 || toeVis < 0.8);

        let fx = 0, fy = 0; // 腳底板平面向量 (Heel -> Toe)
        let sx = 0, sy = 0; // 小腿剛體向量 (Ankle -> Knee)

        // 【防守 3】核心雙模態切換 (DLT 物理正交空間 vs 螢幕像素空間)
        if (dltEngine && typeof dltEngine.applyTransform === 'function') {
            try {
                // 模式 A：使用 DLT 校正 (投影到真實物理世界的 X-Y 平面)
                dltEngine.applyTransform(this.pKnee, rawKnee.x, rawKnee.y);
                dltEngine.applyTransform(this.pAnkle, rawAnkle.x, rawAnkle.y);

                // 檢查 DLT 計算是否產生奇異值 NaN 污染
                if (isNaN(this.pKnee[0]) || isNaN(this.pAnkle[0])) {
                    throw new Error("DLT output contains NaN");
                }

                // 物理空間座標計算 (物理空間 Y 箭頭朝上，Knee 較高所以 pKnee.y > pAnkle.y 照理說不會發生，DLT 視線也可能翻轉Y)
                // 為了與 fallback 一致，我們先保留原始向量
                sx = this.pKnee[0] - this.pAnkle[0];
                sy = -(this.pKnee[1] - this.pAnkle[1]); 

                if (!isFootOccluded) {
                    dltEngine.applyTransform(this.pHeel, rawHeel.x, rawHeel.y);
                    dltEngine.applyTransform(this.pToe, rawToe.x, rawToe.y);

                    if (isNaN(this.pHeel[0]) || isNaN(this.pToe[0])) {
                        throw new Error("DLT output contains NaN for Foot");
                    }

                    fx = this.pToe[0] - this.pHeel[0];
                    fy = -(this.pToe[1] - this.pHeel[1]);
                }
            } catch (e) {
                // 【優雅降級】若 DLT 爆掉，Fallback 到螢幕空間，確保產線不斷線
                console.warn("AnkleKinematicsHPC: DLT failed, falling back to Screen space.");
                sx = rawKnee.x - rawAnkle.x;
                sy = rawAnkle.y - rawKnee.y; // 反轉 Y 軸

                if (!isFootOccluded && rawHeel && rawToe) {
                    fx = rawToe.x - rawHeel.x;
                    fy = rawHeel.y - rawToe.y; // 反轉 Y 軸
                }
            }
        } else {
            // 模式 B：未注入 DLT 四點校正，直接以螢幕 2D 平面計算相對夾角
            sx = rawKnee.x - rawAnkle.x;
            sy = rawAnkle.y - rawKnee.y; // 反轉 Y 軸

            if (!isFootOccluded && rawHeel && rawToe) {
                fx = rawToe.x - rawHeel.x;
                fy = rawHeel.y - rawToe.y; // 反轉 Y 軸
            }
        }

        // 【防守 4】遮擋降級：使用絕對 X 軸作為水平腳底平面，邏輯與背角一致 (atan2)
        if (isFootOccluded) {
            const facing = this.getFacingDirection(landmarks, dltEngine);
            const adjustedSx = sx * facing;
            // sy 是 knee - ankle, 與背部 dy = hip - shoulder 是同向 (下方減上方)
            // atan2 角度: 0度是水平向前, 90度是垂直向上 (直立)
            if (Math.abs(adjustedSx) < 1e-7 && Math.abs(sy) < 1e-7) return 90.0;
            let angle = Math.atan2(sy, adjustedSx) * this.rad2deg;
            
            // 移除先前的強制鉗制 (angle < -90 -> 180) 來解決突跳異常
            // 改為平滑的連續角度空間，允許自然的正負過渡
            while (angle <= -180.0) angle += 360.0;
            while (angle > 180.0) angle -= 360.0;
            
            return angle;
        }

        // 2. 向量幾何運算 (未遮擋時，計算與真實腳底平面的夾角)
        const dot = fx * sx + fy * sy;                     // 內積
        const magF = Math.sqrt(fx * fx + fy * fy);         // 腳底向量模長
        const magS = Math.sqrt(sx * sx + sy * sy);         // 小腿向量模長

        // 【防守 5】避免分母為 0（例如特徵點極端重合時）導致除以零崩潰
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
