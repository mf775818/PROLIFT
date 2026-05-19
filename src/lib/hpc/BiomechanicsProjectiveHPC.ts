import { PerspectiveMath } from './PerspectiveMath';

/**
 * High-Performance Computing: Biomechanics Projective Cross-Analysis
 * 結合槓鈴剛體與骨架平面的射影幾何分析引擎。
 * 全程使用 Float64Array in-place 運算，確保 V8 引擎 O(1) 效能。
 */
export class BiomechanicsProjectiveHPC {
    // 【修正1】拔除 static，改為實例獨享的預分配緩存
    private readonly tempLineBar = new Float64Array(3);
    private readonly tempLineShoulder = new Float64Array(3);
    private readonly tempLineHip = new Float64Array(3);
    private readonly tempVanishingPoint = new Float64Array(3);

    // 【修正2】為 DLT 轉換預先分配獨立的存放區，避免在迴圈內 new 陣列
    private readonly pB_L_trans = new Float64Array(3);
    private readonly pB_R_trans = new Float64Array(3);
    private readonly pS_L_trans = new Float64Array(3);
    private readonly pS_R_trans = new Float64Array(3);
    private readonly pH_L_trans = new Float64Array(3);
    private readonly pH_R_trans = new Float64Array(3);

    // [新增] 角度計算專用的預分配快取
    private readonly pJointA_trans = new Float64Array(3);
    private readonly pJointB_trans = new Float64Array(3);
    private readonly pJointC_trans = new Float64Array(3);

    private readonly perspectiveMath = new PerspectiveMath();

    /**
     * [新增] 算出真正無誤差的關節夾角 (例如 A=髖, B=膝, C=踝 求膝角)
     * 結合 DLT 矩陣，在完美的二維正交平面中求角
     */
    public calculateTrueJointAngle(
        jointA: Float64Array, 
        jointB: Float64Array, 
        jointC: Float64Array,
        homographyMatrix: Float64Array | Float32Array
    ): number {
        // 1. 將三個關節點過 DLT 矩陣，投影到絕對正交的真實平面
        this.perspectiveMath.multiplyMat3Vec3(this.pJointA_trans, homographyMatrix, jointA);
        this.perspectiveMath.multiplyMat3Vec3(this.pJointB_trans, homographyMatrix, jointB);
        this.perspectiveMath.multiplyMat3Vec3(this.pJointC_trans, homographyMatrix, jointC);

        // 2. 齊次座標歸一化 (除以 w)
        this.normalizeHomogeneous(this.pJointA_trans);
        this.normalizeHomogeneous(this.pJointB_trans);
        this.normalizeHomogeneous(this.pJointC_trans);

        // 3. 計算向量 BA 與 BC
        const ba_x = this.pJointA_trans[0] - this.pJointB_trans[0];
        const ba_y = this.pJointA_trans[1] - this.pJointB_trans[1];
        const bc_x = this.pJointC_trans[0] - this.pJointB_trans[0];
        const bc_y = this.pJointC_trans[1] - this.pJointB_trans[1];

        // 4. 利用 Atan2 與外積求高精度夾角
        // 內積 (Dot Product)
        const dot = ba_x * bc_x + ba_y * bc_y;
        // 2D 外積 (Cross Product Z-component) 判斷旋轉方向
        const det = ba_x * bc_y - ba_y * bc_x; 

        // atan2(y, x) 確保回傳完整的 [-180, 180] 角度，比 acos 穩定且無奇異點
        let angle = Math.atan2(Math.abs(det), dot) * (180.0 / Math.PI);
        return angle; 
    }

    // 輔助函式：原地歸一化
    private normalizeHomogeneous(vec: Float64Array): void {
        const w = vec[2];
        if (Math.abs(w) > 1e-10) {
            const invW = 1.0 / w;
            vec[0] *= invW;
            vec[1] *= invW;
            vec[2] = 1.0;
        }
    }

    public crossProduct(out: Float64Array, a: Float64Array, b: Float64Array): void {
        out[0] = a[1] * b[2] - a[2] * b[1];
        out[1] = a[2] * b[0] - a[0] * b[2];
        out[2] = a[0] * b[1] - a[1] * b[0];
    }

