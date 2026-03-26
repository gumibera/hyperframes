import { create } from "zustand";

export interface TimelineElement {
  id: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  src?: string;
  playbackStart?: number;
  volume?: number;
  /** Path from data-composition-src — identifies sub-composition elements */
  compositionSrc?: string;
}

export type ZoomMode = "fit" | "manual";

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelineReady: boolean;
  elements: TimelineElement[];
  selectedElementId: string | null;
  playbackRate: number;
  /** Timeline zoom: 'fit' auto-scales to viewport, 'manual' uses pixelsPerSecond */
  zoomMode: ZoomMode;
  /** Pixels per second when in manual zoom mode */
  pixelsPerSecond: number;
  /** Edit range selection */
  editRangeStart: number | null;
  editRangeEnd: number | null;
  editMode: boolean;

  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackRate: (rate: number) => void;
  setTimelineReady: (ready: boolean) => void;
  setElements: (elements: TimelineElement[]) => void;
  setSelectedElementId: (id: string | null) => void;
  setEditRange: (start: number | null, end: number | null) => void;
  setEditMode: (active: boolean) => void;
  updateElementStart: (elementId: string, newStart: number) => void;
  updateElementDuration: (elementId: string, newDuration: number) => void;
  updateElementTrack: (elementId: string, newTrack: number) => void;
  updateElement: (
    elementId: string,
    updates: Partial<Pick<TimelineElement, "start" | "duration" | "track">>,
  ) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setPixelsPerSecond: (pps: number) => void;
  reset: () => void;
}

// Lightweight pub-sub for current time during playback.
// Bypasses React state so the RAF loop can update the playhead/time display
// without triggering re-renders on every frame.
type TimeListener = (time: number) => void;
const _timeListeners = new Set<TimeListener>();
export const liveTime = {
  notify: (t: number) => _timeListeners.forEach((cb) => cb(t)),
  subscribe: (cb: TimeListener) => {
    _timeListeners.add(cb);
    return () => _timeListeners.delete(cb);
  },
};

export const usePlayerStore = create<PlayerState>((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  timelineReady: false,
  elements: [],
  selectedElementId: null,
  playbackRate: 1,
  zoomMode: "fit",
  pixelsPerSecond: 100,
  editRangeStart: null,
  editRangeEnd: null,
  editMode: false,

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  setZoomMode: (mode) => set({ zoomMode: mode }),
  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: Math.max(10, pps) }),
  setCurrentTime: (time) => set({ currentTime: Number.isFinite(time) ? time : 0 }),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setTimelineReady: (ready) => set({ timelineReady: ready }),
  setElements: (elements) => set({ elements }),
  setSelectedElementId: (id) => set({ selectedElementId: id }),
  setEditRange: (start, end) => set({ editRangeStart: start, editRangeEnd: end }),
  setEditMode: (active) => set({ editMode: active, editRangeStart: null, editRangeEnd: null }),
  updateElementStart: (elementId, newStart) =>
    set((state) => ({
      elements: state.elements.map((el) => (el.id === elementId ? { ...el, start: newStart } : el)),
    })),
  updateElementDuration: (elementId, newDuration) =>
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === elementId ? { ...el, duration: newDuration } : el,
      ),
    })),
  updateElementTrack: (elementId, newTrack) =>
    set((state) => ({
      elements: state.elements.map((el) => (el.id === elementId ? { ...el, track: newTrack } : el)),
    })),
  updateElement: (elementId, updates) =>
    set((state) => ({
      elements: state.elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el)),
    })),
  reset: () =>
    set({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      timelineReady: false,
      elements: [],
      selectedElementId: null,
    }),
}));
