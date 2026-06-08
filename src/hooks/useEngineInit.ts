import { useState, useEffect } from "react";
import { TIME_CONSTANTS } from "../constants";
import { cvEngineLoader } from "../lib/OpenCVLoader";

export type InitStatus = "loading" | "ready" | "error";

export interface InitLogItem {
  name: string;
  status: InitStatus;
}

export const useEngineInit = () => {
  const [initLog, setInitLog] = useState<InitLogItem[]>([
    { name: "Core Analysis Engine", status: "loading" },
    { name: "Environment Calibration Engine", status: "loading" },
    { name: "Motion Tracking System", status: "loading" },
  ]);
  const [isInitComplete, setIsInitComplete] = useState(false);
  const [initFailed, setInitFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let checkCount = 0;
    let cvReady = false;
    let poseReady = false;

    cvEngineLoader
      .loadEngine()
      .then(() => {
        if (isMounted) cvReady = true;
      })
      .catch((err) => {
        console.error("OpenCV initialization failed:", err);
        if (isMounted) {
          setInitFailed(true);
          setInitLog((prev) =>
            prev.map((log) =>
              log.name.includes("Calibration") || log.name.includes("Tracking")
                ? { ...log, status: "error" }
                : log,
            ),
          );
        }
      });

    const initInterval = setInterval(() => {
      if (!isMounted) return;
      checkCount++;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      poseReady = !!(window as any).Pose;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!cvReady && (window as any).cv && (window as any).cv.Mat) {
        cvReady = true; // Fallback check in case the loader resolves without updating local let cvReady early enough
      }

      setInitLog([
        {
          name: "Core Analysis Engine",
          status: poseReady
            ? "ready"
            : checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS
              ? "error"
              : "loading",
        },
        {
          name: "Environment Calibration Engine",
          status: cvReady
            ? "ready"
            : checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS
              ? "error"
              : "loading",
        },
        {
          name: "Motion Tracking System",
          status: cvReady
            ? "ready"
            : checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS
              ? "error"
              : "loading",
        },
      ]);

      if (poseReady && cvReady) {
        clearInterval(initInterval);
        setTimeout(() => {
          if (isMounted) setIsInitComplete(true);
        }, 800);
      } else if (checkCount >= TIME_CONSTANTS.INIT_MAX_CHECKS) {
        clearInterval(initInterval);
        setInitFailed(true);
      }
    }, TIME_CONSTANTS.INIT_CHECK_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(initInterval);
    };
  }, []);

  return {
    initLog,
    isInitComplete,
    initFailed,
  };
};
