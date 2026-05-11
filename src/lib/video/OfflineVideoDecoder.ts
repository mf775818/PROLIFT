import { MP4Demuxer } from './MP4Demuxer';

/**
 * Industrial-grade Offline Video Decoder with HEVC/H.265 support
 * Provides robust fallback mechanisms for mobile browsers
 */
export class OfflineVideoDecoder {
  public frames: VideoFrame[] = [];
  public metadata: { width: number; height: number; duration: number } | null = null;
  private decoder: VideoDecoder | null = null;
  private decodeQueue: EncodedVideoChunk[] = [];
  private isConfigured = false;
  private hasFlushed = false;
  
  /**
   * Loads and decodes a video file with comprehensive codec support
   */
  async load(file: File | Blob | string): Promise<void> {
    return new Promise((resolve, reject) => {
      let pendingChunks = 0;
      let decodeError: Error | null = null;
      
      const checkDone = () => {
        if (this.hasFlushed && pendingChunks === 0) {
          if (decodeError) {
            reject(decodeError);
          } else {
            resolve();
          }
        }
      };

      const demuxer = new MP4Demuxer(file, {
        setStatus: (status) => console.log('[OfflineVideoDecoder] Demuxer status:', status),
        
        onConfig: async (config) => {
          console.log('[OfflineVideoDecoder] Received config:', config);
          
          this.metadata = { 
            width: config.codedWidth || 0, 
            height: config.codedHeight || 0, 
            duration: 0 
          };
          
          // Check if the config is supported
          let supportStatus;
          try {
            supportStatus = await VideoDecoder.isConfigSupported(config);
          } catch (e) {
            console.warn('[OfflineVideoDecoder] isConfigSupported failed:', e);
            supportStatus = { supported: false, reason: 'isConfigSupported error' };
          }
          
          console.log('[OfflineVideoDecoder] Config support:', supportStatus);
          
          if (!supportStatus.supported) {
            // Try fallback configurations for HEVC
            if (config.codec.startsWith('hvc') || config.codec.startsWith('hev')) {
              console.log('[OfflineVideoDecoder] Trying HEVC fallback configs...');
              const fallbackConfigs = [
                { ...config, codec: 'hvc1.1.6.L120.B0' },
                { ...config, codec: 'hvc1.1.6.L123.B0' },
                { ...config, codec: 'hvc1.1.6.L150.B0' },
                { ...config, codec: 'hev1.1.6.L120.B0' },
              ];
              
              for (const fallback of fallbackConfigs) {
                try {
                  const fallbackSupport = await VideoDecoder.isConfigSupported(fallback);
                  if (fallbackSupport.supported) {
                    config = fallback;
                    console.log('[OfflineVideoDecoder] Using fallback config:', config.codec);
                    break;
                  }
                } catch (e) {}
              }
            }
            
            // If still not supported, try software decoding
            if (!supportStatus.supported) {
              config = { ...config, hardwareAcceleration: 'prefer-software' };
              try {
                supportStatus = await VideoDecoder.isConfigSupported(config);
                console.log('[OfflineVideoDecoder] Software decoding support:', supportStatus);
              } catch (e) {}
            }
          }
          
          // Create and configure decoder
          this.decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
              this.frames.push(frame);
              pendingChunks--;
              checkDone();
            },
            error: (err) => {
              console.error('[OfflineVideoDecoder] VideoDecoder error:', err);
              decodeError = err instanceof Error ? err : new Error(String(err));
              reject(err);
            }
          });

          try {
            this.decoder.configure(config);
            this.isConfigured = true;
            
            // Process any queued chunks
            this.processDecodeQueue();
          } catch (e) {
            console.error('[OfflineVideoDecoder] Configure failed:', e);
            reject(e);
          }
        },
        
        onChunk: (chunk) => {
          if (this.isConfigured && this.decoder) {
            pendingChunks++;
            try {
              this.decoder.decode(chunk);
            } catch (e) {
              console.warn('[OfflineVideoDecoder] Decode failed:', e);
              pendingChunks--;
            }
          } else {
            // Queue chunk until decoder is configured
            this.decodeQueue.push(chunk);
          }
        }
      });
      
      // Schedule flush after a delay to ensure all chunks are processed
      setTimeout(async () => {
        if (this.decoder && !this.hasFlushed) {
          this.hasFlushed = true;
          try {
            await this.decoder.flush();
          } catch (e) {
            console.warn('[OfflineVideoDecoder] Flush failed:', e);
          }
          checkDone();
        }
      }, 1000);
    });
  }
  
  /**
   * Processes queued chunks after decoder configuration
   */
  private processDecodeQueue() {
    if (!this.decoder || !this.isConfigured) return;
    
    while (this.decodeQueue.length > 0) {
      const chunk = this.decodeQueue.shift();
      if (chunk) {
        try {
          this.decoder.decode(chunk);
        } catch (e) {
          console.warn('[OfflineVideoDecoder] Queued decode failed:', e);
        }
      }
    }
  }

  /**
   * Cleans up resources
   */
  public cleanup(): void {
    this.frames.forEach(f => {
      try { f.close(); } catch(e) {}
    });
    this.frames = [];
    
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch(e) {}
      this.decoder = null;
    }
    
    this.decodeQueue = [];
    this.isConfigured = false;
    this.hasFlushed = false;
  }
}
