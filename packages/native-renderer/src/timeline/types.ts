/**
 * Baked timeline types — a pre-evaluated animation timeline where every frame's
 * element properties have been resolved from GSAP via Chrome CDP.
 *
 * Field names use snake_case to match the Rust serde types in
 * `packages/native-renderer/src/scene/mod.rs` (Transform2D, Style, etc.).
 */

export interface BakedTimeline {
  fps: number;
  duration: number;
  total_frames: number;
  frames: BakedFrame[];
}

export interface BakedFrame {
  frame_index: number;
  time: number;
  elements: Record<string, BakedElementState>;
}

export interface BakedElementState {
  opacity: number;
  translate_x: number;
  translate_y: number;
  scale_x: number;
  scale_y: number;
  rotate_deg: number;
  visibility: boolean;
  // Per-frame bounds (captures layout changes from CSS animations)
  bounds_x?: number;
  bounds_y?: number;
  bounds_w?: number;
  bounds_h?: number;
  // Per-frame colors (captures animated background/text colors)
  background_color?: { r: number; g: number; b: number; a: number } | null;
  color?: { r: number; g: number; b: number; a: number } | null;
  // Per-frame border-radius
  border_radius?: [number, number, number, number];
  // Per-frame clip-path
  clip_path?: string | null;
}
