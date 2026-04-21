import type { RuntimePlayer, RuntimeTimelineLike } from "./types";
import { quantizeTimeToFrame } from "../inline-scripts/parityContract";

type PlayerDeps = {
  getTimeline: () => RuntimeTimelineLike | null;
  setTimeline: (timeline: RuntimeTimelineLike | null) => void;
  getIsPlaying: () => boolean;
  setIsPlaying: (playing: boolean) => void;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getCanonicalFps: () => number;
  onSyncMedia: (timeSeconds: number, playing: boolean) => void;
  onStatePost: (force: boolean) => void;
  onDeterministicSeek: (timeSeconds: number) => void;
  onDeterministicPause: () => void;
  onDeterministicPlay: () => void;
  onRenderFrameSeek: (timeSeconds: number) => void;
  onShowNativeVideos: () => void;
  getSafeDuration?: () => number;
  /**
   * Optional registry of sibling timelines (typically `window.__timelines`).
   * Provided so that play/pause propagate to sub-scene timelines registered
   * alongside the master — e.g. a nested-composition master with per-scene
   * timelines like `scene1-logo-intro`, `scene2-4-canvas`. Without this,
   * pausing the master would leave scene timelines free-running.
   *
   * Note: `seek`/`renderSeek` do NOT iterate the registry. Siblings are
   * also added as children of the master in `init.ts`, and GSAP's
   * `totalTime` cascade positions each child at its nested time
   * automatically. Iterating and calling `totalTime(rootTime, false)` on
   * each sibling would overwrite the cascade with the wrong absolute time.
   */
  getTimelineRegistry?: () => Record<string, RuntimeTimelineLike | undefined>;
};

function forEachSiblingTimeline(
  registry: Record<string, RuntimeTimelineLike | undefined> | undefined | null,
  master: RuntimeTimelineLike,
  fn: (tl: RuntimeTimelineLike) => void,
): void {
  if (!registry) return;
  for (const tl of Object.values(registry)) {
    if (!tl || tl === master) continue;
    try {
      fn(tl);
    } catch {
      // ignore sibling failures — one broken timeline shouldn't poison play/pause
    }
  }
}

function seekTimelineDeterministically(
  timeline: RuntimeTimelineLike,
  timeSeconds: number,
  canonicalFps: number,
): number {
  const quantized = quantizeTimeToFrame(timeSeconds, canonicalFps);
  timeline.pause();
  if (typeof timeline.totalTime === "function") {
    timeline.totalTime(quantized, false);
  } else {
    timeline.seek(quantized, false);
  }
  return quantized;
}

export function createRuntimePlayer(deps: PlayerDeps): RuntimePlayer {
  return {
    _timeline: null,
    play: () => {
      const timeline = deps.getTimeline();
      if (!timeline || deps.getIsPlaying()) return;
      const safeDuration = Math.max(
        0,
        Number(deps.getSafeDuration?.() ?? timeline.duration() ?? 0) || 0,
      );
      if (safeDuration > 0) {
        const currentTime = Math.max(0, Number(timeline.time()) || 0);
        if (currentTime >= safeDuration) {
          timeline.pause();
          timeline.seek(0, false);
          deps.onDeterministicSeek(0);
          deps.setIsPlaying(false);
          deps.onSyncMedia(0, false);
          deps.onRenderFrameSeek(0);
        }
      }
      if (typeof timeline.timeScale === "function") {
        timeline.timeScale(deps.getPlaybackRate());
      }
      timeline.play();
      forEachSiblingTimeline(deps.getTimelineRegistry?.(), timeline, (tl) => {
        if (typeof tl.timeScale === "function") tl.timeScale(deps.getPlaybackRate());
        tl.play();
      });
      deps.onDeterministicPlay();
      deps.setIsPlaying(true);
      deps.onShowNativeVideos();
      deps.onStatePost(true);
    },
    pause: () => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
      forEachSiblingTimeline(deps.getTimelineRegistry?.(), timeline, (tl) => {
        tl.pause();
      });
      const time = Math.max(0, Number(timeline.time()) || 0);
      deps.onDeterministicSeek(time);
      deps.onDeterministicPause();
      deps.setIsPlaying(false);
      deps.onSyncMedia(time, false);
      deps.onRenderFrameSeek(time);
      deps.onStatePost(true);
    },
    seek: (timeSeconds: number) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      const safeTime = Math.max(0, Number(timeSeconds) || 0);
      // Seek only the master. Siblings in the registry are also added as
      // children of the master in `init.ts`; GSAP's `totalTime` cascade
      // propagates from master to each nested child at its own nested time
      // automatically. Iterating the registry and calling
      // `totalTime(rootTime, false)` on each sibling would overwrite the
      // cascaded nested time with the (wrong) absolute root time — breaking
      // every producer golden baseline.
      //
      // Caveat: in the async-scene-loading path with children individually
      // paused (preview mode), cascade won't re-render paused children, so a
      // scrub-back after playthrough can leave scenes parked at their
      // end state. Fixing that properly requires the async loader to parent
      // scenes to the master reliably (see init.ts notes) — follow-up.
      const quantized = seekTimelineDeterministically(timeline, safeTime, deps.getCanonicalFps());
      deps.onDeterministicSeek(quantized);
      deps.setIsPlaying(false);
      deps.onSyncMedia(quantized, false);
      deps.onRenderFrameSeek(quantized);
      deps.onStatePost(true);
    },
    renderSeek: (timeSeconds: number) => {
      const timeline = deps.getTimeline();
      const canonicalFps = deps.getCanonicalFps();
      // When a composition has no GSAP timeline (pure CSS / WAAPI / Lottie /
      // Three.js adapters driving the animation), still seek the adapters so
      // their animations advance. Without this, non-GSAP compositions freeze
      // on their initial frame.
      const quantized = timeline
        ? seekTimelineDeterministically(timeline, timeSeconds, canonicalFps)
        : quantizeTimeToFrame(Math.max(0, Number(timeSeconds) || 0), canonicalFps);
      deps.onDeterministicSeek(quantized);
      deps.setIsPlaying(false);
      deps.onSyncMedia(quantized, false);
      deps.onRenderFrameSeek(quantized);
      deps.onStatePost(true);
    },
    getTime: () => Number(deps.getTimeline()?.time() ?? 0),
    getDuration: () => Number(deps.getTimeline()?.duration() ?? 0),
    isPlaying: () => deps.getIsPlaying(),
    setPlaybackRate: (rate: number) => deps.setPlaybackRate(rate),
    getPlaybackRate: () => deps.getPlaybackRate(),
  };
}
