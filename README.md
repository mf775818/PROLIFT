# ProLift
<img width="1495" height="1107" alt="Gemini_Generated_Image_b224kqb224kqb224(1)" src="https://github.com/user-attachments/assets/4f700d98-6a5e-454c-9bd8-c333ef99a949" />

ProLift is a high-performance, client-side web application designed for professional barbell lift analysis. It leverages modern web technologies to provide accurate biomechanical metrics directly in the browser.

## Core Purpose
The system provides athletes and coaches with precise data on barbell trajectory, velocity, and biomechanical positioning. By processing video data locally, it ensures high privacy and low-latency feedback for technical optimization.

## Technical Architecture
- **High-Performance Computing (HPC):** Dedicated modules for physics simulation (`PhysicsEngineHPC`), rigid body dynamics (`BarbellRigidBodyHPC`), and trajectory optimization using Kalman filters.
- **Offline Video Processing:** Utilizes `OfflineVideoDecoder` and a custom `MP4Demuxer` to handle frame-accurate data without uploading files to a server.
- **Worker-Based Metrics:** Offloads heavy calculations to Web Workers (`metrics.worker.ts`) to maintain a smooth UI performance.
- **Biomechanical Modeling:** Implements projective math and perspective correction to translate 2D video coordinates into meaningful physical measurements.

## Key Features
- **Trajectory Tracking:** Real-time visualization of the bar path.
- **Velocity Metrics:** Calculation of peak and average concentric velocity.
- **Calibration Engine:** Automated depth and perspective calibration for consistent data accuracy.
- **Visual Analytics:** Interactive charts for power output and displacement analysis.

## Tech Stack
- **Frontend:** React, Vite, TypeScript
- **Processing:** WebCodecs API, Web Workers
- **Math & Physics:** Custom HPC libraries for linear algebra and kinematics
"""
