import { MP4Demuxer } from './MP4Demuxer';

// 控制解碼佇列深度，避免 VideoDecoder 內部記憶體暴增
const MAX_PENDING_CHUNKS = 16;
const FRAME_TRANSFER_BATCH = 8;

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type !== 'DECODE_START' || !payload.file) return;

  const file: File | Blob = payload.file;
  let pendingChunks = 0;
  let decodedCount = 0;
  let frameBatch: VideoFrame[] = [];
  let isFinished = false;
  let decoder: VideoDecoder | null = null;

  const transferBatch = () => {
    if (frameBatch.length === 0) return;
    
    const _self = self as unknown as Worker;
    _self.postMessage(
      { type: 'FRAMES', payload: frameBatch, count: decodedCount },
      { transfer: frameBatch.filter(f => f) as unknown as Transferable[] }
    );
    frameBatch = [];
  };

  const demuxer = new MP4Demuxer(file, {
    setStatus: (status) => self.postMessage({ type: 'STATUS', payload: status }),
    onConfig: async (config) => {
      try {
        const { supported } = await VideoDecoder.isConfigSupported(config);
        if (!supported) {
          throw new Error(`Codec ${config.codec} not supported in this browser.`);
        }

        decoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            pendingChunks--;
            decodedCount++;
            frameBatch.push(frame);

            // 達到批次大小或解碼完成時轉移
            if (frameBatch.length >= FRAME_TRANSFER_BATCH || isFinished) {
              transferBatch();
            }

            // 通知 Demuxer 可繼續推 Chunk (反壓控制)
            if (pendingChunks < MAX_PENDING_CHUNKS) {
              self.postMessage({ type: 'READY_FOR_CHUNKS' });
            }
          },
          error: (err) => {
            self.postMessage({ type: 'ERROR', payload: err.message });
            decoder?.close();
          }
        });

        decoder.configure(config);
        self.postMessage({ type: 'CONFIGURED', payload: config });
      } catch (err: any) {
        self.postMessage({ type: 'ERROR', payload: err.message });
      }
    },
    onChunk: (chunk: EncodedVideoChunk) => {
      if (decoder && decoder.state === 'configured') {
        pendingChunks++;
        decoder.decode(chunk);
      }
    }
  });

  // 等待 mp4box 解析完成 + VideoDecoder flush
  await new Promise<void>((resolve) => {
    const checkDone = () => {
      if (isFinished && pendingChunks === 0) {
        resolve();
      }
    };

    // 攔截 flush 完成訊號
    const originalFlush = decoder?.flush.bind(decoder);
    if (decoder && originalFlush) {
      isFinished = true;
      originalFlush().then(() => {
        transferBatch(); // 確保最後一幀被送出
        checkDone();
      }).catch(() => checkDone());
    } else {
      isFinished = true;
      checkDone();
    }
  });

  decoder?.close();
  self.postMessage({ type: 'COMPLETE', payload: { totalFrames: decodedCount } });
};
