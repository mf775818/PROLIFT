/**
 * 高效能脊椎運動學計算引擎 (Spine Kinematics HPC)
 * 具備 DLT/螢幕雙模態自動切換與零分配防守機制
 */
export class SpineKinematicsHPC {
    // MediaPipe 關鍵點索引常數
    private static readonly NOSE = 0;
    private static readonly LEFT_EAR = 7;
    private static readonly RIGHT_EAR = 8;
    private static readonly LEFT_SHOULDER = 11;
    private static readonly RIGHT_SHOULDER = 12;
    private static readonly LEFT_HIP = 23;
    private static readonly RIGHT_HIP = 24;

    // 預先分配的實例級別緩存，100% 避免 GC 壓力
    private static readonly pShoulder = new Float64Array(2);
    private static readonly pHip = new Float64Array(2);
    private static readonly rad2deg = 180.0 / Math.PI;

    /**
     * 內部分守：安全取得朝向 (1 表示朝右, -1 表示朝左)
     */
    private static getFacingDirection(landmarks: any[]): number {
        if (!landmarks || landmarks.length === 0) return 1.0; // 預設朝右
        
        const nose = landmarks[this.NOSE];
        const leftEar = landmarks[this.LEFT_EAR];
        const rightEar = landmarks[this.RIGHT_EAR];
        
        if (!nose || (!leftEar && !rightEar)) return 1.0;

        // 選擇可見度較高的耳朵進行基準比較
        const ear = ((leftEar?.visibility ?? 0) > (rightEar?.visibility ?? 0)) ? leftEar : rightEar;
        if (!ear) return 1.0;

        return (nose.x > ear.x) ? 1.0 : -1.0;
    }

    /**
     * 計算背部角度 (支援有/無 DLT 校正之自動適配)
     * * @param landmarks MediaPipe 原始關鍵點數據 (應包含 x, y, visibility)
     * @param dltEngine 可選的 CalibrationEngine 實例 (若未注入或未校正成功則傳入 null/undefined)
     * @returns number - 背部與地面的夾角 (直立90度, 俯身0-90度, 仰身90-180度)
     */
    public static calculateBackAngle(landmarks: any[], dltEngine?: any | null): number {
        // 【防守 1】基本輸入校驗，防止 MediaPipe 偵測丟失時崩潰
        if (!landmarks || landmarks.length <= this.RIGHT_HIP) {
            console.warn("SpineKinematicsHPC: Invalid landmarks input.");
            return 90.0; // 降級回傳標準直立角度
        }

        // 1. 動態決定使用左側或右側 (基於可見度 Visibility，避開轉身時的遮擋噪點)
        const leftShoulderVis = landmarks[this.LEFT_SHOULDER]?.visibility ?? 0;
        const rightShoulderVis = landmarks[this.RIGHT_SHOULDER]?.visibility ?? 0;
        const isLeftVisible = leftShoulderVis > rightShoulderVis;
        
        const shoulderIdx = isLeftVisible ? this.LEFT_SHOULDER : this.RIGHT_SHOULDER;
        const hipIdx = isLeftVisible ? this.LEFT_HIP : this.RIGHT_HIP;

        const rawShoulder = landmarks[shoulderIdx];
        const rawHip = landmarks[hipIdx];

        if (!rawShoulder || !rawHip) return 90.0;

        let dx = 0;
        let dy = 0;

        // 【防守 2】核心雙模態切換：檢查 DLT 引擎是否有效注入且具備轉換能力
        // 這裡會檢查對象是否存在，且是否有 applyTransform 方法
        if (dltEngine && typeof dltEngine.applyTransform === 'function') {
            try {
                // 模式 A：使用 DLT 校正（以 DLT X 軸為真實物理平面）
                dltEngine.applyTransform(this.pShoulder, rawShoulder.x, rawShoulder.y);
                dltEngine.applyTransform(this.pHip, rawHip.x, rawHip.y);

                // 檢查 DLT 轉換是否回傳了 NaN (代表點位退化或超出校正範圍)
                if (isNaN(this.pShoulder[0]) || isNaN(this.pHip[0])) {
                    throw new Error("DLT output contains NaN");
                }

                dx = this.pShoulder[0] - this.pHip[0];
                // 物理空間通常 Y 軸朝上（與螢幕相反），故將 Delta Y 反轉
                dy = -(this.pShoulder[1] - this.pHip[1]); 
            } catch (e) {
                // 【優雅降級】若 DLT 計算中途出錯，自動 fallback 到螢幕座標系，確保不崩潰
                console.warn("SpineKinematicsHPC: DLT failed, falling back to Screen space.", e);
                dx = rawShoulder.x - rawHip.x;
                // 螢幕空間 Y 軸朝下，肩在髖上方時，rawShoulder.y < rawHip.y
                // 為了讓直立時向量朝上，必須是 Hip Y 減去 Shoulder Y
                dy = rawHip.y - rawShoulder.y; 
            }
        } else {
            // 模式 B：未注入 DLT 校正（直接以圖片/螢幕的 X 軸為平面基準點）
            dx = rawShoulder.x - rawHip.x;
            dy = rawHip.y - rawShoulder.y; 
        }

        // 2. 取得人體朝向並進行 X 軸對齊修正
        const facing = this.getFacingDirection(landmarks);
        
        // 將 dx 乘上朝向。朝右(1)保持不變；朝左(-1)則反轉符號
        // 這一步能確保：只要是「往前胸俯身」，adjustedDx 永遠為正；「往後背仰身」，adjustedDx 永遠為負
        const adjustedDx = dx * facing;

        // 【防守 3】防止 dx 與 dy 同時為 0 導致 Math.atan2 出現未定義結果
        if (Math.abs(adjustedDx) < 1e-7 && Math.abs(dy) < 1e-7) {
            return 90.0;
        }

        // 3. 使用 Atan2 計算與 X 平面的夾角
        let angle = Math.atan2(dy, adjustedDx) * this.rad2deg;

        // 4. 角度邊界鉗制與負值防守（肩膀低於髖部時為負值）
        // angle 的範圍預設在 -180 ~ 180 之間：
        // 0 ~ 90: 正常俯身
        // 90 ~ 180: 向後仰身
        // 0 ~ -90: 過度俯身 (肩膀低於髖部) -> 保留負值！
        // -90 ~ -180: 極度向後仰身超過水平 (人類極限外) -> 鉗制為 180
        
        if (angle < -90) {
            angle = 180.0; 
        } else if (angle > 180) {
            angle = 180.0; 
        }

        return angle;
    }
}
