
export interface LiftMetrics {
  time: string;
  velocity: number;
  height: number;
  power: number;
  x: number; // Normalized X (0-1)
  y: number; // Normalized Y (0-1)
  kneeAngle: number;
  hipAngle: number;
  ankleAngle: number;
  backAngle: number;
}

export interface Keypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseResult {
  poseLandmarks: Keypoint[];
}

export enum AnalysisState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  COMPLETE = 'COMPLETE',
}

// Declare global MediaPipe types since we are loading via script tag
declare global {
  interface Window {
    Pose: any;
    drawConnectors: any;
    drawLandmarks: any;
    POSE_CONNECTIONS: any;
  }
}
