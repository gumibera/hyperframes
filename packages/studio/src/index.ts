// NLE Layout
export { NLELayout } from "./components/nle/NLELayout";
export { NLEPreview } from "./components/nle/NLEPreview";
export { CompositionBreadcrumb } from "./components/nle/CompositionBreadcrumb";
export type { CompositionLevel } from "./components/nle/CompositionBreadcrumb";

// Player (preview, timeline, playback controls)
export {
  Player,
  PlayerControls,
  Timeline,
  PreviewPanel,
  useTimelinePlayer,
  usePlayerStore,
  liveTime,
  formatTime,
} from "./player";
export type { TimelineElement, ZoomMode } from "./player";

// Editor
export { SourceEditor } from "./components/editor/SourceEditor";
export { PropertyPanel } from "./components/editor/PropertyPanel";
export { FileTree } from "./components/editor/FileTree";

// App
export { StudioApp } from "./App";

// Hooks
export { useCodeEditor } from "./hooks/useCodeEditor";
export { useElementPicker } from "./hooks/useElementPicker";
