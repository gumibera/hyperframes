import { describe, it, expect } from "vitest";
import { Encoder } from "./encoder.js";

describe("Encoder", () => {
  it("can be constructed with options", () => {
    const encoder = new Encoder({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc1.640028",
      bitrate: 4_000_000,
      format: "mp4",
    });
    expect(encoder).toBeDefined();
  });

  it("throws if sendFrame called before init", () => {
    const encoder = new Encoder({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc1.640028",
      bitrate: 4_000_000,
      format: "mp4",
    });
    expect(() => encoder.sendFrame({} as ImageBitmap, 0, 0)).toThrow("not initialized");
  });

  it("throws if finalize called before init", async () => {
    const encoder = new Encoder({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc1.640028",
      bitrate: 4_000_000,
      format: "mp4",
    });
    await expect(encoder.finalize()).rejects.toThrow("not initialized");
  });
});
