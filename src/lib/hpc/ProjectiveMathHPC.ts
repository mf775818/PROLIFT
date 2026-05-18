import { PerspectiveMath } from './PerspectiveMath';

/**
 * 高效能射影幾何引擎 (Projective Geometry HPC)
 * 利用極點與極線 (Poles and Polars) 計算真實的 3D 物理特徵
 */
export class ProjectiveMathHPC {
    // 預先分配記憶體，避免在 hot-loop 中觸發 GC
    private static tempMatrix: Float64Array = new Float64Array(9);
    
    /**
     * 從 2D 橢圓 (槓鈴片) 計算真實的 3D 物理投影中心
     * 理論：真實物理中心是無窮遠線 (消失線) 相對於橢圓的極點。
     * 公式：p = Q^(-1) * l
     * @param outCenter Float64Array[3] - 輸出的齊次座標 [x, y, w] (需轉換為 x/w, y/w)
     * @param conicMatrixQ Float64Array[9] - 2D 橢圓的 3x3 對稱矩陣 (由影像辨識/邊緣擬合提供)
     * @param vanishingLine Float64Array[3] - 畫面的消失線 (由槓鈴軸線與場地平行線計算而得)
     * @returns boolean - 矩陣是否可逆 (若橢圓退化成線則返回 false)
     */
    public static computeTruePhysicalCenter(
        outCenter: Float64Array, 
        conicMatrixQ: Float64Array, 
        vanishingLine: Float64Array
    ): boolean {
        // 1. 求橢圓矩陣的反矩陣 Q^(-1)
        const invertible = PerspectiveMath.invertMat3(this.tempMatrix, conicMatrixQ);
        if (!invertible) return false;

        // 2. 極點公式 p = Q^(-1) * l
        // 將反矩陣乘上消失線，直接得到真實的投影中心
        PerspectiveMath.multiplyMat3Vec3(outCenter, this.tempMatrix, vanishingLine);

        // 3. 齊次座標正規化 (Homogeneous Normalization)
        // 避免 w = 0 的無窮遠點 (理論上中心不會在無窮遠)
        const w = outCenter[2];
        if (Math.abs(w) > 1e-10) {
            const invW = 1.0 / w;
            outCenter[0] *= invW;
            outCenter[1] *= invW;
            outCenter[2] = 1.0;
        }

        return true;
    }

    /**
     * 計算極線 (Polar Line) 
     * 可用於已知真實中心，反推 2D 畫面中垂直於該中心的透視輔助線
     * 公式：l = Q * p
     */
    public static computePolarLine(
        outLine: Float64Array,
        conicMatrixQ: Float64Array,
        pole: Float64Array
    ): void {
        PerspectiveMath.multiplyMat3Vec3(outLine, conicMatrixQ, pole);
    }
}

import { TrackingBuffer } from './TrackingBuffer';

// Pre-allocate memory to avoid garbage collection in hot-loops
const trueLeftCenter = new Float64Array(3);
const trueRightCenter = new Float64Array(3);

// 虛擬範例：在每一幀處理時修正 TrackingBuffer
export function refineTrackingWithProjectiveGeometry(
    buffer: TrackingBuffer, 
    leftPlateConic: Float64Array, 
    rightPlateConic: Float64Array, 
    vanishingLine: Float64Array,
    frameIndex: number
): void {
    // 利用極點極線求出該幀槓鈴真正的 3D 投影中心
    const successL = ProjectiveMathHPC.computeTruePhysicalCenter(trueLeftCenter, leftPlateConic, vanishingLine);
    const successR = ProjectiveMathHPC.computeTruePhysicalCenter(trueRightCenter, rightPlateConic, vanishingLine);

    if (successL && successR) {
        // 將修正後的真實中心覆寫回 TrackingBuffer
        // 這會讓 PhysicsEngineHPC 算出的速度 (vel) 與作功 (power) 更接近真實物理量
        buffer.x[frameIndex] = (trueLeftCenter[0] + trueRightCenter[0]) * 0.5;
        buffer.y[frameIndex] = (trueLeftCenter[1] + trueRightCenter[1]) * 0.5;
        
        // 進階：利用 trueLeftCenter 與 trueRightCenter 的透視長度，
        // 與已知的真實槓鈴長度 (如 220cm) 進行 Cross-Ratio (交比) 計算，求出精準的 Z 軸深度。
    }
}
