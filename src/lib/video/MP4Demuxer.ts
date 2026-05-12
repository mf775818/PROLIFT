import MP4Box, { MP4ArrayBuffer, MP4File, MP4Info, MP4VideoTrack } from 'mp4box';

export class MP4Demuxer {
  private file: MP4File;
  private onConfig: (config: VideoDecoderConfig) => void;
  private onChunk: (chunk: EncodedVideoChunk) => void;
  private setStatus: (status: string) => void;

  constructor(file: File | Blob | string, callbacks: {
    onConfig: (config: VideoDecoderConfig) => void;
    onChunk: (chunk: EncodedVideoChunk) => void;
    setStatus: (status: string) => void;
  }) {
    this.onConfig = callbacks.onConfig;
    this.onChunk = callbacks.onChunk;
    this.setStatus = callbacks.setStatus;

    this.file = MP4Box.createFile();
    this.file.onError = (e) => console.error("MP4Box Error", e);
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
    
    // Simplistic approach: Read entire file
    // For large files, stream it step by step
    const buffer = await response.arrayBuffer();
    (buffer as MP4ArrayBuffer).fileStart = 0;
    this.file.appendBuffer(buffer as MP4ArrayBuffer);
    this.file.flush();
  }

  private onReady(info: MP4Info) {
    const track = info.videoTracks[0];
    if (!track) {
      this.setStatus("No video track found");
      return;
    }

    const codec = track.codec; 
    let description: Uint8Array | undefined;
    const trak = this.file.getTrackById(track.id);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      if (entry.avcC || entry.hvcC || entry.vpcC) {
        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
        if (entry.avcC) entry.avcC.write(stream);
        else if (entry.hvcC) entry.hvcC.write(stream);
        else if (entry.vpcC) entry.vpcC.write(stream);
        description = new Uint8Array(stream.buffer, 8);
        break;
      }
    }

    this.onConfig({
      codec: codec.startsWith('avc1') ? codec : (codec.startsWith('hvc1') ? codec : 'avc1.42E01E'),
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description,
      hardwareAcceleration: 'prefer-hardware'
    });

    this.file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples }); // Extract all samples
    this.file.start();
  }

  private onSamples(trackId: number, user: any, samples: any[]) {
    for (const sample of samples) {
      this.onChunk(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: 1e6 * sample.cts / sample.timescale,
        duration: 1e6 * sample.duration / sample.timescale,
        data: sample.data
      }));
    }
  }
}
