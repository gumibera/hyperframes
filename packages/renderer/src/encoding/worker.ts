/**
 * Encoding Worker
 *
 * Receives ImageBitmap frames from the main thread, encodes via
 * WebCodecs VideoEncoder, and muxes into MP4/WebM via MediaBunny.
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedPacket,
  AudioSampleSource,
  AudioSample,
} from "mediabunny";
import type { WorkerInMessage, WorkerOutMessage } from "./types.js";

let output: Output | null = null;
let videoSource: EncodedVideoPacketSource | null = null;
let audioSource: AudioSampleSource | null = null;
let encoder: VideoEncoder | null = null;
let target: BufferTarget | null = null;
let isFirstPacket = true;
let framesEncoded = 0;

function post(msg: WorkerOutMessage, transfer?: Transferable[]): void {
  self.postMessage(msg, { transfer: transfer ?? [] });
}

async function handleInit(config: WorkerInMessage & { type: "init" }): Promise<void> {
  const { width, height, fps, codec, bitrate, format } = config.config;

  target = new BufferTarget();
  const formatObj = format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();
  output = new Output({ format: formatObj, target });

  // Map WebCodecs codec string to MediaBunny VideoCodec identifier
  const mbVideoCodec = codec.startsWith("avc") ? "avc" : "vp9";
  videoSource = new EncodedVideoPacketSource(mbVideoCodec);
  output.addVideoTrack(videoSource, { frameRate: fps });

  audioSource = new AudioSampleSource({ codec: "aac", bitrate: 128_000 });
  output.addAudioTrack(audioSource);

  const encoderConfig: VideoEncoderConfig = {
    codec,
    width,
    height,
    bitrate,
    hardwareAcceleration: "prefer-hardware",
  };

  encoder = new VideoEncoder({
    output: async (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      if (isFirstPacket) {
        await videoSource!.add(packet, meta);
        isFirstPacket = false;
      } else {
        await videoSource!.add(packet);
      }
      framesEncoded++;
      post({ type: "frame-encoded", index: framesEncoded - 1 });
    },
    error: (e) => {
      post({ type: "error", message: e.message });
    },
  });

  encoder.configure(encoderConfig);
  await output.start();

  post({ type: "ready" });
}

async function handleFrame(msg: WorkerInMessage & { type: "frame" }): Promise<void> {
  if (!encoder) {
    post({ type: "error", message: "Encoder not initialized" });
    return;
  }

  const frame = new VideoFrame(msg.bitmap, {
    timestamp: msg.timestamp,
  });

  const isKeyFrame = msg.index % 150 === 0;
  encoder.encode(frame, { keyFrame: isKeyFrame });
  frame.close();
  msg.bitmap.close();
}

async function handleSetAudio(msg: WorkerInMessage & { type: "set-audio" }): Promise<void> {
  if (!audioSource) return;

  const interleaved = interleaveChannels(msg.channelData);
  const sample = new AudioSample({
    data: interleaved,
    format: "f32-planar",
    numberOfChannels: msg.channelData.length,
    sampleRate: msg.sampleRate,
    timestamp: 0,
  });
  await audioSource.add(sample);
  sample[Symbol.dispose]();
}

async function handleFinalize(): Promise<void> {
  if (!encoder || !output || !target || !videoSource || !audioSource) {
    post({ type: "error", message: "Cannot finalize — not initialized" });
    return;
  }

  await encoder.flush();
  encoder.close();
  videoSource.close();
  audioSource.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) {
    post({ type: "error", message: "No output buffer after finalize" });
    return;
  }

  const blob = new Blob([buffer], { type: "video/mp4" });
  post({ type: "done", blob });
}

function interleaveChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = channels[0]!.length * channels.length;
  const result = new Float32Array(length);
  const numChannels = channels.length;
  const samplesPerChannel = channels[0]!.length;
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = channels[ch]!;
    for (let i = 0; i < samplesPerChannel; i++) {
      result[i * numChannels + ch] = channelData[i]!;
    }
  }
  return result;
}

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  try {
    switch (e.data.type) {
      case "init":
        await handleInit(e.data);
        break;
      case "frame":
        await handleFrame(e.data);
        break;
      case "set-audio":
        await handleSetAudio(e.data);
        break;
      case "finalize":
        await handleFinalize();
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
