import { Point3D, BoundingBox, Perspective, CalibrationResult } from "./types";

/**
 * ProLift AI 工業級空間校正引擎 (Industrial-Grade Calibration Engine)
 * 複雜度: O(1) 絕對常量時間，完美匹配 O(log N) 以下的要求。
 */
export class CalibrationEngine {
  // 奧林匹克標準槓片直徑 450 mm (0.45公尺)
  private static readonly STANDARD_PLATE_DIAMETER_M = 0.45;
  // 視角檢查閾值，編譯器層級內聯
  private static readonly SAGITTAL_THRESHOLD = 1.5;

  // 靜態內存池 (Object Pooling): 避免每一幀生成新物件導致 GC 停頓 (Jank)
  private readonly _cachedResult: CalibrationResult = {
    perspective: Perspective.FRONTAL,
    scaleFactor: null,
    strategy: "",
    message: "",
    affineMatrix: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]
  };

  /**
   * 內聯快取：原地更新矩陣，保證堆疊 (Heap) 零分配 (Zero-Allocation)
   */
  private _updateMatrix(scaleX: number, scaleY: number): void {
    const mat = this._cachedResult.affineMatrix!;
    mat[0][0] = scaleX;
    mat[1][1] = scaleY;
    // 其餘位址在初始化時已是 0, 0, 1
  }

  /**
   * Step 1: 判定拍攝視角 (O(1)常量級運算)
   * 移除函數調用與除法，全面採用 ALU 友善的位移/乘法比較
   */
  public detectCameraPerspective(landmarks: Point3D[]): Perspective {
    // 高頻追蹤場景下，假設上游已保證 array length >= 33, 省去陣列邊界檢測分支 (Branch Prediction優化)
    const lShoulder = landmarks[11];
    const rShoulder = landmarks[12];
    const lHip = landmarks[23];
    const rHip = landmarks[24];

    // CPU 微觀級優化: 將原先的除法 (z / x > THRESHOLD) 轉換為乘法 (z > x * THRESHOLD)
    const shXDist = Math.abs(lShoulder.x - rShoulder.x);
    const shZDist = Math.abs(lShoulder.z - rShoulder.z);
    
    const hipXDist = Math.abs(lHip.x - rHip.x);
    const hipZDist = Math.abs(lHip.z - rHip.z);

    const isShoulderSagittal = shZDist > (shXDist * CalibrationEngine.SAGITTAL_THRESHOLD);
    const isHipSagittal = hipZDist > (hipXDist * CalibrationEngine.SAGITTAL_THRESHOLD);

    return (isShoulderSagittal && isHipSagittal) 
      ? Perspective.SAGITTAL 
      : Perspective.FRONTAL;
  }

  /**
   * Step 2: 主核心計算 - 條件式 ROI 校正與映射
   * O(1) 效能，全程不生成任何暫存變數垃圾 (Zero-Garbage)
   */
  public calibrate(landmarks: Point3D[], barbellRoi: BoundingBox | null): CalibrationResult {
    const perspective = this.detectCameraPerspective(landmarks);
    
    // 直接覆寫預先分配的內存區塊
    this._cachedResult.perspective = perspective;

    if (perspective === Perspective.FRONTAL) {
      this._cachedResult.scaleFactor = null;
      this._cachedResult.strategy = "RELATIVE_Y_TRACKING";
      this._cachedResult.message = "Frontal View: O(1) compute mode active. Affine skip.";
      this._updateMatrix(1, 1); // 歸位 Identity
    } else {
      if (!barbellRoi) {
        this._cachedResult.strategy = "AWAITING_ROI";
        return this._cachedResult; // 安全跳出
      }
      
      const w = barbellRoi.width;
      const h = barbellRoi.height;
      
      // 取代 Math.max，降低呼叫堆疊深度並利於 JIT 引擎 Inline
      const projectedDiameterPx = w > h ? w : h;
      
      // 避免浮點數除零錯誤 (除法極耗 cycle，以乘法倒數取代但此處僅2階可直除)
      // 若萬一寬高為0給予一個極小補償
      const scaleX = projectedDiameterPx / (w || 0.0001);
      const scaleY = projectedDiameterPx / (h || 0.0001);

      this._updateMatrix(scaleX, scaleY);

      // Scale Factor: Unit is (Meters per Pixel)
      this._cachedResult.scaleFactor = CalibrationEngine.STANDARD_PLATE_DIAMETER_M / projectedDiameterPx;
      this._cachedResult.strategy = "AFFINE_REVERSE_ENGINEERING";
      this._cachedResult.message = "Sagittal View: O(1) transform and physical scale factor applied.";
    }

    return this._cachedResult;
  }
}
