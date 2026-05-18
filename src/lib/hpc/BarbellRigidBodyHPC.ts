/**
 * 工業級剛體約束引擎 (Rigid-Body Constraint HPC)
 * 利用標準槓鈴的絕對物理尺寸，反向約束與校正生物力學場。
 */
export class BarbellRigidBodyHPC {
    // 國際標準槓鈴物理常數 (單位: mm)
    public readonly BAR_TOTAL_LENGTH = 2200.0;
    public readonly INNER_SLEEVE_DIST = 1310.0;
    public readonly PLATE_DIAMETER = 450.0;
    
    // (2200 - 1310) / 2 = 445mm (單側袖套+擋片的物理長度)
    public readonly SLEEVE_LENGTH = 445.0; 

    // 預分配記憶體：避免 GC 停頓
    private barbellCenter3D = new Float64Array(3);
    private cameraPerspectiveMatrix = new Float64Array(9);

    public enforceCenterSymmetry(
        outCorrectedCenter: Float64Array,
        leftPlateCenter: Float64Array,
        rightPlateCenter: Float64Array,
        rawBodyCenter: Float64Array,
        isSetupPhase: boolean
    ): void {
        this.barbellCenter3D[0] = (leftPlateCenter[0] + rightPlateCenter[0]) * 0.5;
        this.barbellCenter3D[1] = (leftPlateCenter[1] + rightPlateCenter[1]) * 0.5;
        this.barbellCenter3D[2] = (leftPlateCenter[2] + rightPlateCenter[2]) * 0.5;

        const driftX = rawBodyCenter[0] - this.barbellCenter3D[0];
        
        if (isSetupPhase) {
            outCorrectedCenter[0] = this.barbellCenter3D[0];
            outCorrectedCenter[1] = rawBodyCenter[1];
            outCorrectedCenter[2] = this.barbellCenter3D[2];
        } else {
            const MAX_ALLOWED_DRIFT_MM = 50.0;
            const currentDrift = Math.abs(driftX);

            if (currentDrift > MAX_ALLOWED_DRIFT_MM) {
                const pullFactor = MAX_ALLOWED_DRIFT_MM / currentDrift;
                outCorrectedCenter[0] = this.barbellCenter3D[0] + driftX * pullFactor;
                outCorrectedCenter[1] = rawBodyCenter[1];
                outCorrectedCenter[2] = this.barbellCenter3D[2]; 
            } else {
                outCorrectedCenter[0] = rawBodyCenter[0];
                outCorrectedCenter[1] = rawBodyCenter[1];
                outCorrectedCenter[2] = rawBodyCenter[2];
            }
        }
    }

    public validateGripWidth(leftHand: Float64Array, rightHand: Float64Array, scaleMmPerPx: number): boolean {
        const dx = (leftHand[0] - rightHand[0]) * scaleMmPerPx;
        const dy = (leftHand[1] - rightHand[1]) * scaleMmPerPx;
        const gripWidthMm = Math.sqrt(dx * dx + dy * dy);

        return (gripWidthMm <= this.INNER_SLEEVE_DIST + 10.0) && (gripWidthMm >= 100.0);
    }
}
