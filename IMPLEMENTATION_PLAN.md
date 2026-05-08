# Implementation Plan: ProLift AI - 3D Perspective & HPC Architecture

## Architectural Overview
To achieve extreme performance (60fps+ without Main Thread blocking or Garbage Collection pausing), we are migrating from standard 2D scaling object-arrays to a highly optimized, flat-memory structure using `SharedArrayBuffer` and `Float64Array`. The mathematical model is also upgrading from simple scaling to 3D perspective mapping (Homography) to correct camera lens distortion and viewing angles.

## Phase 1: HPC Memory & 3D Matrix Structure
1. **`LiftMetricsBuffer.ts`**: Ring Buffer implementation on top of `Float64Array/SharedArrayBuffer`. Uses a fixed stride (e.g., 8 floats per metric) to guarantee O(1) access. Eliminates all object allocation, preventing GC pauses during high-frequency telemetry updates.
2. **`PerspectiveMath.ts`**: A 3x3 matrix math library optimized for zero allocation. Operations modify buffers in-place instead of returning new arrays. Adds singular-matrix protection for inversion.

## Phase 2: 3D Vision Calibration Engine
1. **`CalibrationEngine.ts`**: Implements the Direct Linear Transform (DLT) to calculate the homography matrix ($H$) given 4 standard reference points in the 2D image and their corresponding physical physical coordinates. 
2. Features an `applyTransform` method mapped directly against a pre-allocated Float64Array to satisfy the Zero-Allocation constraint. Points transform from screen coordinates `(x, y)` to physical coordinates `(X, Y, Z)` at `O(1)` cost without spawning temporary `{x, y}` objects.

## Phase 3: Web Worker & Zero-Copy Transfer
1. **`metrics.worker.ts`**: A dedicated Web Worker that calculates physics derivatives (velocity, acceleration, angles) and updates the `SharedArrayBuffer`.
2. **Transfer Strategy**: Employs zero-copy IPC via `SharedArrayBuffer`. The main thread reads directly from the memory written by the worker without passing messages for every frame, achieving near-zero latency.

---
**Constraint Checklist:**
- [x] Strict Mode TypeScript, no `any`.
- [x] Zero-Allocation within hot loops (no `new` or literal object returns).
- [x] Div-By-Zero and Singular Matrix guards implemented natively.
- [x] `SharedArrayBuffer` IPC.
