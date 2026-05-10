// src/lib/hpc/MetricTensorHPC.ts

export class MetricTensorHPC {
    // 3x3 對稱矩陣，只需儲存 6 個獨立元素
    // [ g11, g12, g13 ]
    // [ g12, g22, g23 ]
    // [ g13, g23, g33 ]
    private G: Float64Array = new Float64Array(6);
    private isInitialized: boolean = false;

    /**
     * 根據逆單應性矩陣 H_inv 計算度規張量 G = H_inv^T * H_inv
     * 這是 O(1) 的預計算，不影響即時分析效能
     */
    public calibrateFromInverseHomography(H_inv: Float64Array) {
        // H_inv 是一個 9 元素的 Float64Array
        const h00 = H_inv[0], h01 = H_inv[1], h02 = H_inv[2];
        const h10 = H_inv[3], h11 = H_inv[4], h12 = H_inv[5];
        const h20 = H_inv[6], h21 = H_inv[7], h22 = H_inv[8];

        // 計算 G = H_inv^T * H_inv
        this.G[0] = h00*h00 + h10*h10 + h20*h20; // g11
        this.G[1] = h00*h01 + h10*h11 + h20*h21; // g12
        this.G[2] = h00*h02 + h10*h12 + h20*h22; // g13
        this.G[3] = h01*h01 + h11*h11 + h21*h21; // g22
        this.G[4] = h01*h02 + h11*h12 + h21*h22; // g23
        this.G[5] = h02*h02 + h12*h12 + h22*h22; // g33

        this.isInitialized = true;
    }

    /**
     * 計算影像平面上兩點之間的真實物理距離的平方 (ds^2)
     * 利用黎曼度量：ds^2 = dx^T * G * dx
     * @param x1 點1影像X座標
     * @param y1 點1影像Y座標
     * @param x2 點2影像X座標
     * @param y2 點2影像Y座標
     * @returns 真實空間的距離 (Meters)
     */
    public computePhysicalDistance(x1: number, y1: number, x2: number, y2: number): number {
        if (!this.isInitialized) return Math.sqrt((x2-x1)**2 + (y2-y1)**2);

        // 微小偏移向量 dx, dy
        const dx = x2 - x1;
        const dy = y2 - y1;

        // 因為我們是其次座標 (Homogeneous coordinates) dx = [dx, dy, 0]^T (假設在同一個平面流形上)
        // ds^2 = g11*dx^2 + 2*g12*dx*dy + g22*dy^2
        const ds_squared = 
            this.G[0] * (dx * dx) + 
            2 * this.G[1] * (dx * dy) + 
            this.G[3] * (dy * dy);

        // 防止極端透視導致的負值（數學上的防禦性編程）
        return Math.sqrt(Math.max(0, ds_squared));
    }
}
