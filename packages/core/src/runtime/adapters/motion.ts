import type { RuntimeDeterministicAdapter } from "../types";

/**
 * Motion adapter for HyperFrames
 *
 * Supports Motion (motion.dev) — the framework-agnostic library from
 * the creators of Framer Motion. Uses the `.time` setter (seconds)
 * for frame-accurate seeking.
 *
 * ## Usage in a composition
 *
 * ```html
 * <script src="https://cdn.jsdelivr.net/npm/motion@12/dist/motion.min.js"></script>
 * <script>
 *   const { animate, stagger, spring } = Motion;
 *   const anim = animate('.box', { x: 250, rotate: 360 }, {
 *     duration: 2,
 *     ease: spring(),
 *   });
 *   window.__hfMotion = window.__hfMotion || [];
 *   window.__hfMotion.push(anim);
 * </script>
 * ```
 *
 * Sequenced animations work the same way:
 *
 * ```html
 * <script>
 *   const { animate } = Motion;
 *   const sequence = animate([
 *     ['.a', { opacity: [0, 1] }, { duration: 0.5 }],
 *     ['.b', { x: 100 }, { duration: 1, at: '+0.2' }],
 *   ]);
 *   window.__hfMotion = window.__hfMotion || [];
 *   window.__hfMotion.push(sequence);
 * </script>
 * ```
 *
 * Multiple instances are supported — all are seeked in sync.
 */
export function createMotionAdapter(): RuntimeDeterministicAdapter {
  return {
    name: "motion",

    discover: () => {
      // Motion has no global registry — instances must be manually
      // registered on window.__hfMotion by the composition.
    },

    seek: (ctx) => {
      const timeSec = Math.max(0, Number(ctx.time) || 0);
      const instances = (window as MotionWindow).__hfMotion;
      if (!instances || instances.length === 0) return;

      for (const instance of instances) {
        try {
          if ("time" in instance) {
            (instance as MotionAnimationInstance).time = timeSec;
          }
        } catch {
          // ignore per-instance failures
        }
      }
    },

    pause: () => {
      const instances = (window as MotionWindow).__hfMotion;
      if (!instances || instances.length === 0) return;

      for (const instance of instances) {
        try {
          if (typeof instance.pause === "function") {
            instance.pause();
          }
        } catch {
          // ignore
        }
      }
    },

    play: () => {
      const instances = (window as MotionWindow).__hfMotion;
      if (!instances || instances.length === 0) return;

      for (const instance of instances) {
        try {
          if (typeof instance.play === "function") {
            instance.play();
          }
        } catch {
          // ignore
        }
      }
    },

    revert: () => {
      // Don't clear __hfMotion — instances are owned by the composition.
    },
  };
}

// ── Minimal type shapes (no motion package dependency) ────────────────────────

interface MotionAnimationInstance {
  time: number;
  pause: () => void;
  play: () => void;
  stop?: () => void;
  duration?: number;
}

interface MotionWindow extends Window {
  Motion?: Record<string, unknown>;
  /** Motion animation instances registered by compositions for the adapter to seek. */
  __hfMotion?: MotionAnimationInstance[];
}
