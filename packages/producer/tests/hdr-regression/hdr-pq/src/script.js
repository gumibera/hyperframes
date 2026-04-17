/* Data Drift — five-scene HDR PQ composition.

   Scene visibility / handoff is owned entirely by the
   @hyperframes/shader-transitions package. We build a paused
   timeline of *internal* scene motion only (text reveals, video
   Ken-Burns, HUD drifts) and hand it to HyperShader.init() —
   the library appends the GL transitions and exposes the
   shader metadata on window.__hf.transitions so the HDR engine
   can reproduce each transition in rgb48le pixel space.

   Motion rules: sine.inOut and power2.out only. Nothing snaps,
   everything drifts. */

(function () {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "sine.inOut" } });

  /* ---------- Scene 1 · Intro (0.00 – 1.60) ---------- */
  const introBrow = document.querySelector("#scene-intro .eyebrow");
  const introDisplay = document.querySelector("#scene-intro .display");
  const introFoot = document.querySelector("#scene-intro .colophon");
  if (introBrow && introDisplay && introFoot) {
    tl.from(
      introBrow,
      { y: 18, opacity: 0, duration: 0.85, ease: "power2.out" },
      0.05,
    );
    tl.from(
      introDisplay,
      { y: 36, opacity: 0, filter: "blur(12px)", duration: 1.05, ease: "power2.out" },
      0.22,
    );
    tl.from(
      introFoot,
      { y: 12, opacity: 0, duration: 0.7, ease: "power2.out" },
      0.55,
    );
  }

  /* ---------- Scene 2 · HDR video A (2.10 – 4.00) ----------
     The video starts playing 0.5s after the shader cuts in
     (the lib transitions 1.6 → 2.1) so the scene becomes visible
     just as the first frame plays. Subtle Ken Burns push-in. */
  const vidA = document.getElementById("vid-hdr-1");
  if (vidA) {
    tl.fromTo(
      vidA,
      { scale: 1.07 },
      { scale: 1.0, duration: 1.9, ease: "sine.out" },
      2.1,
    );
  }
  const hudA = document.querySelectorAll("#scene-video-a .hud, #scene-video-a .hud-readout");
  if (hudA.length) {
    tl.from(
      hudA,
      { opacity: 0, y: 8, duration: 0.6, ease: "power2.out", stagger: 0.08 },
      2.25,
    );
  }

  /* ---------- Scene 3 · HDR still (4.50 – 6.20) ----------
     16-bit PNG. Slow horizontal drift to give the still motion. */
  const still = document.getElementById("img-hdr");
  if (still) {
    tl.fromTo(
      still,
      { scale: 1.1, x: -22 },
      { scale: 1.02, x: 16, duration: 1.7, ease: "sine.inOut" },
      4.5,
    );
  }
  const hudB = document.querySelectorAll("#scene-still .hud, #scene-still .hud-readout");
  if (hudB.length) {
    tl.from(
      hudB,
      { opacity: 0, y: 8, duration: 0.55, ease: "power2.out", stagger: 0.08 },
      4.65,
    );
  }

  /* ---------- Scene 4 · HDR video B (6.70 – 8.40) ----------
     Pull-back, opposite Ken Burns. */
  const vidB = document.getElementById("vid-hdr-2");
  if (vidB) {
    tl.fromTo(
      vidB,
      { scale: 1.0 },
      { scale: 1.07, duration: 1.7, ease: "sine.inOut" },
      6.7,
    );
  }
  const hudC = document.querySelectorAll("#scene-video-b .hud, #scene-video-b .hud-readout");
  if (hudC.length) {
    tl.from(
      hudC,
      { opacity: 0, y: 8, duration: 0.55, ease: "power2.out", stagger: 0.08 },
      6.85,
    );
  }

  /* ---------- Scene 5 · Outro (8.90 – 10.00) ---------- */
  const outroBrow = document.querySelector("#scene-outro .eyebrow");
  const outroDisplay = document.querySelector("#scene-outro .display");
  const outroFoot = document.querySelector("#scene-outro .colophon");
  if (outroBrow && outroDisplay && outroFoot) {
    tl.from(
      outroBrow,
      { y: 14, opacity: 0, duration: 0.65, ease: "power2.out" },
      8.95,
    );
    tl.from(
      outroDisplay,
      { y: 28, opacity: 0, filter: "blur(10px)", duration: 0.85, ease: "power2.out" },
      9.05,
    );
    tl.from(
      outroFoot,
      { y: 10, opacity: 0, duration: 0.55, ease: "power2.out" },
      9.45,
    );
  }

  /* ---------- Shader transitions ----------
     init() reads __hf if present (set by the HDR engine), wires
     transitions into the timeline at the requested times, and
     registers the timeline on window.__timelines under the
     compositionId we pass. */
  if (typeof HyperShader !== "undefined" && HyperShader.init) {
    HyperShader.init({
      bgColor: "#0a0a0a",
      accentColor: "#7c3aed",
      compositionId: "main-comp",
      scenes: [
        "scene-intro",
        "scene-video-a",
        "scene-still",
        "scene-video-b",
        "scene-outro",
      ],
      transitions: [
        { time: 1.6, shader: "domain-warp",        duration: 0.5, ease: "sine.inOut" },
        { time: 4.0, shader: "gravitational-lens", duration: 0.5, ease: "sine.inOut" },
        { time: 6.2, shader: "cross-warp-morph",   duration: 0.5, ease: "sine.inOut" },
        { time: 8.4, shader: "domain-warp",        duration: 0.5, ease: "sine.inOut" },
      ],
      timeline: tl,
    });
  }

  /* When init() runs above it registers the timeline for us. If
     HyperShader is unavailable (e.g. CDN miss), fall back to a
     manual registration so the scene-internal motion still
     plays — the engine will then composite scenes as hard cuts. */
  window.__timelines = window.__timelines || {};
  if (!window.__timelines["main-comp"]) {
    window.__timelines["main-comp"] = tl;
  }
})();
