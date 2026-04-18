import { describe, expect, it } from "vitest";
import { parseVideoElements, parseImageElements } from "./videoFrameExtractor.js";

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
  it("parses img elements with data-start and data-duration", () => {
    const html = `<div><img id="i1" src="photo.jpg" data-start="2" data-duration="5" /></div>`;
    const images = parseImageElements(html);
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({ id: "i1", src: "photo.jpg", start: 2, end: 7 });
  });

  it("skips img without data-duration", () => {
    const html = `<div><img id="i1" src="photo.jpg" data-start="0" /></div>`;
    const images = parseImageElements(html);
    expect(images).toHaveLength(0);
  });

  it("generates stable IDs for img without id attribute", () => {
    const html = `<div><img src="a.jpg" data-start="0" data-duration="3" /><img src="b.jpg" data-start="1" data-duration="2" /></div>`;
    const images = parseImageElements(html);
    expect(images).toHaveLength(2);
    expect(images[0].id).toBe("hf-img-0");
    expect(images[1].id).toBe("hf-img-1");
  });

  it("returns an empty array when no <img> elements are present", () => {
    expect(parseImageElements("<div></div>")).toEqual([]);
    expect(parseImageElements('<div><video src="clip.mp4"></video></div>')).toEqual([]);
  });

  it("skips images with non-positive or non-finite data-duration", () => {
    const html = `
      <img id="zero" src="a.jpg" data-start="0" data-duration="0" />
      <img id="neg" src="b.jpg" data-start="0" data-duration="-2" />
      <img id="nan" src="c.jpg" data-start="0" data-duration="not-a-number" />
      <img id="inf" src="d.jpg" data-start="0" data-duration="Infinity" />
    `;
    expect(parseImageElements(html)).toEqual([]);
  });

  it("defaults data-start to 0 when missing", () => {
    const html = `<img id="i1" src="a.jpg" data-duration="4" />`;
    const images = parseImageElements(html);
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({ id: "i1", src: "a.jpg", start: 0, end: 4 });
  });

  it("preserves duplicate ids (current behavior — caller is responsible for uniqueness)", () => {
    const html = `
      <img id="dup" src="a.jpg" data-start="0" data-duration="2" />
      <img id="dup" src="b.jpg" data-start="3" data-duration="2" />
    `;
    const images = parseImageElements(html);
    expect(images).toHaveLength(2);
    expect(images.map((i) => i.id)).toEqual(["dup", "dup"]);
  });
});
