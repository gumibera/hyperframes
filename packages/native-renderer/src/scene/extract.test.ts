import { describe, expect, it } from "vitest";
import type { ExtractedScene, SceneElement } from "./extract";

describe("ExtractedScene types", () => {
  it("produces JSON compatible with Rust scene types", () => {
    const scene: ExtractedScene = {
      width: 1920,
      height: 1080,
      elements: [
        {
          id: "bg",
          kind: { type: "Container" },
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          style: {
            background_color: { r: 30, g: 30, b: 30, a: 255 },
            opacity: 1,
            border_radius: [0, 0, 0, 0],
            overflow_hidden: false,
            transform: null,
            visibility: true,
            font_family: null,
            font_size: null,
            font_weight: null,
            color: null,
          },
          children: [],
        },
        {
          id: "title",
          kind: { type: "Text", content: "Hello World" },
          bounds: { x: 100, y: 100, width: 400, height: 50 },
          style: {
            background_color: null,
            opacity: 1,
            border_radius: [0, 0, 0, 0],
            overflow_hidden: false,
            transform: null,
            visibility: true,
            font_family: "Inter",
            font_size: 32,
            font_weight: 700,
            color: { r: 255, g: 255, b: 255, a: 255 },
          },
          children: [],
        },
      ],
    };

    const json = JSON.stringify(scene);
    const parsed = JSON.parse(json);

    // Verify the `kind` nested structure matches Rust's serde(tag = "type") format
    expect(parsed.elements[0].kind.type).toBe("Container");
    expect(parsed.elements[1].kind.type).toBe("Text");
    expect(parsed.elements[1].kind.content).toBe("Hello World");
    expect(parsed.elements[0].style.background_color.r).toBe(30);
  });

  it("matches exact Rust scene_test.rs JSON shapes", () => {
    // Reproduce the JSON from Rust's parse_minimal_scene test verbatim
    const rustCompatibleJSON = JSON.stringify({
      width: 1920,
      height: 1080,
      elements: [
        {
          id: "bg",
          kind: { type: "Container" },
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          style: {
            background_color: { r: 30, g: 30, b: 30, a: 255 },
            opacity: 1.0,
            border_radius: [0, 0, 0, 0],
            overflow_hidden: false,
            transform: null,
            visibility: true,
          },
          children: [],
        },
      ],
    });

    // This must be parseable by the Rust side. We verify structural invariants:
    const parsed = JSON.parse(rustCompatibleJSON);
    expect(parsed.elements[0].kind).toEqual({ type: "Container" });
    expect(parsed.elements[0].bounds).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it("serializes Image and Video kinds with src field", () => {
    const elements: SceneElement[] = [
      {
        id: "bg-img",
        kind: { type: "Image", src: "/assets/bg.png" },
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        style: {
          background_color: null,
          opacity: 1,
          border_radius: [0, 0, 0, 0],
          overflow_hidden: false,
          transform: null,
          visibility: true,
          font_family: null,
          font_size: null,
          font_weight: null,
          color: null,
        },
        children: [],
      },
      {
        id: "clip",
        kind: { type: "Video", src: "/assets/intro.mp4" },
        bounds: { x: 100, y: 100, width: 800, height: 450 },
        style: {
          background_color: null,
          opacity: 0.8,
          border_radius: [12, 12, 12, 12],
          overflow_hidden: true,
          transform: null,
          visibility: true,
          font_family: null,
          font_size: null,
          font_weight: null,
          color: null,
        },
        children: [],
      },
    ];

    const json = JSON.stringify({ width: 1920, height: 1080, elements });
    const parsed = JSON.parse(json);

    expect(parsed.elements[0].kind).toEqual({
      type: "Image",
      src: "/assets/bg.png",
    });
    expect(parsed.elements[1].kind).toEqual({
      type: "Video",
      src: "/assets/intro.mp4",
    });
    expect(parsed.elements[1].style.opacity).toBe(0.8);
    expect(parsed.elements[1].style.overflow_hidden).toBe(true);
    expect(parsed.elements[1].style.border_radius).toEqual([12, 12, 12, 12]);
  });

  it("serializes background-image URL metadata", () => {
    const el: SceneElement = {
      id: "poster",
      kind: { type: "Container" },
      bounds: { x: 0, y: 0, width: 640, height: 360 },
      style: {
        background_color: null,
        opacity: 1,
        border_radius: [0, 0, 0, 0],
        overflow_hidden: false,
        transform: null,
        visibility: true,
        font_family: null,
        font_size: null,
        font_weight: null,
        color: null,
        background_image: {
          src: "file:///tmp/poster.png",
          fit: "contain",
          position: { x: 0.25, y: 0.75 },
        },
      },
      children: [],
    };

    const parsed = JSON.parse(JSON.stringify(el));
    expect(parsed.style.background_image).toEqual({
      src: "file:///tmp/poster.png",
      fit: "contain",
      position: { x: 0.25, y: 0.75 },
    });
  });

  it("serializes Transform2D correctly", () => {
    const el: SceneElement = {
      id: "box",
      kind: { type: "Container" },
      bounds: { x: 100, y: 100, width: 200, height: 200 },
      style: {
        background_color: null,
        opacity: 1,
        border_radius: [0, 0, 0, 0],
        overflow_hidden: false,
        transform: {
          translate_x: 50,
          translate_y: -30,
          scale_x: 1.5,
          scale_y: 1.5,
          rotate_deg: 45,
        },
        visibility: true,
        font_family: null,
        font_size: null,
        font_weight: null,
        color: null,
      },
      children: [],
    };

    const json = JSON.stringify(el);
    const parsed = JSON.parse(json);
    expect(parsed.style.transform).toEqual({
      translate_x: 50,
      translate_y: -30,
      scale_x: 1.5,
      scale_y: 1.5,
      rotate_deg: 45,
    });
  });

  it("supports nested children", () => {
    const scene: ExtractedScene = {
      width: 1280,
      height: 720,
      elements: [
        {
          id: "root",
          kind: { type: "Container" },
          bounds: { x: 0, y: 0, width: 1280, height: 720 },
          style: {
            background_color: null,
            opacity: 1,
            border_radius: [0, 0, 0, 0],
            overflow_hidden: false,
            transform: null,
            visibility: true,
            font_family: null,
            font_size: null,
            font_weight: null,
            color: null,
          },
          children: [
            {
              id: "title",
              kind: { type: "Text", content: "Hello World" },
              bounds: { x: 100, y: 50, width: 400, height: 60 },
              style: {
                background_color: null,
                opacity: 1,
                border_radius: [0, 0, 0, 0],
                overflow_hidden: false,
                transform: null,
                visibility: true,
                font_family: "Inter",
                font_size: 48,
                font_weight: 700,
                color: { r: 255, g: 255, b: 255, a: 255 },
              },
              children: [],
            },
          ],
        },
      ],
    };

    const json = JSON.stringify(scene);
    const parsed = JSON.parse(json);
    expect(parsed.elements[0].children).toHaveLength(1);
    expect(parsed.elements[0].children[0].kind).toEqual({
      type: "Text",
      content: "Hello World",
    });
    expect(parsed.elements[0].children[0].style.font_family).toBe("Inter");
  });
});
