import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTime, formatSpeed, SPEED_PRESETS } from "./controls.js";

// ── Controls unit tests ──

describe("SPEED_PRESETS", () => {
  it("contains logarithmic speed steps", () => {
    expect(SPEED_PRESETS).toEqual([0.25, 0.5, 1, 1.5, 2, 4]);
  });

  it("includes 1x as default speed", () => {
    expect(SPEED_PRESETS).toContain(1);
  });
});

describe("formatSpeed", () => {
  it("formats integer speeds", () => {
    expect(formatSpeed(1)).toBe("1x");
    expect(formatSpeed(2)).toBe("2x");
    expect(formatSpeed(4)).toBe("4x");
  });

  it("formats fractional speeds", () => {
    expect(formatSpeed(0.25)).toBe("0.25x");
    expect(formatSpeed(0.5)).toBe("0.5x");
    expect(formatSpeed(1.5)).toBe("1.5x");
  });
});

describe("formatTime", () => {
  it("formats 0 seconds", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatTime(45)).toBe("0:45");
  });

  it("formats exact minutes", () => {
    expect(formatTime(120)).toBe("2:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(95)).toBe("1:35");
  });

  it("pads seconds with leading zero", () => {
    expect(formatTime(61)).toBe("1:01");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(3.7)).toBe("0:03");
  });

  it("handles negative input", () => {
    expect(formatTime(-5)).toBe("0:00");
  });
});

// ── Parent-frame audio proxies (ownership-based) ──
//
// Parent-frame audio/video copies are preloaded mirror proxies of the iframe's
// timed media. They exist as a fallback for environments that block iframe
// `.play()`. Under the default `runtime` audio ownership, the iframe drives
// audible playback and the proxies stay paused. Ownership flips to `parent`
// only when the runtime posts `media-autoplay-blocked` — then the proxies
// become the audible source and the iframe is silenced via bridge.

describe("HyperframesPlayer parent-frame media", () => {
  type PlayerElement = HTMLElement & {
    play: () => void;
    pause: () => void;
    seek: (t: number) => void;
    _audioOwner?: "runtime" | "parent";
    _promoteToParentProxy?: () => void;
  };

  let player: PlayerElement;
  let mockAudio: {
    src: string;
    preload: string;
    muted: boolean;
    playbackRate: number;
    currentTime: number;
    paused: boolean;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    await import("./hyperframes-player.js");

    mockAudio = {
      src: "",
      preload: "",
      muted: false,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
    };

    vi.spyOn(globalThis, "Audio").mockImplementation(
      () => mockAudio as unknown as HTMLAudioElement,
    );

    player = document.createElement("hyperframes-player") as PlayerElement;
  });

  afterEach(() => {
    player.remove();
    vi.restoreAllMocks();
  });

  it("includes audio-src in observedAttributes", () => {
    const Ctor = player.constructor as typeof HTMLElement & {
      observedAttributes: string[];
    };
    expect(Ctor.observedAttributes).toContain("audio-src");
  });

  it("creates Audio and starts preloading when audio-src is set", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    expect(globalThis.Audio).toHaveBeenCalled();
    expect(mockAudio.preload).toBe("auto");
    expect(mockAudio.src).toBe("https://cdn.example.com/narration.mp3");
    expect(mockAudio.load).toHaveBeenCalled();
  });

  it("syncs muted attribute to parent media", () => {
    player.setAttribute("muted", "");
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    expect(mockAudio.muted).toBe(true);
  });

  it("syncs playback-rate to parent media", () => {
    player.setAttribute("playback-rate", "1.5");
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    expect(mockAudio.playbackRate).toBe(1.5);
  });

  it("play() does NOT start parent-proxy under runtime ownership", () => {
    // Default ownership is `runtime` — the iframe drives audible playback.
    // If we also started parent proxies here, both would play and the user
    // would hear doubled, slightly-offset audio (the original bug).
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.play();
    expect(mockAudio.play).not.toHaveBeenCalled();
    expect(player._audioOwner).toBe("runtime");
  });

  it("pause() does NOT touch parent-proxy under runtime ownership", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.pause();
    expect(mockAudio.pause).not.toHaveBeenCalled();
  });

  it("seek() does NOT update parent currentTime under runtime ownership", () => {
    // Under runtime ownership the iframe is authoritative for time; touching
    // the proxy's currentTime would just trigger a re-buffer for no gain.
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.seek(12.5);
    expect(mockAudio.currentTime).toBe(0);
  });

  it("after promotion to parent ownership: play/pause/seek drive parent proxy", () => {
    // Simulates the runtime having posted `media-autoplay-blocked`. Post
    // promotion: the web component owns audible output and fully drives
    // the parent proxy.
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player._promoteToParentProxy?.();
    expect(player._audioOwner).toBe("parent");

    player.play();
    expect(mockAudio.play).toHaveBeenCalled();

    player.seek(12.5);
    expect(mockAudio.currentTime).toBe(12.5);

    player.pause();
    expect(mockAudio.pause).toHaveBeenCalled();
  });

  it("promotion is idempotent", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player._promoteToParentProxy?.();
    player._promoteToParentProxy?.();
    player._promoteToParentProxy?.();
    // Only one play() attempt is triggered by promotion itself (gated on
    // `!this._paused`, which is true by default so it doesn't trigger at all).
    // The test's meaning is: ownership stays `parent`, no thrash, no errors.
    expect(player._audioOwner).toBe("parent");
  });

  it("cleans up parent media on disconnect", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.remove();
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(mockAudio.src).toBe("");
  });

  it("updates parent media when playback-rate changes after setup", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.setAttribute("playback-rate", "2");
    expect(mockAudio.playbackRate).toBe(2);
  });

  it("updates parent media when muted toggles after setup", () => {
    player.setAttribute("audio-src", "https://cdn.example.com/narration.mp3");
    document.body.appendChild(player);

    player.setAttribute("muted", "");
    expect(mockAudio.muted).toBe(true);

    player.removeAttribute("muted");
    expect(mockAudio.muted).toBe(false);
  });
});
