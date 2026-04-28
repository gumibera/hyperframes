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
  VideoThumbnail,
  CompositionThumbnail,
  useTimelinePlayer,
  resolveIframe,
  usePlayerStore,
  liveTime,
  formatTime,
} from "./player";
export type { TimelineElement } from "./player";

// Editor
export { SourceEditor } from "./components/editor/SourceEditor";
export { PropertyPanel } from "./components/editor/PropertyPanel";
export { FileTree } from "./components/editor/FileTree";

// DOM editing inspector
export {
  resolveDomEditSelection,
  refreshDomEditSelection,
  resolveDomEditCapabilities,
  findElementForSelection,
  isTextEditableSelection,
  buildDomEditStylePatchOperation,
  buildDomEditMovePatchOperations,
  buildDomEditResizePatchOperations,
  buildDomEditDetachPatchOperations,
} from "./components/editor/domEditing";
export type {
  DomEditSelection,
  DomEditTextField,
  DomEditCapabilities,
  DomEditContextOptions,
} from "./components/editor/domEditing";
export type { ImportedFontAsset } from "./components/editor/fontAssets";

// App
export { StudioApp } from "./App";

// Hooks
export { useElementPicker } from "./hooks/useElementPicker";
export type { PickedElement } from "./hooks/useElementPicker";

// Utilities
export { resolveSourceFile, applyPatch } from "./utils/sourcePatcher";
export type { PatchOperation } from "./utils/sourcePatcher";
export { parseStyleString, mergeStyleIntoTag, findElementBlock } from "./utils/htmlEditor";
