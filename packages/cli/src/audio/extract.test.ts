import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { analyzeAudioSamples, computeBandEdges, decodeAudioToMono } from "./extract.js";

describe("audio analysis helpers", () => {
  it("computes monotonically increasing logarithmic band edges", () => {
    const edges = computeBandEdges(8);
    expect(edges).toHaveLength(9);
    for (let i = 1; i < edges.length; i++) {
      expect((edges[i] ?? 0) > (edges[i - 1] ?? 0)).toBe(true);
    }
  });

  it("normalizes RMS and bands for a synthetic sine wave", () => {
    const sampleRate = 44_100;
    const fps = 30;
    const durationSeconds = 1;
    const sampleCount = sampleRate * durationSeconds;
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const analysis = analyzeAudioSamples(samples, fps, 8, sampleRate);
    expect(analysis.totalFrames).toBe(30);
    expect(analysis.frames).toHaveLength(30);
    expect(analysis.frames.every((frame) => frame.rms >= 0 && frame.rms <= 1)).toBe(true);
    expect(
      analysis.frames.every((frame) => frame.bands.every((band) => band >= 0 && band <= 1)),
    ).toBe(true);
    const firstBands = analysis.frames[0]?.bands ?? [];
    expect(firstBands.some((band) => band > 0.1)).toBe(true);
  });

  it("decodes real fixture audio with ffmpeg", () => {
    // Uses the narration.wav committed with the audio-reactive-render-compat
    // producer fixture so the test works in CI and on any checkout.
    const fixture = join(
      import.meta.dirname,
      "../../../producer/tests/audio-reactive-render-compat/src/narration.wav",
    );
    const samples = decodeAudioToMono(fixture);
    expect(samples.length > 1000).toBe(true);
    const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    expect(peak > 0.01).toBe(true);
  });
});
