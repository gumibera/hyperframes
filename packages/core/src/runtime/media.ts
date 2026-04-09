export type RuntimeMediaClip = {
  el: HTMLVideoElement | HTMLAudioElement;
  start: number;
  mediaStart: number;
  duration: number;
  end: number;
  volume: number | null;
  playbackRate: number;
  loop: boolean;
  /** Source media duration in seconds (from el.duration). Used for loop wrapping. */
  sourceDuration: number | null;
};

export function refreshRuntimeMediaCache(params?: {
  resolveStartSeconds?: (element: Element) => number;
}): {
  timedMediaEls: Array<HTMLVideoElement | HTMLAudioElement>;
  mediaClips: RuntimeMediaClip[];
  videoClips: RuntimeMediaClip[];
  maxMediaEnd: number;
} {
  const mediaEls = Array.from(
    document.querySelectorAll("video[data-start], audio[data-start]"),
  ) as Array<HTMLVideoElement | HTMLAudioElement>;
  const mediaClips: RuntimeMediaClip[] = [];
  const videoClips: RuntimeMediaClip[] = [];
  let maxMediaEnd = 0;
  for (const el of mediaEls) {
    const start = params?.resolveStartSeconds
      ? params.resolveStartSeconds(el)
      : Number.parseFloat(el.dataset.start ?? "0");
    if (!Number.isFinite(start)) continue;
    const mediaStart =
      Number.parseFloat(el.dataset.playbackStart ?? el.dataset.mediaStart ?? "0") || 0;
    // Read per-element rate from the native defaultPlaybackRate property.
    // LLMs set this via el.defaultPlaybackRate = 0.5 in a <script> tag.
    const rawRate = el.defaultPlaybackRate;
    const playbackRate =
      Number.isFinite(rawRate) && rawRate > 0 ? Math.max(0.1, Math.min(5, rawRate)) : 1;
    const loop = el.loop;
    const sourceDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    let duration = Number.parseFloat(el.dataset.duration ?? "");
    if ((!Number.isFinite(duration) || duration <= 0) && sourceDuration != null) {
      // Effective duration accounts for playback rate:
      // at 0.5x, a 10s source plays for 20s on the timeline
      duration = Math.max(0, (sourceDuration - mediaStart) / playbackRate);
    }
    const end =
      Number.isFinite(duration) && duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
    const volumeRaw = Number.parseFloat(el.dataset.volume ?? "");
    const clip: RuntimeMediaClip = {
      el,
      start,
      mediaStart,
      duration: Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY,
      end,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : null,
      playbackRate,
      loop,
      sourceDuration,
    };
    mediaClips.push(clip);
    if (el.tagName === "VIDEO") videoClips.push(clip);
    if (Number.isFinite(end)) maxMediaEnd = Math.max(maxMediaEnd, end);
  }
  return { timedMediaEls: mediaEls, mediaClips, videoClips, maxMediaEnd };
}

// Elements with a pending deferred play — prevents re-calling load()/addEventListener
// on every tick while the media is still buffering.
const pendingPlay = new WeakSet<HTMLMediaElement>();

export function syncRuntimeMedia(params: {
  clips: RuntimeMediaClip[];
  timeSeconds: number;
  playing: boolean;
  playbackRate: number;
}): void {
  for (const clip of params.clips) {
    const { el } = clip;
    if (!el.isConnected) continue;
    let relTime = (params.timeSeconds - clip.start) * clip.playbackRate + clip.mediaStart;
    const isActive =
      params.timeSeconds >= clip.start && params.timeSeconds < clip.end && relTime >= 0;
    if (isActive) {
      // Loop wrapping: when media reaches end, restart from mediaStart
      if (clip.loop && clip.sourceDuration != null && clip.sourceDuration > 0) {
        const loopLength = clip.sourceDuration - clip.mediaStart;
        if (loopLength > 0 && relTime >= clip.sourceDuration) {
          relTime = clip.mediaStart + ((relTime - clip.mediaStart) % loopLength);
        }
      }
      if (clip.volume != null) el.volume = clip.volume;
      try {
        // Per-element rate × global transport rate
        el.playbackRate = clip.playbackRate * params.playbackRate;
      } catch {
        // ignore unsupported playbackRate
      }
      if (Math.abs((el.currentTime || 0) - relTime) > 0.3) {
        try {
          el.currentTime = relTime;
        } catch {
          // ignore browser seek restrictions
        }
      }
      if (params.playing && el.paused && !pendingPlay.has(el)) {
        if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          void el.play().catch(() => {});
        } else {
          pendingPlay.add(el);
          if (el.preload !== "auto") el.preload = "auto";
          el.addEventListener(
            "canplay",
            () => {
              pendingPlay.delete(el);
              if (!el.paused) return;
              void el.play().catch(() => {});
            },
            { once: true },
          );
          el.addEventListener("error", () => pendingPlay.delete(el), { once: true });
          el.load();
        }
      } else if (!params.playing && !el.paused) {
        el.pause();
      }
      continue;
    }
    if (!el.paused) el.pause();
  }
}
