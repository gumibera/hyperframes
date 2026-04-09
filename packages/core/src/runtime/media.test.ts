import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshRuntimeMediaCache, syncRuntimeMedia } from "./media";
import type { RuntimeMediaClip } from "./media";

function createVideo(attrs: Record<string, string>): HTMLVideoElement {
  const el = document.createElement("video");
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  // jsdom doesn't compute media duration, so we stub it
  Object.defineProperty(el, "duration", { value: NaN, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

function createAudio(attrs: Record<string, string>): HTMLAudioElement {
  const el = document.createElement("audio");
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  Object.defineProperty(el, "duration", { value: NaN, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe("refreshRuntimeMediaCache", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds video elements with data-start", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.timedMediaEls).toHaveLength(1);
    expect(result.mediaClips).toHaveLength(1);
    expect(result.videoClips).toHaveLength(1);
  });

  it("finds audio elements with data-start", () => {
    createAudio({ "data-start": "2", "data-duration": "3" });
    const result = refreshRuntimeMediaCache();
    expect(result.timedMediaEls).toHaveLength(1);
    expect(result.mediaClips).toHaveLength(1);
    expect(result.videoClips).toHaveLength(0);
  });

  it("ignores media without data-start", () => {
    document.body.appendChild(document.createElement("video"));
    const result = refreshRuntimeMediaCache();
    expect(result.timedMediaEls).toHaveLength(0);
  });

  it("calculates clip end from start + duration", () => {
    createVideo({ "data-start": "2", "data-duration": "3" });
    const result = refreshRuntimeMediaCache();
    const clip = result.mediaClips[0];
    expect(clip.start).toBe(2);
    expect(clip.duration).toBe(3);
    expect(clip.end).toBe(5);
  });

  it("uses media-start offset", () => {
    createVideo({ "data-start": "0", "data-duration": "5", "data-media-start": "10" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].mediaStart).toBe(10);
  });

  it("parses volume attribute", () => {
    createVideo({ "data-start": "0", "data-duration": "5", "data-volume": "0.5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].volume).toBe(0.5);
  });

  it("handles missing volume gracefully", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].volume).toBeNull();
  });

  it("maxMediaEnd tracks highest clip end", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    createVideo({ "data-start": "3", "data-duration": "10" });
    const result = refreshRuntimeMediaCache();
    expect(result.maxMediaEnd).toBe(13);
  });

  it("uses custom resolveStartSeconds", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache({ resolveStartSeconds: () => 10 });
    expect(result.mediaClips[0].start).toBe(10);
  });

  it("falls back to element.duration when data-duration missing", () => {
    const el = createVideo({ "data-start": "0" });
    Object.defineProperty(el, "duration", { value: 8, writable: true });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].duration).toBe(8);
  });

  it("reads defaultPlaybackRate from element", () => {
    const el = createVideo({ "data-start": "0", "data-duration": "10" });
    Object.defineProperty(el, "defaultPlaybackRate", { value: 0.5, writable: true });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].playbackRate).toBe(0.5);
  });

  it("defaults playback rate to 1", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].playbackRate).toBe(1);
  });

  it("clamps playback rate to [0.1, 5]", () => {
    const el1 = createVideo({ "data-start": "0", "data-duration": "5" });
    Object.defineProperty(el1, "defaultPlaybackRate", { value: 0.01, writable: true });
    const r1 = refreshRuntimeMediaCache();
    expect(r1.mediaClips[0].playbackRate).toBe(0.1);
    document.body.innerHTML = "";
    const el2 = createVideo({ "data-start": "0", "data-duration": "5" });
    Object.defineProperty(el2, "defaultPlaybackRate", { value: 10, writable: true });
    const r2 = refreshRuntimeMediaCache();
    expect(r2.mediaClips[0].playbackRate).toBe(5);
  });

  it("adjusts fallback duration by playback rate", () => {
    const el = createVideo({ "data-start": "0" });
    Object.defineProperty(el, "defaultPlaybackRate", { value: 0.5, writable: true });
    Object.defineProperty(el, "duration", { value: 10, writable: true });
    const result = refreshRuntimeMediaCache();
    // 10s source at 0.5x = 20s on timeline
    expect(result.mediaClips[0].duration).toBe(20);
  });

  it("reads native loop attribute", () => {
    createVideo({ "data-start": "0", "data-duration": "15", loop: "" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].loop).toBe(true);
  });

  it("defaults loop to false", () => {
    createVideo({ "data-start": "0", "data-duration": "5" });
    const result = refreshRuntimeMediaCache();
    expect(result.mediaClips[0].loop).toBe(false);
  });
});

