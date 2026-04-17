import type { RuntimeDeterministicAdapter, RuntimeTimelineLike } from "./types";
import type { RuntimeMediaClip } from "./media";

export type RuntimeState = {
  capturedTimeline: RuntimeTimelineLike | null;
  isPlaying: boolean;
  rafId: number | null;
  currentTime: number;
  deterministicAdapters: RuntimeDeterministicAdapter[];
  parityModeEnabled: boolean;
  canonicalFps: number;
  bridgeMuted: boolean;
  /**
   * Internal mute of audible media output, owned by the audio-ownership
   * protocol between the parent (`<hyperframes-player>`) and this runtime.
   * Independent of `bridgeMuted` (the user's mute preference). When the
   * parent takes over audible playback via parent-frame proxies, it sets
   * this to `true` so the runtime keeps driving timed media for frame
   * accuracy but produces no audio of its own.
   */
  mediaOutputMuted: boolean;
  /**
   * Latch so the `media-autoplay-blocked` outbound message is posted at most
   * once per runtime session. The parent only needs the first signal — it
   * takes over playback and further rejections are the same problem.
   */
  mediaAutoplayBlockedPosted: boolean;
  playbackRate: number;
  bridgeLastPostedFrame: number;
  bridgeLastPostedAt: number;
  bridgeLastPostedPlaying: boolean;
  bridgeLastPostedMuted: boolean;
  bridgeMaxPostIntervalMs: number;
  timelinePollIntervalId: ReturnType<typeof setInterval> | null;
  controlBridgeHandler: ((event: MessageEvent) => void) | null;
  clampDurationLoggedRaw: number | null;
  beforeUnloadHandler: (() => void) | null;
  domReadyHandler: (() => void) | null;
  injectedCompStyles: HTMLStyleElement[];
  injectedCompScripts: HTMLScriptElement[];
  cachedTimedMediaEls: Array<HTMLVideoElement | HTMLAudioElement>;
  cachedMediaClips: RuntimeMediaClip[];
  cachedVideoClips: RuntimeMediaClip[];
  cachedMediaTimelineDurationSeconds: number;
  tornDown: boolean;
  maxTimelineDurationSeconds: number;
  nativeVisualWatchdogTick: number;
};

export function createRuntimeState(): RuntimeState {
  return {
    capturedTimeline: null,
    isPlaying: false,
    rafId: null,
    currentTime: 0,
    deterministicAdapters: [],
    parityModeEnabled: true,
    canonicalFps: 30,
    bridgeMuted: false,
    mediaOutputMuted: false,
    mediaAutoplayBlockedPosted: false,
    playbackRate: 1,
    bridgeLastPostedFrame: -1,
    bridgeLastPostedAt: 0,
    bridgeLastPostedPlaying: false,
    bridgeLastPostedMuted: false,
    bridgeMaxPostIntervalMs: 80,
    timelinePollIntervalId: null,
    controlBridgeHandler: null,
    clampDurationLoggedRaw: null,
    beforeUnloadHandler: null,
    domReadyHandler: null,
    injectedCompStyles: [],
    injectedCompScripts: [],
    cachedTimedMediaEls: [],
    cachedMediaClips: [],
    cachedVideoClips: [],
    cachedMediaTimelineDurationSeconds: 0,
    tornDown: false,
    maxTimelineDurationSeconds: 1800,
    nativeVisualWatchdogTick: 0,
  };
}
