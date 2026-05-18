/**
 * 高效能腳踝運動學計算引擎 (Ankle Kinematics HPC)
 * 負責計算腳踝相對於腳底板平面的真實夾角，支援 DLT/螢幕雙模態自動切換與零分配防守
 */
export class AnkleKinematicsHPC {
    // MediaPipe 關鍵點索引常數
    public readonly NOSE = 0;
    public readonly LEFT_EAR = 7;
    public readonly RIGHT_EAR = 8;

    public readonly LEFT_KNEE = 25;
    public readonly RIGHT_KNEE = 26;
    public readonly LEFT_ANKLE = 27;
    public readonly RIGHT_ANKLE = 28;
    public readonly LEFT_HEEL = 29;
    public readonly RIGHT_HEEL = 30;
    public readonly LEFT_FOOT_INDEX = 31;
    public readonly RIGHT_FOOT_INDEX = 32;

    // 預分配實例級別緩存區，徹底根除 Hot-loop 中的 GC 壓力（保證執行緒安全）
    private readonly pKnee = new Float64Array(2);
    private readonly pAnkle = new Float64Array(2);
    private readonly pHeel = new Float64Array(2);
    private readonly pToe = new Float64Array(2);
    
    public readonly rad2deg = 180.0 / Math.PI;

    private getFacingDirection(landmarks: any[], dltEngine?: any | null): number {
        if (!landmarks || landmarks.length === 0) return 1.0; 
        
        if (dltEngine && dltEngine.facingHint !== undefined) {
            return dltEngine.facingHint;
        }

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
        const ear = ((leftEar?.visibility ?? 0) > (rightEar?.visibility ?? 0)) ? leftEar : rightEar;
        if (nose && ear && Math.abs(nose.x - ear.x) > 0.01) {
             return (nose.x > ear.x) ? 1.0 : -1.0;
        }

        return 1.0;
    }

    public calculateSpecificAnkleAngle(landmarks: any[], isLeft: boolean, dltEngine?: any | null): number {
        if (!landmarks || landmarks.length <= this.RIGHT_FOOT_INDEX) {
            return 90.0; 
        }

        const kneeIdx  = isLeft ? this.LEFT_KNEE : this.RIGHT_KNEE;
        const ankleIdx = isLeft ? this.LEFT_ANKLE : this.RIGHT_ANKLE;
        const heelIdx  = isLeft ? this.LEFT_HEEL : this.RIGHT_HEEL;
        const toeIdx   = isLeft ? this.LEFT_FOOT_INDEX : this.RIGHT_FOOT_INDEX;

        const rawKnee  = landmarks[kneeIdx];
        const rawAnkle = landmarks[ankleIdx];
        const rawHeel  = landmarks[heelIdx];
        const rawToe   = landmarks[toeIdx];

        if (!rawKnee || !rawAnkle) return 90.0;

        const heelVis = rawHeel?.visibility ?? 0;
        const toeVis = rawToe?.visibility ?? 0;
        const isFootOccluded = (!rawHeel || !rawToe) || (heelVis < 0.8 || toeVis < 0.8);

        let fx = 0, fy = 0; 
        let sx = 0, sy = 0; 

        if (dltEngine && typeof dltEngine.applyTransform === 'function') {
            try {
                dltEngine.applyTransform(this.pKnee, rawKnee.x, rawKnee.y);
                dltEngine.applyTransform(this.pAnkle, rawAnkle.x, rawAnkle.y);

                if (isNaN(this.pKnee[0]) || isNaN(this.pAnkle[0])) {
                    throw new Error("DLT output contains NaN");
                }

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
                console.warn("AnkleKinematicsHPC: DLT failed, falling back to Screen space.");
                sx = rawKnee.x - rawAnkle.x;
                sy = rawAnkle.y - rawKnee.y; 

                if (!isFootOccluded && rawHeel && rawToe) {
                    fx = rawToe.x - rawHeel.x;
                    fy = rawHeel.y - rawToe.y; 
                }
            }
        } else {
            sx = rawKnee.x - rawAnkle.x;
            sy = rawAnkle.y - rawKnee.y; 

            if (!isFootOccluded && rawHeel && rawToe) {
                fx = rawToe.x - rawHeel.x;
                fy = rawHeel.y - rawToe.y; 
            }
        }

        if (isFootOccluded) {
            const facing = this.getFacingDirection(landmarks, dltEngine);
            const adjustedSx = sx * facing;
            if (Math.abs(adjustedSx) < 1e-7 && Math.abs(sy) < 1e-7) return 90.0;
            let angle = Math.atan2(sy, adjustedSx) * this.rad2deg;
            
            while (angle <= -180.0) angle += 360.0;
            while (angle > 180.0) angle -= 360.0;
            
            return angle;
        }

        const dot = fx * sx + fy * sy;                     
        const magF = Math.sqrt(fx * fx + fy * fy);         
        const magS = Math.sqrt(sx * sx + sy * sy);         

        if (magF < 1e-7 || magS < 1e-7) {
            return 90.0;
        }

        let cosTheta = dot / (magF * magS);
        cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta));

        return Math.acos(cosTheta) * this.rad2deg;
    }

    public calculateAnkleAngle(landmarks: any[], dltEngine?: any | null): number {
        if (!landmarks || landmarks.length <= this.RIGHT_FOOT_INDEX) {
            return 90.0; 
        }

        const leftVis = (landmarks[this.LEFT_KNEE]?.visibility ?? 0) + 
                        (landmarks[this.LEFT_ANKLE]?.visibility ?? 0) + 
                        (landmarks[this.LEFT_HEEL]?.visibility ?? 0) + 
                        (landmarks[this.LEFT_FOOT_INDEX]?.visibility ?? 0);

        const rightVis = (landmarks[this.RIGHT_KNEE]?.visibility ?? 0) + 
                         (landmarks[this.RIGHT_ANKLE]?.visibility ?? 0) + 
                         (landmarks[this.RIGHT_HEEL]?.visibility ?? 0) + 
                         (landmarks[this.RIGHT_FOOT_INDEX]?.visibility ?? 0);

        const isLeft = leftVis >= (rightVis * 0.95);
        return this.calculateSpecificAnkleAngle(landmarks, isLeft, dltEngine);
    }
}
