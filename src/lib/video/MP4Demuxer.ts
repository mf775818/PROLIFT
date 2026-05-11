import MP4Box, { MP4ArrayBuffer, MP4File, MP4Info, MP4VideoTrack } from 'mp4box';

/**
 * Industrial-grade MP4 Demuxer with HEVC/H.265 support
 * Handles mobile compatibility issues and provides fallback mechanisms
 */
export class MP4Demuxer {
  private file: MP4File;
  private onConfig: (config: VideoDecoderConfig) => void;
  private onChunk: (chunk: EncodedVideoChunk) => void;
  private setStatus: (status: string) => void;
  private pendingSamples: any[] = [];
  private isExtractionStarted = false;
  
  constructor(file: File | Blob | string, callbacks: {
    onConfig: (config: VideoDecoderConfig) => void;
    onChunk: (chunk: EncodedVideoChunk) => void;
    setStatus: (status: string) => void;
  }) {
    this.onConfig = callbacks.onConfig;
    this.onChunk = callbacks.onChunk;
    this.setStatus = callbacks.setStatus;

    this.file = MP4Box.createFile();
    this.file.onError = (e) => {
      console.error("MP4Box Error", e);
      this.setStatus(`MP4Box Error: ${e}`);
    };
    this.file.onReady = this.onReady.bind(this);
    this.file.onSamples = this.onSamples.bind(this);

    if (typeof file === 'string') {
      this.fetchAndParse(file);
    } else {
      this.readBlob(file);
    }
  }

  private async readBlob(blob: Blob) {
    const buffer = await blob.arrayBuffer();
    (buffer as MP4ArrayBuffer).fileStart = 0;
    this.file.appendBuffer(buffer as MP4ArrayBuffer);
    this.file.flush();
  }

  private async fetchAndParse(uri: string) {
    let response: Response;
    try {
      response = await fetch(uri);
    } catch (e) {
      this.setStatus(`Fetch error: ${e}`);
      return;
    }
    
    const buffer = await response.arrayBuffer();
    (buffer as MP4ArrayBuffer).fileStart = 0;
    this.file.appendBuffer(buffer as MP4ArrayBuffer);
    this.file.flush();
  }

  /**
   * Extracts video track information and handles HEVC codec detection
   */
  private onReady(info: MP4Info) {
    const track = info.videoTracks[0];
    if (!track) {
      this.setStatus("No video track found");
      return;
    }

    const trak = this.file.getTrackById(track.id);
    let description: Uint8Array | undefined;
    let codecString = track.codec || '';
    let isHEVC = false;

    // Extract codec configuration data
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      if (entry.avcC || entry.hvcC || entry.vpcC) {
        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
        if (entry.hvcC) {
          isHEVC = true;
          entry.hvcC.write(stream);
          // Fix: Properly handle HEVC codec string
          if (!codecString || codecString === 'hvc1' || codecString === 'hev1') {
            // Extract profile/level from hvcC if codec string is incomplete
            const profileIdc = entry.hvcC.general_profile_idc;
            const levelIdc = entry.hvcC.general_level_idc;
            
            // Construct proper HEVC codec string
            codecString = `hvc1.${profileIdc.toString(16).padStart(2, '0')}${levelIdc.toString(16).padStart(2, '0')}`;
          }
        } else if (entry.avcC) {
          entry.avcC.write(stream);
        } else if (entry.vpcC) {
          entry.vpcC.write(stream);
        }
        description = new Uint8Array(stream.buffer, 8);
        break;
      }
    }

    // Normalize codec string for WebCodecs API
    const normalizedCodec = this.normalizeCodecString(codecString, isHEVC);
    
    console.log('[MP4Demuxer] Codec detected:', codecString, '->', normalizedCodec, 'HEVC:', isHEVC);

    this.onConfig({
      codec: normalizedCodec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description,
      hardwareAcceleration: isHEVC ? 'prefer-hardware' : 'no-preference'
    });

    this.file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
    this.isExtractionStarted = true;
    this.file.start();
  }

  /**
   * Normalizes codec strings for maximum browser compatibility
   */
  private normalizeCodecString(codec: string, isHEVC: boolean): string {
    if (!codec) return 'avc1.42E01E';
    
    const lowerCodec = codec.toLowerCase();
    
    // Handle HEVC variants
    if (isHEVC || lowerCodec.startsWith('hvc') || lowerCodec.startsWith('hev') || lowerCodec.includes('hevc')) {
      // Try to preserve the original codec string if it looks valid
      if (/^hvc1\.[0-9A-Fa-f]+$/.test(codec) || /^hev1\.[0-9A-Fa-f]+$/.test(codec)) {
        return codec;
      }
      // Fallback to common HEVC profiles
      return 'hvc1.1.6.L120.B0'; // Main Profile, Level 4.0
    }
    
    // Handle AVC/H.264
    if (lowerCodec.startsWith('avc1') || lowerCodec.startsWith('avc3')) {
      return codec;
    }
    
    // Handle VP9
    if (lowerCodec.startsWith('vp09') || lowerCodec.startsWith('vp9')) {
      return codec;
    }
    
    // Handle AV1
    if (lowerCodec.startsWith('av01')) {
      return codec;
    }
    
    // Default fallback
    return 'avc1.42E01E';
  }

  private onSamples(trackId: number, user: any, samples: any[]) {
    if (!this.isExtractionStarted) {
      this.pendingSamples.push(...samples);
      return;
    }

    for (const sample of samples) {
      try {
        this.onChunk(new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: 1e6 * sample.cts / sample.timescale,
          duration: sample.duration ? (1e6 * sample.duration / sample.timescale) : undefined,
          data: sample.data
        }));
      } catch (e) {
        console.warn('[MP4Demuxer] Failed to create chunk:', e);
      }
    }
  }

  /**
   * Flushes pending samples after configuration
   */
  public flushPendingSamples() {
    if (this.isExtractionStarted && this.pendingSamples.length > 0) {
      const samples = [...this.pendingSamples];
      this.pendingSamples = [];
      this.onSamples(0, null, samples);
    }
  }
}
