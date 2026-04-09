/**
 * Audio Mixer
 *
 * Mixes audio sources using OfflineAudioContext.
 * Decodes audio files, applies volume/timing offsets,
 * and renders to a single AudioBuffer (PCM).
 */

import type { AudioMixConfig, AudioMixResult } from "../types.js";

const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;

export async function mixAudio(config: AudioMixConfig): Promise<AudioMixResult> {
  const sampleRate = config.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = config.channels ?? DEFAULT_CHANNELS;
  const totalSamples = Math.ceil(config.duration * sampleRate);

  const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);

  for (const source of config.sources) {
    const arrayBuffer = await fetchAudioData(source.src);
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;

    // Apply volume
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = source.volume ?? 1;

    bufferSource.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    // Calculate timing
    const mediaOffset = source.mediaOffset ?? 0;
    const clipDuration = source.endTime - source.startTime;

    if (mediaOffset > 0) {
      bufferSource.start(source.startTime, mediaOffset, clipDuration);
    } else {
      bufferSource.start(source.startTime, 0, clipDuration);
    }
  }

  const renderedBuffer = await offlineCtx.startRendering();

  return {
    buffer: renderedBuffer,
    sampleRate,
    channels,
  };
}

async function fetchAudioData(src: string | Blob): Promise<ArrayBuffer> {
  if (src instanceof Blob) {
    return src.arrayBuffer();
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${src} (${response.status})`);
  }
  return response.arrayBuffer();
}