describe("syncRuntimeMedia", () => {
  function createMockClip(overrides?: Partial<RuntimeMediaClip>): RuntimeMediaClip {
    const el = document.createElement("video") as HTMLVideoElement;
    document.body.appendChild(el);
    Object.defineProperty(el, "paused", { value: true, writable: true, configurable: true });
    el.play = vi.fn(() => Promise.resolve());
    el.pause = vi.fn();
    Object.defineProperty(el, "currentTime", { value: 0, writable: true, configurable: true });
    Object.defineProperty(el, "playbackRate", { value: 1, writable: true, configurable: true });
    return {
      el,
      start: 0,
      mediaStart: 0,
      duration: 10,
      end: 10,
      volume: null,
      playbackRate: 1,
      loop: false,
      sourceDuration: null,
      ...overrides,
    };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("plays active clip when playing and buffered", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 4, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.play).toHaveBeenCalled();
  });

  it("defers play on unbuffered media and calls load()", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 0, writable: true });
    const loadSpy = vi.spyOn(clip.el, "load").mockImplementation(() => {});
    const addEventSpy = vi.spyOn(clip.el, "addEventListener");
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.play).not.toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalledOnce();
    expect(addEventSpy).toHaveBeenCalledWith("canplay", expect.any(Function), { once: true });
  });

  it("plays when canplay fires after deferred play", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 0, writable: true });
    vi.spyOn(clip.el, "load").mockImplementation(() => {});
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    expect(clip.el.play).not.toHaveBeenCalled();
    clip.el.dispatchEvent(new Event("canplay"));
    expect(clip.el.play).toHaveBeenCalled();
  });

  it("does not re-register listener on repeated ticks while unbuffered", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "readyState", { value: 0, writable: true });
    const loadSpy = vi.spyOn(clip.el, "load").mockImplementation(() => {});
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 1 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5.1, playing: true, playbackRate: 1 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5.2, playing: true, playbackRate: 1 });
    expect(loadSpy).toHaveBeenCalledOnce();
  });

  it("pauses active clip when not playing", () => {
    const clip = createMockClip({ start: 0, end: 10 });
    Object.defineProperty(clip.el, "paused", { value: false, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.pause).toHaveBeenCalled();
  });

  it("pauses inactive clip", () => {
    const clip = createMockClip({ start: 5, end: 10 });
    Object.defineProperty(clip.el, "paused", { value: false, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 2, playing: true, playbackRate: 1 });
    expect(clip.el.pause).toHaveBeenCalled();
  });

  it("sets volume when clip has volume", () => {
    const clip = createMockClip({ start: 0, end: 10, volume: 0.7 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.volume).toBe(0.7);
  });

  it("seeks when currentTime drifts > 0.3s", () => {
    const clip = createMockClip({ start: 0, end: 10, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(5);
  });

  it("does not seek when currentTime is close enough", () => {
    const clip = createMockClip({ start: 0, end: 10, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 5.1, writable: true });
    const original = clip.el.currentTime;
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(original);
  });

  it("sets per-element playbackRate × global rate", () => {
    const clip = createMockClip({ start: 0, end: 10, playbackRate: 0.5 });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 5, playing: true, playbackRate: 2 });
    expect(clip.el.playbackRate).toBe(1); // 0.5 × 2 = 1
  });

  it("computes relTime with per-element playback rate", () => {
    const clip = createMockClip({ start: 0, end: 20, playbackRate: 0.5, mediaStart: 0 });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    syncRuntimeMedia({ clips: [clip], timeSeconds: 10, playing: false, playbackRate: 1 });
    // At timeline t=10, with 0.5x rate: relTime = 10 * 0.5 + 0 = 5s into the media
    expect(clip.el.currentTime).toBe(5);
  });

  it("wraps relTime when loop is true and media has ended", () => {
    // 3s source at 1x, looped over 10s clip
    const clip = createMockClip({
      start: 0,
      end: 10,
      mediaStart: 0,
      loop: true,
      sourceDuration: 3,
    });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // At t=7, relTime = 7, wraps to 7 % 3 = 1
    syncRuntimeMedia({ clips: [clip], timeSeconds: 7, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(1);
  });

  it("wraps loop with mediaStart offset", () => {
    // Source is 10s, mediaStart=5, so loop length is 5s (5-10)
    const clip = createMockClip({
      start: 0,
      end: 15,
      mediaStart: 5,
      loop: true,
      sourceDuration: 10,
    });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // At t=7: relTime = 7*1 + 5 = 12, wraps: 5 + ((12-5) % 5) = 5 + (7%5) = 5+2 = 7
    syncRuntimeMedia({ clips: [clip], timeSeconds: 7, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(7);
  });

  it("does not loop when loop is false", () => {
    const clip = createMockClip({
      start: 0,
      end: 10,
      mediaStart: 0,
      loop: false,
      sourceDuration: 3,
    });
    Object.defineProperty(clip.el, "currentTime", { value: 0, writable: true });
    // At t=7, relTime = 7 (no wrapping, even though > sourceDuration)
    syncRuntimeMedia({ clips: [clip], timeSeconds: 7, playing: false, playbackRate: 1 });
    expect(clip.el.currentTime).toBe(7);
  });
});
