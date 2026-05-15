export class RobustKalmanFilter {
    private posX: number = 0;
    private velX: number = 0;
    private errorCovariancePos: number = 1.0;
    
    private processNoise: number;
    private measureNoise: number;
    private initialized: boolean = false;

    /**
     * @param processNoise System model uncertainty (e.g., max acceleration allowed)
     * @param measureNoise Sensor basic noise level
     */
    constructor(processNoise: number = 0.001, measureNoise: number = 0.01) {
        this.processNoise = processNoise;
        this.measureNoise = measureNoise;
    }

    public filter(measuredPos: number, deltaTime: number): number {
        if (!this.initialized) {
            this.posX = measuredPos;
            this.velX = 0;
            this.initialized = true;
            return this.posX;
        }

        // 1. Prediction Phase
        const predictedPos = this.posX + this.velX * deltaTime;
        const predictedVel = this.velX;
        
        // Error covariance prediction (simplified version)
        const predictedErrCovPos = this.errorCovariancePos + this.processNoise * deltaTime;

        // 2. Gating / Outlier Rejection
        const residual = measuredPos - predictedPos;
        const innovationVariance = predictedErrCovPos + this.measureNoise;
        
        // Set 3 standard deviations as threshold for outlier rejection (cam "jumping")
        const threshold = 3.0 * Math.sqrt(innovationVariance);

        if (Math.abs(residual) > threshold) {
            // Outlier jump: Do not trust measurement, rely on prediction
            this.posX = predictedPos;
            this.velX = predictedVel;
            this.errorCovariancePos = predictedErrCovPos; 
            return this.posX;
        }

        // 3. Update Phase - Calculate Kalman Gain
        const kalmanGainPos = predictedErrCovPos / innovationVariance;
        
        this.posX = predictedPos + kalmanGainPos * residual;
        // Correct velocity based on position residual (continuous estimation)
        // Multiplying by 0.1 as a dampening factor to smooth velocity transitions
        this.velX = predictedVel + (kalmanGainPos / Math.max(deltaTime, 0.001)) * residual * 0.1; 

        // Update error covariance
        this.errorCovariancePos = (1.0 - kalmanGainPos) * predictedErrCovPos;

        return this.posX;
    }

    public getPosition(): number {
        return this.posX;
    }

    public getVelocity(): number {
        return this.velX;
    }
    
    public reset(): void {
        this.initialized = false;
        this.errorCovariancePos = 1.0;
    }
}
