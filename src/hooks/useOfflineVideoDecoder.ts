import { useRef, useEffect, useState, useCallback } from 'react';

interface DecoderState {
  status: string;
  progress: number;
  isDecoding: boolean;
  error: string | null;
}

export function useOfflineVideoDecoder(
  onFrameBatch: (frames: VideoFrame[], metadata: { width: number; height: number }) => void
) {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<DecoderState>({
    status: 'idle', progress: 0, isDecoding: false, error: null
  });

  useEffect(() => {
    // 動態建立 Worker
    workerRef.current = new Worker(new URL('../lib/video/VideoDecodeWorker.ts', import.meta.url), { type: 'module' });
    
    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      switch (type) {
        case 'STATUS': 
          setState(s => ({ ...s, status: payload })); 
          break;
        case 'CONFIGURED':
          setState(s => ({ ...s, isDecoding: true, status: 'Decoding...' }));
          break;
        case 'FRAMES':
          // 直接轉發給管線
          onFrameBatch(payload as VideoFrame[], { width: 1920, height: 1080 });
          break;
        case 'COMPLETE':
          setState(s => ({ ...s, isDecoding: false, status: 'Done', progress: 100 }));
          break;
        case 'ERROR':
          setState(s => ({ ...s, error: payload, isDecoding: false }));
          break;
      }
    };

    return () => workerRef.current?.terminate();
  }, [onFrameBatch]);

  const decodeFile = useCallback((file: File) => {
    if (!workerRef.current) return;
    setState({ status: 'Parsing...', progress: 0, isDecoding: false, error: null });
    workerRef.current.postMessage({ type: 'DECODE_START', payload: { file } });
  }, []);

  return { ...state, decodeFile };
}
