import { MP4Demuxer } from './MP4Demuxer';

export class OfflineVideoDecoder {
  public frames: VideoFrame[] = [];
  public metadata: { width: number; height: number; duration: number } | null = null;
  private decoder: VideoDecoder | null = null;
  
  async load(file: File | Blob | string): Promise<void> {
    return new Promise((resolve, reject) => {
      let isConfigured = false;
      let pendingChunks = 0;
      let flushed = false;
      
      const checkDone = () => {
        if (flushed && pendingChunks === 0) {
          resolve();
        }
      };

      const demuxer = new MP4Demuxer(file, {
        setStatus: (status) => console.log('Demuxer status:', status),
        onConfig: (config) => {
          this.metadata = { width: config.codedWidth || 0, height: config.codedHeight || 0, duration: 0 };
          
          this.decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
              this.frames.push(frame); // We store original frames directly instead of cloning if we manage lifecycle carefully
              pendingChunks--;
              checkDone();
            },
            error: (err) => {
              console.error('VideoDecoder error', err);
              reject(err);
            }
          });

          // Check if HEVC or config is supported
          VideoDecoder.isConfigSupported(config).then(support => {
            if (support.supported) {
              try {
                this.decoder!.configure(config);
                isConfigured = true;
              } catch(e) {
                 reject(e);
              }
            } else {
              reject(new Error('Video codec config not supported by this browser.'));
            }
          });
        },
        onChunk: (chunk) => {
          if (isConfigured && this.decoder) {
            pendingChunks++;
            this.decoder.decode(chunk);
          }
        }
      });
      
      // Hook into flush mechanism (simplified)
      // mp4box.js parses everything synchronously at flush
      setTimeout(async () => {
         if (this.decoder) {
             flushed = true;
             await this.decoder.flush();
             checkDone();
         }
      }, 500); // Hacky delay to ensure all chunks are passed
    });
  }

  public cleanup(): void {
    this.frames.forEach(f => {
       try { f.close(); } catch(e){}
    });
    this.frames = [];
    if (this.decoder) {
       this.decoder.close();
    }
  }
}
