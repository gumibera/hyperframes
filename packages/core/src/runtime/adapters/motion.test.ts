import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMotionAdapter } from "./motion";

const motionWindow = window as Window & {
  __hfMotion?: unknown[];
};

function createMotionInstance(opts?: { duration?: number }) {
  let currentTime = 0;
  return {
    get time() {
      return currentTime;
    },
    set time(t: number) {
      currentTime = t;
    },
    _setTimeSpy: vi.fn((t: number) => {
      currentTime = t;
    }),
    pause: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    duration: opts?.duration ?? 2,
  };
}

function createSeekTracker() {
  const instance = createMotionInstance();
  const proxy = new Proxy(instance, {
    set(target, prop, value) {
      if (prop === "time") {
        target._setTimeSpy(value);
        target.time = value;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  });
  return { instance, proxy };
}

describe("motion adapter", () => {
  beforeEach(() => {
    delete motionWindow.__hfMotion;
  });

  afterEach(() => {
    delete motionWindow.__hfMotion;
  });

  it("has correct name", () => {
    expect(createMotionAdapter().name).toBe("motion");
  });

  describe("discover", () => {
    it("does not throw", () => {
      const adapter = createMotionAdapter();
      expect(() => adapter.discover()).not.toThrow();
    });
  });

  describe("seek", () => {
    it("sets .time in seconds", () => {
      const { instance, proxy } = createSeekTracker();
      motionWindow.__hfMotion = [proxy];
      const adapter = createMotionAdapter();
      adapter.seek({ time: 1.5 });
      expect(instance._setTimeSpy).toHaveBeenCalledWith(1.5);
    });

    it("clamps negative time to 0", () => {
      const { instance, proxy } = createSeekTracker();
      motionWindow.__hfMotion = [proxy];
      const adapter = createMotionAdapter();
      adapter.seek({ time: -3 });
      expect(instance._setTimeSpy).toHaveBeenCalledWith(0);
    });

    it("does nothing with no instances", () => {
      const adapter = createMotionAdapter();
      expect(() => adapter.seek({ time: 1 })).not.toThrow();
    });

    it("seeks multiple instances", () => {
      const a = createSeekTracker();
      const b = createSeekTracker();
      motionWindow.__hfMotion = [a.proxy, b.proxy];
      const adapter = createMotionAdapter();
      adapter.seek({ time: 2.5 });
      expect(a.instance._setTimeSpy).toHaveBeenCalledWith(2.5);
      expect(b.instance._setTimeSpy).toHaveBeenCalledWith(2.5);
    });

    it("continues if one instance throws", () => {
      const bad = {
        get time() {
          return 0;
        },
        set time(_: number) {
          throw new Error("boom");
        },
        pause: vi.fn(),
        play: vi.fn(),
      };
      const good = createSeekTracker();
      motionWindow.__hfMotion = [bad, good.proxy];
      const adapter = createMotionAdapter();
      adapter.seek({ time: 1 });
      expect(good.instance._setTimeSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("pause", () => {
    it("pauses all instances", () => {
      const a = createMotionInstance();
      const b = createMotionInstance();
      motionWindow.__hfMotion = [a, b];
      const adapter = createMotionAdapter();
      adapter.pause();
      expect(a.pause).toHaveBeenCalled();
      expect(b.pause).toHaveBeenCalled();
    });

    it("does nothing with no instances", () => {
      const adapter = createMotionAdapter();
      expect(() => adapter.pause()).not.toThrow();
    });
  });

  describe("play", () => {
    it("plays all instances", () => {
      const a = createMotionInstance();
      motionWindow.__hfMotion = [a];
      const adapter = createMotionAdapter();
      adapter.play!();
      expect(a.play).toHaveBeenCalled();
    });
  });

  describe("revert", () => {
    it("does not throw", () => {
      const adapter = createMotionAdapter();
      expect(() => adapter.revert!()).not.toThrow();
    });
  });
});
