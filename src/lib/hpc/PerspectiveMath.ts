/**
 * High-Performance Computing: 3D Perspective Math
 * Zero-allocation, in-place 3x3 matrix operations.
 */

export class PerspectiveMath {
    /**
     * Multiplies a 3x3 matrix by a 3D vector. 
     * Output is written to the provided `out` array to avoid allocation.
     * 
     * @param out Float64Array[3] - The target array for the result
     * @param m Float64Array[9] - The 3x3 transformation matrix
     * @param v Float64Array[3] - The 3D vector to transform
     */
    public static multiplyMat3Vec3(out: Float64Array, m: Float64Array, v: Float64Array): void {
        const x = v[0];
        const y = v[1];
        const z = v[2];

        out[0] = m[0] * x + m[1] * y + m[2] * z;
        out[1] = m[3] * x + m[4] * y + m[5] * z;
        out[2] = m[6] * x + m[7] * y + m[8] * z;
    }

    /**
     * Inverts a 3x3 matrix in-place or into an output buffer.
     * Includes protection against singular matrices.
     * 
     * @param out Float64Array[9] - Output inverted matrix
     * @param m Float64Array[9] - Input matrix
     * @returns boolean - True if successful, False if matrix is singular (non-invertible)
     */
    public static invertMat3(out: Float64Array, m: Float64Array): boolean {
        const m00 = m[0], m01 = m[1], m02 = m[2];
        const m10 = m[3], m11 = m[4], m12 = m[5];
        const m20 = m[6], m21 = m[7], m22 = m[8];

        const b01 = m22 * m11 - m12 * m21;
        const b11 = -m22 * m10 + m12 * m20;
        const b21 = m21 * m10 - m11 * m20;

        // Calculate determinant
        let det = m00 * b01 + m01 * b11 + m02 * b21;

        if (Math.abs(det) < 1e-10) {
            return false; // Singular matrix guard
        }

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

    /**
     * Calculates the 3x3 Homography matrix that maps srcPts to dstPts.
     * @param out Float64Array[9] - Output Homography matrix
     * @param srcPts Array of 8 numbers - [x1, y1, x2, y2, x3, y3, x4, y4]
     * @param dstPts Array of 8 numbers - [x1, y1, x2, y2, x3, y3, x4, y4]
     * @returns boolean - True if successful
     */
    public static calculateHomography(out: Float64Array, srcPts: number[], dstPts: number[]): boolean {
        // Simple 4-point DLT (Direct Linear Transformation) for Homography
        if (srcPts.length !== 8 || dstPts.length !== 8) return false;

        const A = new Array(8).fill(0).map(() => new Float64Array(8));
        const B = new Float64Array(8);

        for (let i = 0; i < 4; i++) {
            const sx = srcPts[i * 2];
            const sy = srcPts[i * 2 + 1];
            const dx = dstPts[i * 2];
            const dy = dstPts[i * 2 + 1];

            A[i * 2][0] = sx;
            A[i * 2][1] = sy;
            A[i * 2][2] = 1;
            A[i * 2][3] = 0;
            A[i * 2][4] = 0;
            A[i * 2][5] = 0;
            A[i * 2][6] = -sx * dx;
            A[i * 2][7] = -sy * dx;
            B[i * 2] = dx;

            A[i * 2 + 1][0] = 0;
            A[i * 2 + 1][1] = 0;
            A[i * 2 + 1][2] = 0;
            A[i * 2 + 1][3] = sx;
            A[i * 2 + 1][4] = sy;
            A[i * 2 + 1][5] = 1;
            A[i * 2 + 1][6] = -sx * dy;
            A[i * 2 + 1][7] = -sy * dy;
            B[i * 2 + 1] = dy;
        }

        // Gaussian elimination with partial pivoting to solve 8x8 linear system Ax = B
        for (let i = 0; i < 8; i++) {
            let maxRow = i;
            for (let j = i + 1; j < 8; j++) {
                if (Math.abs(A[j][i]) > Math.abs(A[maxRow][i])) {
                    maxRow = j;
                }
            }
            if (Math.abs(A[maxRow][i]) < 1e-10) return false; // Singular

            // Swap rows
            [A[i], A[maxRow]] = [A[maxRow], A[i]];
            const tempB = B[i];
            B[i] = B[maxRow];
            B[maxRow] = tempB;

            // Eliminate
            for (let j = i + 1; j < 8; j++) {
                const f = A[j][i] / A[i][i];
                for (let k = i + 1; k < 8; k++) {
                    A[j][k] -= f * A[i][k];
                }
                B[j] -= f * B[i];
            }
        }

        // Back substitution
        const x = new Float64Array(8);
        for (let i = 7; i >= 0; i--) {
            let sum = 0;
            for (let j = i + 1; j < 8; j++) {
                sum += A[i][j] * x[j];
            }
            x[i] = (B[i] - sum) / A[i][i];
        }

        out[0] = x[0]; out[1] = x[1]; out[2] = x[2];
        out[3] = x[3]; out[4] = x[4]; out[5] = x[5];
        out[6] = x[6]; out[7] = x[7]; out[8] = 1;

        return true;
    }
}
