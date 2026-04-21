import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseVideoElements,
  parseImageElements,
  extractAllVideoFrames,
  type VideoElement,
} from "./videoFrameExtractor.js";
import { extractVideoMetadata } from "../utils/ffprobe.js";

describe("parseVideoElements", () => {
  it("parses videos without an id or data-start attribute", () => {
    const videos = parseVideoElements('<video src="clip.mp4"></video>');

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: "hf-video-0",
      src: "clip.mp4",
      start: 0,
      end: Infinity,
      mediaStart: 0,
      hasAudio: false,
    });
  });

  it("preserves explicit ids and derives end from data-duration", () => {
    const videos = parseVideoElements(
      '<video id="hero" src="clip.mp4" data-start="2" data-duration="5" data-media-start="1.5" data-has-audio="true"></video>',
    );

    expect(videos).toHaveLength(1);
    expect(videos[0]).toEqual({
      id: "hero",
      src: "clip.mp4",
      start: 2,
      end: 7,
      mediaStart: 1.5,
      hasAudio: true,
    });
  });
});

describe("parseImageElements", () => {
  it("parses images with data-start and data-duration", () => {
    const images = parseImageElements(
      '<img id="photo" src="hdr-photo.png" data-start="0" data-duration="3" />',
    );

    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      id: "photo",
      src: "hdr-photo.png",
      start: 0,
      end: 3,
    });
  });

  it("generates stable IDs for images without one", () => {
    const images = parseImageElements(
      '<img src="a.png" data-start="0" data-end="2" /><img src="b.png" data-start="1" data-end="4" />',
    );

    expect(images).toHaveLength(2);
    expect(images[0]!.id).toBe("hf-img-0");
    expect(images[1]!.id).toBe("hf-img-1");
  });

  it("defaults start to 0 and end to Infinity when attributes missing", () => {
    const images = parseImageElements('<img src="photo.png" />');

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      src: "photo.png",
      start: 0,
      end: Infinity,
    });
  });

  it("ignores img elements without src", () => {
    const images = parseImageElements('<img data-start="0" data-end="3" />');
    expect(images).toHaveLength(0);
  });

  it("uses data-end over data-duration when both present", () => {
    const images = parseImageElements(
      '<img src="a.png" data-start="1" data-end="5" data-duration="10" />',
    );
    expect(images[0]!.end).toBe(5);
  });
});

// Regression test for the VFR (variable frame rate) freeze bug.
// Screen recordings and phone videos often have irregular timestamps.
// When such inputs hit `extractVideoFramesRange`'s `-ss <start> -i ... -t <dur>
// -vf fps=N` pipeline, the fps filter can emit fewer frames than requested —
// e.g. a 4-second segment at 30fps would produce ~90 frames instead of 120.
// FrameLookupTable.getFrameAtTime then returns null for out-of-range indices
// and the compositor holds the last valid frame, which the user perceives as
// the video freezing. extractAllVideoFrames normalizes VFR sources to CFR
// before extraction to fix this.
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-vfr-test-"));
const VFR_FIXTURE = join(FIXTURE_DIR, "vfr_screen.mp4");

function runFfmpegSync(args: string[]): void {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${r.status}): ${r.stderr.slice(-400)}`);
  }
}

beforeAll(() => {
  // 10s testsrc2 at 60fps, ~40% of frames dropped via select filter and
  // encoded with -vsync vfr so timestamps are irregular. Declared fps 60,
  // actual average ~36 — well over the 10% threshold used by isVFR.
  // The select expression drops four 1-second windows (frames 30-89,
  // 180-239, 330-389, 480-539) to simulate static segments in a screen
  // recording where no pixels changed.
  runFfmpegSync([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:d=10:rate=60",
    "-vf",
    "drawtext=text='n=%{n}':fontsize=24:fontcolor=white:x=10:y=10:box=1:boxcolor=black@0.6," +
      "select='not(between(n,30,89))*not(between(n,180,239))*not(between(n,330,389))*not(between(n,480,539))'",
    "-vsync",
    "vfr",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "600",
    "-keyint_min",
    "600",
    VFR_FIXTURE,
  ]);
}, 30_000);

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("extractAllVideoFrames on a VFR source", () => {
  it("detects the synthesized fixture as VFR", async () => {
    const md = await extractVideoMetadata(VFR_FIXTURE);
    expect(md.isVFR).toBe(true);
  });

  it("produces the expected frame count for a mid-file segment", async () => {
    const outputDir = join(FIXTURE_DIR, "out-mid-segment");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "v1",
      src: VFR_FIXTURE,
      start: 0,
      end: 4,
      mediaStart: 3,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(1);
    const frames = readdirSync(join(outputDir, "v1")).filter((f) => f.endsWith(".jpg"));
    // Expect 120 frames for 4s at 30fps. Allow ±1 for rounding at the
    // boundary; pre-fix behavior produced ~90 frames (a 25% shortfall).
    expect(frames.length).toBeGreaterThanOrEqual(119);
    expect(frames.length).toBeLessThanOrEqual(121);
  }, 60_000);

  it("produces the expected frame count when mediaStart=0 and the full VFR file is used", async () => {
    const outputDir = join(FIXTURE_DIR, "out-full");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "vfull",
      src: VFR_FIXTURE,
      start: 0,
      end: 10,
      mediaStart: 0,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    const frames = readdirSync(join(outputDir, "vfull")).filter((f) => f.endsWith(".jpg"));
    expect(frames.length).toBeGreaterThanOrEqual(299);
    expect(frames.length).toBeLessThanOrEqual(301);
  }, 60_000);
});
