/**
 * One-Euro Filter (1€ Filter)
 * Designed by Casiez, Roussel, and Vogel (2012)
 * Optimized for human motion analysis: Low jitter at low speeds, low latency at high speeds.
 */
export class OneEuroFilter {
    private prevX: number | null = null;
    private prevDX: number = 0;
    private minCutoff: number;
    private beta: number;
    private dCutoff: number;

    /**
     * @param minCutoff The minimum frequency cutoff (Hz). Lower = less jitter at rest. (Default: 1.0)
     * @param beta The speed-based sensitivity coefficient. Higher = less latency at speed. (Default: 0.007)
     * @param dCutoff Cutoff frequency for the derivative filter. (Default: 1.0)
     */
    constructor(minCutoff: number = 1.0, beta: number = 0.007, dCutoff: number = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
    }

    public filter(rawValue: number, deltaTime: number): number {
        if (this.prevX === null) {
            this.prevX = rawValue;
            this.prevDX = 0;
            return rawValue;
        }

        if (deltaTime <= 0) return this.prevX;

        // 1. Calculate and filter the derivative (speed)
        const dValue = (rawValue - this.prevX) / deltaTime;
        const dAlpha = this.calculateAlpha(deltaTime, this.dCutoff);
        const filteredDX = dAlpha * dValue + (1 - dAlpha) * this.prevDX;

        // 2. Adaptive cutoff frequency based on speed
        const cutoff = this.minCutoff + this.beta * Math.abs(filteredDX);
        const alpha = this.calculateAlpha(deltaTime, cutoff);

        // 3. Filter the actual value
        const filteredX = alpha * rawValue + (1 - alpha) * this.prevX;

        this.prevX = filteredX;
        this.prevDX = filteredDX;

        return filteredX;
    }

    private calculateAlpha(dt: number, cutoff: number): number {
        const tau = 1.0 / (2.0 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / dt);
    }

    public reset(): void {
        this.prevX = null;
        this.prevDX = 0;
    }
}
