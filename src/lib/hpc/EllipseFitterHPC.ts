import { PerspectiveMath } from './PerspectiveMath';

export interface Point2D {
    x: number;
    y: number;
}

export class EllipseFitterHPC {
    private perspectiveMath = new PerspectiveMath();

    /**
     * 1. 亞像素邊緣提取 (Subpixel Edge Extraction)
     * 沿著梯度方向取得亞像素精度的邊緣點
     */
    public extractSubpixelEdges(cv: any, srcGray: any, roiRect: any): Point2D[] {
        const edges = new cv.Mat();
        const gradX = new cv.Mat();
        const gradY = new cv.Mat();
        
        // Canny 邊緣檢測
        cv.Canny(srcGray, edges, 50, 150, 3, false);
        
        // 計算 X y 梯度用於亞像素插值
        cv.Sobel(srcGray, gradX, cv.CV_32F, 1, 0, 3);
        cv.Sobel(srcGray, gradY, cv.CV_32F, 0, 1, 3);

        const subpixelPoints: Point2D[] = [];
        const width = srcGray.cols;
        const height = srcGray.rows;
        
        // 取得邊緣像素並進行高斯/拋物線插值
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (edges.ucharPtr(y, x)[0] > 0) {
                    const gx = gradX.floatPtr(y, x)[0];
                    const gy = gradY.floatPtr(y, x)[0];
                    
                    const mag = Math.sqrt(gx * gx + gy * gy);
                    if (mag < 1e-3) {
                        subpixelPoints.push({ x: x + roiRect.x, y: y + roiRect.y });
                        continue;
                    }
                    
                    const nx = gx / mag;
                    const ny = gy / mag;
                    
                    // 簡單的亞像素近似: 在法線方向上取周圍 3 個點的亮度進行二次擬合
                    // (為保持高效能，這裡做 1D 拋物線擬合的簡化版本)
                    // p0 = center, p_minus = center - n, p_plus = center + n
                    // 根據 Taylor 展開式，極值偏移 delta = (p_minus - p_plus) / (2 * (p_minus - 2*p0 + p_plus))
                    
                    const dx = Math.round(nx);
                    const dy = Math.round(ny);
                    
                    if (dx === 0 && dy === 0) {
                        subpixelPoints.push({ x: x + roiRect.x, y: y + roiRect.y });
                        continue;
                    }

                    const px_m = x - dx; const py_m = y - dy;
                    const px_p = x + dx; const py_p = y + dy;

                    if (px_m >= 0 && px_m < width && py_m >= 0 && py_m < height &&
                        px_p >= 0 && px_p < width && py_p >= 0 && py_p < height) {
                        
                        const val_m = srcGray.ucharPtr(py_m, px_m)[0];
                        const val_0 = srcGray.ucharPtr(y, x)[0];
                        const val_p = srcGray.ucharPtr(py_p, px_p)[0];

                        const denom = 2.0 * (val_m - 2.0 * val_0 + val_p);
                        let offset = 0;
                        if (Math.abs(denom) > 1e-5) {
                            offset = (val_m - val_p) / denom;
                            // Clamp offset to [-0.5, 0.5]
                            offset = Math.max(-0.5, Math.min(0.5, offset));
                        }

                        subpixelPoints.push({
                            x: x + nx * offset + roiRect.x,
                            y: y + ny * offset + roiRect.y
                        });
                    } else {
                        subpixelPoints.push({ x: x + roiRect.x, y: y + roiRect.y });
                    }
                }
            }
        }
        
        edges.delete(); gradX.delete(); gradY.delete();
        return subpixelPoints;
    }

    /**
     * 2. 橢圓代數距離擬合 (Direct Least Squares equivalent)
     * 利用 OpenCV fitEllipse，然後轉成 3x3 矩陣 Q
     */
    public fitEllipseConicMatrix(cv: any, points: Point2D[]): { qMatrix: Float64Array, ellipseProps: { cx: number, cy: number, a: number, b: number, angleRad: number } } | null {
        if (points.length < 5) return null;

        const cvPts = new cv.Mat(points.length, 1, cv.CV_32FC2);
        for (let i = 0; i < points.length; i++) {
            cvPts.data32F[i * 2] = points[i].x;
            cvPts.data32F[i * 2 + 1] = points[i].y;
        }

        let rotatedRect;
        try {
            // OpenCV 內建支援 fitEllipse (基於 Fitzgibbon DLS 的改良版)
            rotatedRect = cv.fitEllipse(cvPts);
        } catch (e) {
            cvPts.delete();
            return null;
        }
        cvPts.delete();

        // 建立二次曲線矩陣 Q
        // (x^2 / a^2) + (y^2 / b^2) = 1
        const a = rotatedRect.size.width / 2.0;
        const b = rotatedRect.size.height / 2.0;
        if (a < 1e-3 || b < 1e-3) return null;

        const cx = rotatedRect.center.x;
        const cy = rotatedRect.center.y;
        // OpenCV 角度為 degree, 且方向需要注意
        const angleRad = (rotatedRect.angle * Math.PI) / 180.0;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        // 變換矩陣的逆矩陣 (Inverse Transform): R * T
        // 將世界座標轉換到橢圓標準座標系
        const Q_local = new Float64Array([
            1.0 / (a * a), 0, 0,
            0, 1.0 / (b * b), 0,
            0, 0, -1.0
        ]);

        const M_inv = new Float64Array([
            cosA, sinA, -cx * cosA - cy * sinA,
            -sinA, cosA, cx * sinA - cy * cosA,
            0, 0, 1
        ]);

        const M_inv_T = new Float64Array([
            M_inv[0], M_inv[3], M_inv[6],
            M_inv[1], M_inv[4], M_inv[7],
            M_inv[2], M_inv[5], M_inv[8]
        ]);

        const temp = new Float64Array(9);
        const Q = new Float64Array(9);

        // Q = M_inv^T * Q_local * M_inv
        this.perspectiveMath.multiplyMat3Mat3(temp, Q_local, M_inv);
        this.perspectiveMath.multiplyMat3Mat3(Q, M_inv_T, temp);

        // 將矩陣正規化
        const norm = Math.abs(Q[8]);
        if (norm > 1e-10) {
            for (let i = 0; i < 9; i++) Q[i] /= norm;
        }

        return {
            qMatrix: Q,
            ellipseProps: { cx, cy, a, b, angleRad }
        };
    }

    /**
     * 3. 交比（Cross-Ratio）三維重構
     * 利用左右槓鈴中心以及已知長度推導Z軸深度。
     * (這個可以在主相機邏輯中被整合，此為純代數版本)
     */
    public calculateDepthFromCrossRatio(
        leftCenter: Float64Array, 
        rightCenter: Float64Array, 
        vanishingPoint: Float64Array, 
        knownPhysicalLengthMs: number
    ): number {
        // v = vanishingPoint
        // px1 = leftCenter
        // px2 = rightCenter
        
        // 此處需要一個絕對基準點，通常使用已知場地寬度。
        // 若只有槓鈴桿投影，我們只能求得相對深度比例。我們可以使用焦距推導真實深度。
        // 這邊提供基底架構：
        const dx = rightCenter[0] - leftCenter[0];
        const dy = rightCenter[1] - leftCenter[1];
        const pixelLength = Math.sqrt(dx * dx + dy * dy);
        
        // 由於交比需要四個共線的點，通常是: 兩個物件點，一個無窮遠點(vanishing point)，一個投影機光心。
        // 簡易版距離比例： Z = (focal_length * physical_length) / pixel_length
        // 為了與 HPC 工程整合，先回傳相對於像數量的近似係數，再由相機矩陣處理絕對深度。
        return knownPhysicalLengthMs / (pixelLength + 1e-5);
    }
}
