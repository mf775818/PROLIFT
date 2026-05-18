/**
 * High-Performance Computing: 3D Perspective Math
 * Zero-allocation, in-place 3x3 matrix operations.
 */

export class PerspectiveMath {
    private readonly A = new Float64Array(64);
    private readonly B = new Float64Array(8);
    private readonly X = new Float64Array(8);
    private readonly srcNormMap = new Float64Array(8);
    private readonly dstNormMap = new Float64Array(8);
    private readonly temp_mat = new Float64Array(9);
    private readonly T = new Float64Array(9);
    private readonly T_prime = new Float64Array(9);
    private readonly T_prime_inv = new Float64Array(9);
    private readonly H_norm = new Float64Array(9);

    public multiplyMat3Vec3(out: Float64Array, m: Float64Array, v: Float64Array): void {
        const x = v[0];
        const y = v[1];
        const z = v[2];

        out[0] = m[0] * x + m[1] * y + m[2] * z;
        out[1] = m[3] * x + m[4] * y + m[5] * z;
        out[2] = m[6] * x + m[7] * y + m[8] * z;
    }

    public multiplyMat3Mat3(out: Float64Array, a: Float64Array, b: Float64Array): void {
        const a00 = a[0], a01 = a[1], a02 = a[2];
        const a10 = a[3], a11 = a[4], a12 = a[5];
        const a20 = a[6], a21 = a[7], a22 = a[8];

        const b00 = b[0], b01 = b[1], b02 = b[2];
        const b10 = b[3], b11 = b[4], b12 = b[5];
        const b20 = b[6], b21 = b[7], b22 = b[8];

        out[0] = a00 * b00 + a01 * b10 + a02 * b20;
        out[1] = a00 * b01 + a01 * b11 + a02 * b21;
        out[2] = a00 * b02 + a01 * b12 + a02 * b22;
        
        out[3] = a10 * b00 + a11 * b10 + a12 * b20;
        out[4] = a10 * b01 + a11 * b11 + a12 * b21;
        out[5] = a10 * b02 + a11 * b12 + a12 * b22;
        
        out[6] = a20 * b00 + a21 * b10 + a22 * b20;
        out[7] = a20 * b01 + a21 * b11 + a22 * b21;
        out[8] = a20 * b02 + a21 * b12 + a22 * b22;
    }

    public invertMat3(out: Float64Array, m: Float64Array): boolean {
        const m00 = m[0], m01 = m[1], m02 = m[2];
        const m10 = m[3], m11 = m[4], m12 = m[5];
        const m20 = m[6], m21 = m[7], m22 = m[8];

        const b01 = m22 * m11 - m12 * m21;
        const b11 = -m22 * m10 + m12 * m20;
        const b21 = m21 * m10 - m11 * m20;

        let det = m00 * b01 + m01 * b11 + m02 * b21;
        if (Math.abs(det) < 1e-10) return false;

        det = 1.0 / det;
        out[0] = b01 * det;
        out[1] = (-m22 * m01 + m02 * m21) * det;
        out[2] = (m12 * m01 - m02 * m11) * det;
        out[3] = b11 * det;
        out[4] = (m22 * m00 - m02 * m20) * det;
        out[5] = (-m12 * m00 + m02 * m10) * det;
        out[6] = b21 * det;
        out[7] = (-m21 * m00 + m01 * m20) * det;
        out[8] = (m11 * m00 - m01 * m10) * det;

        return true;
    }

