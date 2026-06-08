interface ExtendedWindow extends Window {
  cv?: any;
}

class OpenCVLoader {
  private static instance: OpenCVLoader;
  private loadPromise: Promise<any> | null = null;
  private readonly timeoutMs = 15000;

  private constructor() {}

  public static getInstance(): OpenCVLoader {
    if (!OpenCVLoader.instance) {
      OpenCVLoader.instance = new OpenCVLoader();
    }
    return OpenCVLoader.instance;
  }

  public loadEngine(): Promise<any> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise((resolve, reject) => {
      const W = window as ExtendedWindow;

      if (W.cv && W.cv.Mat) {
        resolve(W.cv);
        return;
      }

      const timeoutTimer = setTimeout(() => {
        reject(
          new Error(
            "CV_INIT_TIMEOUT: WebAssembly module compilation timed out.",
          ),
        );
      }, this.timeoutMs);

      const script = document.createElement("script");
      script.id = "opencv-js-engine";
      // Load from local static assets for high stability.
      script.src = "/js/opencv.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.type = "text/javascript";

      W.cv = W.cv || {};
      const existingCallback = W.cv.onRuntimeInitialized;
      W.cv.onRuntimeInitialized = () => {
        clearTimeout(timeoutTimer);
        if (existingCallback) existingCallback();
        resolve(W.cv);
      };

      script.onload = () => {
        if (W.cv && W.cv.Mat) {
          clearTimeout(timeoutTimer);
          resolve(W.cv);
        }
      };

      script.onerror = (err) => {
        clearTimeout(timeoutTimer);
        this.loadPromise = null;
        reject(
          new Error(
            `CV_NETWORK_ERROR: Failed to download the computer vision library. Context: ${err}`,
          ),
        );
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
  }
}

export const cvEngineLoader = OpenCVLoader.getInstance();
