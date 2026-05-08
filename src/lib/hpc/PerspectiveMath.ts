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
}
