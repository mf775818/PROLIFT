export interface LiftMetrics {
  time: string;
  velocity: number;
  height: number;
  power: number;
  x: number;
  y: number;
  kneeAngle: number;
  hipAngle: number;
  ankleAngle?: number;
  backAngle?: number;
  lKneeAngle?: number;
  rKneeAngle?: number;
  lAnkleAngle?: number;
  rAnkleAngle?: number;
  lHipAngle?: number;
  rHipAngle?: number;
  lKneeX?: number;
  lKneeY?: number;
  rKneeX?: number;
  rKneeY?: number;
  lHipX?: number;
  lHipY?: number;
  rHipX?: number;
  rHipY?: number;
  lAnkleX?: number;
  lAnkleY?: number;
  rAnkleX?: number;
  rAnkleY?: number;
}

export interface Keypoint {
  x: number;
  y: number;
  z?: number;
  visibility: number;
}

export interface PoseResult {
  poseLandmarks: Keypoint[];
}

export enum AnalysisState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  COMPLETE = 'COMPLETE'
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum Perspective {
  FRONTAL = "FRONTAL",
  SAGITTAL = "SAGITTAL",
}

export interface CalibrationResult {
  perspective: Perspective;
  scaleFactor: number | null; // meters per pixel
  strategy: string;
  message: string;
  affineMatrix?: number[][];
}
