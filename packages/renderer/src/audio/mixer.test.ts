import { describe, it, expect, vi } from "vitest";
import type { AudioMixConfig } from "../types.js";

// Mock OfflineAudioContext for jsdom environment
if (typeof globalThis.OfflineAudioContext === "undefined") {
  globalThis.OfflineAudioContext = vi
    .fn()
    .mockImplementation((channels: number, length: number, sampleRate: number) => ({
      createBufferSource: () => ({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
      }),
      createGain: () => ({
        gain: { value: 1 },
        connect: vi.fn(),
      }),
      destination: {},
      decodeAudioData: vi.fn().mockResolvedValue({
        duration: 1,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      }),
      startRendering: vi.fn().mockResolvedValue({
        duration: length / sampleRate,
        numberOfChannels: channels,
        sampleRate,
        length,
        getChannelData: () => new Float32Array(length),
      }),
    })) as unknown as typeof OfflineAudioContext;
}

// Dynamic import AFTER mock is set up
const { mixAudio } = await import("./mixer.js");

describe("mixAudio", () => {
  it("returns silent audio when no sources provided", async () => {
    const config: AudioMixConfig = {
      duration: 1.0,
      sampleRate: 44100,
      channels: 2,
      sources: [],
    };
    const result = await mixAudio(config);
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
  });

  it("uses default sample rate and channels", async () => {
    const result = await mixAudio({ duration: 0.5, sources: [] });
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
  });
});
