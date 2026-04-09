/**
 * @hyperframes/renderer
 *
 * Client-side video rendering for HyperFrames compositions.
 * Zero server dependencies — renders entirely in the browser
 * using WebCodecs, MediaBunny, and SnapDOM.
 */

export { isSupported, detectBestFrameSource } from "./compat.js";

export type {
  RenderConfig,
  RenderProgress,
  RenderResult,
  FrameSource,
  FrameSourceConfig,
  HfMediaElement,
  EncoderConfig,
  AudioSource,
  AudioMixConfig,
  AudioMixResult,
  MuxerConfig,
} from "./types.js";
