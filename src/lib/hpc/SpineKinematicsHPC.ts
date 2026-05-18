/**
 * 高效能脊椎運動學計算引擎 (Spine Kinematics HPC)
 * 具備 DLT/螢幕雙模態自動切換與零分配防守機制
 */
export class SpineKinematicsHPC {
    // MediaPipe 關鍵點索引常數
    public readonly NOSE = 0;
    public readonly LEFT_EAR = 7;
    public readonly RIGHT_EAR = 8;
    public readonly LEFT_SHOULDER = 11;
    public readonly RIGHT_SHOULDER = 12;
    public readonly LEFT_HIP = 23;
    public readonly RIGHT_HIP = 24;
    public readonly LEFT_ANKLE = 27;
    public readonly RIGHT_ANKLE = 28;
    public readonly LEFT_FOOT_INDEX = 31;
    public readonly RIGHT_FOOT_INDEX = 32;

    // 預先分配的實例級別緩存，100% 避免 GC 壓力
    private readonly pShoulder = new Float64Array(2);
    private readonly pHip = new Float64Array(2);
    public readonly rad2deg = 180.0 / Math.PI;

    private getFacingDirection(landmarks: any[]): number {
        if (!landmarks || landmarks.length === 0) return 1.0; 
        
        if (landmarks.length > this.RIGHT_FOOT_INDEX) {
            const leftAnkle = landmarks[this.LEFT_ANKLE];
            const leftToe = landmarks[this.LEFT_FOOT_INDEX];
            const rightAnkle = landmarks[this.RIGHT_ANKLE];
            const rightToe = landmarks[this.RIGHT_FOOT_INDEX];

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

        const nose = landmarks[this.NOSE];
        const leftEar = landmarks[this.LEFT_EAR];
        const rightEar = landmarks[this.RIGHT_EAR];
        
        if (nose && (leftEar || rightEar)) {
            const ear = ((leftEar?.visibility ?? 0) > (rightEar?.visibility ?? 0)) ? leftEar : rightEar;
            if (ear && Math.abs(nose.x - ear.x) > 0.01) {
                return (nose.x > ear.x) ? 1.0 : -1.0;
            }
        }

        return 1.0; 
    }

    public calculateBackAngle(landmarks: any[], dltEngine?: any | null): number {
        if (!landmarks || landmarks.length <= this.RIGHT_HIP) {
            console.warn("SpineKinematicsHPC: Invalid landmarks input.");
            return 90.0;
        }

        const leftShoulderVis = landmarks[this.LEFT_SHOULDER]?.visibility ?? 0;
        const rightShoulderVis = landmarks[this.RIGHT_SHOULDER]?.visibility ?? 0;
        const leftHipVis = landmarks[this.LEFT_HIP]?.visibility ?? 0;
        const rightHipVis = landmarks[this.RIGHT_HIP]?.visibility ?? 0;

        const leftTotalVis = leftShoulderVis + leftHipVis;
        const rightTotalVis = rightShoulderVis + rightHipVis;
        
        const isLeftVisible = leftTotalVis >= (rightTotalVis * 0.9);
        
        const shoulderIdx = isLeftVisible ? this.LEFT_SHOULDER : this.RIGHT_SHOULDER;
        const hipIdx = isLeftVisible ? this.LEFT_HIP : this.RIGHT_HIP;

        const rawShoulder = landmarks[shoulderIdx];
        const rawHip = landmarks[hipIdx];

        if (!rawShoulder || !rawHip) return 90.0;

        let dx = 0;
        let dy = 0;

        if (dltEngine && typeof dltEngine.applyTransform === 'function') {
            try {
                dltEngine.applyTransform(this.pShoulder, rawShoulder.x, rawShoulder.y);
                dltEngine.applyTransform(this.pHip, rawHip.x, rawHip.y);

                if (isNaN(this.pShoulder[0]) || isNaN(this.pHip[0])) {
                    throw new Error("DLT output contains NaN");
                }

                dx = this.pShoulder[0] - this.pHip[0];
                dy = -(this.pShoulder[1] - this.pHip[1]); 
            } catch (e) {
                console.warn("SpineKinematicsHPC: DLT failed, falling back to Screen space.", e);
                dx = rawShoulder.x - rawHip.x;
                dy = rawHip.y - rawShoulder.y; 
            }
        } else {
            dx = rawShoulder.x - rawHip.x;
            dy = rawHip.y - rawShoulder.y; 
        }

        let facing = 1.0;
        if (dltEngine && dltEngine.facingHint !== undefined) {
            facing = dltEngine.facingHint;
        } else {
            facing = this.getFacingDirection(landmarks);
        }
        
        const adjustedDx = dx * facing;

        if (Math.abs(adjustedDx) < 1e-7 && Math.abs(dy) < 1e-7) {
            return 90.0;
        }

        let angle = Math.atan2(dy, adjustedDx) * this.rad2deg;

        while (angle <= -180.0) angle += 360.0;
        while (angle > 180.0) angle -= 360.0;

        return angle;
    }
}