    public analyzeSkeletalTwist(
        outMetrics: Float64Array,
        barLeft: Float64Array, barRight: Float64Array,
        shoulderLeft: Float64Array, shoulderRight: Float64Array,
        hipLeft: Float64Array, hipRight: Float64Array,
        homographyMatrix: Float64Array | null = null
    ): void {
        let pB_L = barLeft, pB_R = barRight;
        let pS_L = shoulderLeft, pS_R = shoulderRight;
        let pH_L = hipLeft, pH_R = hipRight;

        // 【防守實作】如果有傳入 DLT 矩陣，將結果寫入預分配的 _trans 陣列，達成 Zero-Allocation
        if (homographyMatrix) {
            this.perspectiveMath.multiplyMat3Vec3(this.pB_L_trans, homographyMatrix, barLeft);
            this.perspectiveMath.multiplyMat3Vec3(this.pB_R_trans, homographyMatrix, barRight);
            this.perspectiveMath.multiplyMat3Vec3(this.pS_L_trans, homographyMatrix, shoulderLeft);
            this.perspectiveMath.multiplyMat3Vec3(this.pS_R_trans, homographyMatrix, shoulderRight);
            this.perspectiveMath.multiplyMat3Vec3(this.pH_L_trans, homographyMatrix, hipLeft);
            this.perspectiveMath.multiplyMat3Vec3(this.pH_R_trans, homographyMatrix, hipRight);

            pB_L = this.pB_L_trans; pB_R = this.pB_R_trans;
            pS_L = this.pS_L_trans; pS_R = this.pS_R_trans;
            pH_L = this.pH_L_trans; pH_R = this.pH_R_trans;

            const pts = [pB_L, pB_R, pS_L, pS_R, pH_L, pH_R];
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                if (Math.abs(p[2]) > 1e-10) {
                    const invW = 1.0 / p[2];
                    p[0] *= invW; p[1] *= invW; p[2] = 1.0;
                }
            }
        }

        // 後續的 crossProduct 全面改為呼叫實例方法 (this.crossProduct)
        this.crossProduct(this.tempLineBar, pB_L, pB_R);
        this.crossProduct(this.tempLineShoulder, pS_L, pS_R);
        this.crossProduct(this.tempLineHip, pH_L, pH_R);
        this.crossProduct(this.tempVanishingPoint, this.tempLineBar, this.tempLineShoulder);
        
        let w = this.tempVanishingPoint[2];
        let twistShoulder = 0;
        if (Math.abs(w) > 1e-7 || homographyMatrix) {
             twistShoulder = this.calculateAngularDivergence(this.tempLineBar, this.tempLineShoulder);
        }

        let twistHip = this.calculateAngularDivergence(this.tempLineBar, this.tempLineHip);

        outMetrics[0] = twistShoulder;
        outMetrics[1] = twistHip;
    }

    public constrainHandToBarbell(
        outHand: Float64Array,
        rawHand: Float64Array,
        barLeft: Float64Array, 
        barRight: Float64Array
    ): void {
        this.crossProduct(this.tempLineBar, barLeft, barRight);
        const a = this.tempLineBar[0];
        const b = this.tempLineBar[1];
        const c = this.tempLineBar[2];

        const x0 = rawHand[0] / rawHand[2];
        const y0 = rawHand[1] / rawHand[2];
        const denominator = a * a + b * b;

        if (denominator < 1e-10) {
            outHand[0] = rawHand[0]; outHand[1] = rawHand[1]; outHand[2] = 1;
            return;
        }

        outHand[0] = (b * (b * x0 - a * y0) - a * c) / denominator;
        outHand[1] = (a * (-b * x0 + a * y0) - b * c) / denominator;
        outHand[2] = 1.0;
    }

    private calculateAngularDivergence(lineA: Float64Array, lineB: Float64Array): number {
        const dot = lineA[0] * lineB[0] + lineA[1] * lineB[1];
        const magA = Math.sqrt(lineA[0] * lineA[0] + lineA[1] * lineA[1]);
        const magB = Math.sqrt(lineB[0] * lineB[0] + lineB[1] * lineB[1]);
        
        if (magA < 1e-7 || magB < 1e-7) return 0;
        
        let cosTheta = dot / (magA * magB);
        cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta)); 
        return Math.acos(cosTheta) * (180.0 / Math.PI);
    }
}
