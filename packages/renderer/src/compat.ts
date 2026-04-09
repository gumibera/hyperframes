/**
 * Feature detection for client-side rendering.
 */

export function isSupported(): boolean {
  return (
    typeof globalThis.VideoEncoder !== "undefined" &&
    typeof globalThis.OffscreenCanvas !== "undefined" &&
    typeof globalThis.AudioContext !== "undefined" &&
    typeof globalThis.createImageBitmap !== "undefined"
  );
}

export function detectBestFrameSource(): "draw-element-image" | "snapdom" {
  if (
    typeof CanvasRenderingContext2D !== "undefined" &&
    "drawElementImage" in CanvasRenderingContext2D.prototype
  ) {
    return "draw-element-image";
  }
  return "snapdom";
}
