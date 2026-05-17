import { PerspectiveMath } from './PerspectiveMath';

/**
 * 3D Vision Calibration Engine
 * Solves Direct Linear Transformation (DLT) for 3x3 Homography Matrix
 * without memory allocation per frame.
 */
export class CalibrationEngine {
    // 3x3 Transformation Matrix (Screen -> Physical)
    private readonly H = new Float64Array(9);
    
    // Intermediate working memory for applyTransform (avoid allocations)
    private readonly vec3In = new Float64Array(3);
    private readonly vec3Out = new Float64Array(3);

    /**
     * Set up perspective calibration.
     * 
     * @param srcPts Number[] - 4 points in 2D image coords [x0, y0, x1, y1, x2, y2, x3, y3]
     * @param dstPts Number[] - 4 points in Physical (meters) coords [X0, Y0, ... ]
     * @returns boolean - True if homography successfully computed
     */
    public calibrate(srcPts: number[], dstPts: number[]): boolean {
        if (srcPts.length !== 8 || dstPts.length !== 8) return false;

        const success = PerspectiveMath.calculateHomography(this.H, srcPts, dstPts);
        if (!success) {
            // Fallback to Identity if singular
            this.H.set([
                1, 0, 0, 
                0, 1, 0, 
                0, 0, 1
            ]);
            return false;
        }
        
        return true; 
    }

    /**
     * Transforms 2D image coordinate to physical bounds in-place.
     * ZERO ALLOCATION logic.
     * 
     * @param outXY Float64Array[2] - Preallocated Array to write destination [PhysicalX, PhysicalY]
     * @param imageX number - Input X screen pixel
     * @param imageY number - Input Y screen pixel
     */
    public applyTransform(outXY: Float64Array, imageX: number, imageY: number): void {
        this.vec3In[0] = imageX;
        this.vec3In[1] = imageY;
        this.vec3In[2] = 1.0;

        PerspectiveMath.multiplyMat3Vec3(this.vec3Out, this.H, this.vec3In);

        // Normalize by Z (Perspective Division)
        const zOut = this.vec3Out[2];
        
        // Div-by-zero protection for extreme camera angles
        if (Math.abs(zOut) < 1e-8) {
            outXY[0] = 0;
            outXY[1] = 0;
            return;
        }

        outXY[0] = this.vec3Out[0] / zOut;
        outXY[1] = this.vec3Out[1] / zOut;
    }
}