    private normalizePoints(pts: number[], normPts: Float64Array, T: Float64Array): void {
        let cx = 0, cy = 0;
        for (let i = 0; i < 4; i++) {
            cx += pts[i * 2];
            cy += pts[i * 2 + 1];
        }
        cx *= 0.25; cy *= 0.25;

        let avgDist = 0;
        for (let i = 0; i < 4; i++) {
            const dx = pts[i * 2] - cx;
            const dy = pts[i * 2 + 1] - cy;
            avgDist += Math.sqrt(dx * dx + dy * dy);
        }
        avgDist *= 0.25;

        const scale = avgDist > 1e-10 ? Math.SQRT2 / avgDist : 1.0;

        T[0] = scale; T[1] = 0;     T[2] = -scale * cx;
        T[3] = 0;     T[4] = scale; T[5] = -scale * cy;
        T[6] = 0;     T[7] = 0;     T[8] = 1;

        for (let i = 0; i < 4; i++) {
            normPts[i * 2] = (pts[i * 2] - cx) * scale;
            normPts[i * 2 + 1] = (pts[i * 2 + 1] - cy) * scale;
        }
    }

    public calculateHomography(out: Float64Array, srcPts: number[], dstPts: number[]): boolean {
        if (srcPts.length !== 8 || dstPts.length !== 8) return false;

        this.normalizePoints(srcPts, this.srcNormMap, this.T);
        this.normalizePoints(dstPts, this.dstNormMap, this.T_prime);

        const A = this.A;
        const B = this.B;
        A.fill(0);

        for (let i = 0; i < 4; i++) {
            const sx = this.srcNormMap[i * 2];
            const sy = this.srcNormMap[i * 2 + 1];
            const dx = this.dstNormMap[i * 2];
            const dy = this.dstNormMap[i * 2 + 1];

            const row1 = i * 16;
            A[row1] = sx; A[row1 + 1] = sy; A[row1 + 2] = 1;
            A[row1 + 6] = -sx * dx; A[row1 + 7] = -sy * dx;
            B[i * 2] = dx;

            const row2 = i * 16 + 8;
            A[row2 + 3] = sx; A[row2 + 4] = sy; A[row2 + 5] = 1;
            A[row2 + 6] = -sx * dy; A[row2 + 7] = -sy * dy;
            B[i * 2 + 1] = dy;
        }

        for (let i = 0; i < 8; i++) {
            let maxRow = i;
            let maxVal = Math.abs(A[i * 8 + i]);
            for (let j = i + 1; j < 8; j++) {
                const val = Math.abs(A[j * 8 + i]);
                if (val > maxVal) { maxRow = j; maxVal = val; }
            }
            if (maxVal < 1e-10) return false;

            if (maxRow !== i) {
                for (let k = i; k < 8; k++) {
                    const tmp = A[i * 8 + k];
                    A[i * 8 + k] = A[maxRow * 8 + k];
                    A[maxRow * 8 + k] = tmp;
                }
                const tmpB = B[i];
                B[i] = B[maxRow];
                B[maxRow] = tmpB;
            }

            for (let j = i + 1; j < 8; j++) {
                const f = A[j * 8 + i] / A[i * 8 + i];
                for (let k = i + 1; k < 8; k++) {
                    A[j * 8 + k] -= f * A[i * 8 + k];
                }
                B[j] -= f * B[i];
            }
        }

        const X = this.X;
        for (let i = 7; i >= 0; i--) {
            let sum = 0;
            for (let j = i + 1; j < 8; j++) {
                sum += A[i * 8 + j] * X[j];
            }
            X[i] = (B[i] - sum) / A[i * 8 + i];
        }

        this.H_norm[0] = X[0]; this.H_norm[1] = X[1]; this.H_norm[2] = X[2];
        this.H_norm[3] = X[3]; this.H_norm[4] = X[4]; this.H_norm[5] = X[5];
        this.H_norm[6] = X[6]; this.H_norm[7] = X[7]; this.H_norm[8] = 1;

        if (!this.invertMat3(this.T_prime_inv, this.T_prime)) return false;

        this.multiplyMat3Mat3(this.temp_mat, this.T_prime_inv, this.H_norm);
        this.multiplyMat3Mat3(out, this.temp_mat, this.T);

        const out8 = out[8];
        if (Math.abs(out8) > 1e-10) {
            const inv = 1.0 / out8;
            for (let i = 0; i < 9; i++) out[i] *= inv;
        }

        return true;
    }
}
