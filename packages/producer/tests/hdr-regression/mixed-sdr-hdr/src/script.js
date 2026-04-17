/* Shadow Cut — six-scene mixed-transfer composition.

   Scene visibility / handoffs are owned entirely by the
   @hyperframes/shader-transitions library (Domain Warp on every
   cut, per the Shadow Cut style guide). We build a paused
   timeline of *internal* scene motion only — slow creeping
   push-ins, classification text reveals, dramatic bottom-up
   case-label entrances — and hand it to HyperShader.init().

   The library appends GL transitions and exposes the shader
   metadata on window.__hf.transitions so the HDR engine can
   reproduce each Domain Warp transition in rgb48le pixel
   space, cross-converting any SDR → PQ or HDR → BT.709 as the
   render target requires.

   Motion rules (Shadow Cut): power3.out for reveals, power4.in
   for exits. The pause before the hit matters. Nothing bouncy. */

(function () {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });

  /* ---------- Scene 1 · Intro (0.00 – 1.40) ---------- */
  const introClass = document.querySelector("#scene-intro .classification");
  const introDisplay = document.querySelector("#scene-intro .display");
  const introSub = document.querySelector("#scene-intro .subdisplay");
  const introFoot = document.querySelector("#scene-intro .colophon");
  if (introClass && introDisplay && introSub && introFoot) {
    tl.from(
      introClass,
      { y: 12, opacity: 0, duration: 0.6, ease: "power3.out" },
      0.05,
    );
    tl.from(
      introDisplay,
      { y: 30, opacity: 0, scale: 1.04, duration: 0.85, ease: "power3.out" },
      0.18,
    );
    tl.from(
      introSub,
      { y: 10, opacity: 0, duration: 0.55, ease: "power3.out" },
      0.55,
    );
    tl.from(
      introFoot,
      { y: 8, opacity: 0, duration: 0.5, ease: "power3.out" },
      0.78,
    );
  }

  /* ---------- Scene 2 · SDR video A (1.85 – 3.20) ----------
     Slow creeping push-in. The cross-transfer happens inside
     the engine when it composites this scene's frames into the
     PQ working space (or leaves them as-is for SDR output). */
  const vidSdr = document.getElementById("vid-sdr");
  if (vidSdr) {
    tl.fromTo(
      vidSdr,
      { scale: 1.08 },
      { scale: 1.0, duration: 1.35, ease: "power3.out" },
      1.85,
    );
  }
  const evSdr = document.querySelectorAll(
    "#scene-sdr-vid .evidence, #scene-sdr-vid .case-label",
  );
  if (evSdr.length) {
    tl.from(
      evSdr,
      { opacity: 0, y: 8, duration: 0.5, ease: "power3.out", stagger: 0.07 },
      2.0,
    );
  }
  const ticksSdr = document.querySelectorAll("#scene-sdr-vid .corner-tick");
  if (ticksSdr.length) {
    tl.from(
      ticksSdr,
      { opacity: 0, scale: 0.6, duration: 0.4, ease: "power3.out", stagger: 0.04 },
      1.95,
    );
  }

  /* ---------- Scene 3 · HDR video A (3.65 – 5.00) ----------
     Pull-back rather than push-in to vary the rhythm. Native
     PQ source — the engine reads this with its 10-bit reader. */
  const vidHdr = document.getElementById("vid-hdr");
  if (vidHdr) {
    tl.fromTo(
      vidHdr,
      { scale: 1.0 },
      { scale: 1.06, duration: 1.35, ease: "power3.out" },
      3.65,
    );
  }
  const evHdr = document.querySelectorAll(
    "#scene-hdr-vid .evidence, #scene-hdr-vid .case-label",
  );
  if (evHdr.length) {
    tl.from(
      evHdr,
      { opacity: 0, y: 8, duration: 0.5, ease: "power3.out", stagger: 0.07 },
      3.8,
    );
  }
  const ticksHdr = document.querySelectorAll("#scene-hdr-vid .corner-tick");
  if (ticksHdr.length) {
    tl.from(
      ticksHdr,
      { opacity: 0, scale: 0.6, duration: 0.4, ease: "power3.out", stagger: 0.04 },
      3.75,
    );
  }

  /* ---------- Scene 4 · SDR still (5.45 – 6.50) ----------
     Slow horizontal drift to give the still life. */
  const stillSdr = document.getElementById("img-sdr");
  if (stillSdr) {
    tl.fromTo(
      stillSdr,
      { scale: 1.1, x: -22 },
      { scale: 1.04, x: 14, duration: 1.05, ease: "power3.out" },
      5.45,
    );
  }
  const evStillSdr = document.querySelectorAll(
    "#scene-sdr-still .evidence, #scene-sdr-still .case-label",
  );
  if (evStillSdr.length) {
    tl.from(
      evStillSdr,
      { opacity: 0, y: 8, duration: 0.45, ease: "power3.out", stagger: 0.07 },
      5.55,
    );
  }
  const ticksStillSdr = document.querySelectorAll(
    "#scene-sdr-still .corner-tick",
  );
  if (ticksStillSdr.length) {
    tl.from(
      ticksStillSdr,
      { opacity: 0, scale: 0.6, duration: 0.35, ease: "power3.out", stagger: 0.04 },
      5.5,
    );
  }

  /* ---------- Scene 5 · HDR still (6.95 – 8.00) ----------
     Counter-direction drift so the rhythm doesn't feel mechanical. */
  const stillHdr = document.getElementById("img-hdr");
  if (stillHdr) {
    tl.fromTo(
      stillHdr,
      { scale: 1.04, x: 18 },
      { scale: 1.1, x: -18, duration: 1.05, ease: "power3.out" },
      6.95,
    );
  }
  const evStillHdr = document.querySelectorAll(
    "#scene-hdr-still .evidence, #scene-hdr-still .case-label",
  );
  if (evStillHdr.length) {
    tl.from(
      evStillHdr,
      { opacity: 0, y: 8, duration: 0.45, ease: "power3.out", stagger: 0.07 },
      7.05,
    );
  }
  const ticksStillHdr = document.querySelectorAll(
    "#scene-hdr-still .corner-tick",
  );
  if (ticksStillHdr.length) {
    tl.from(
      ticksStillHdr,
      { opacity: 0, scale: 0.6, duration: 0.35, ease: "power3.out", stagger: 0.04 },
      7.0,
    );
  }

  /* ---------- Scene 6 · Outro (8.45 – 10.00) ---------- */
  const outroClass = document.querySelector("#scene-outro .classification");
  const outroDisplay = document.querySelector("#scene-outro .display");
  const outroSub = document.querySelector("#scene-outro .subdisplay");
  const outroFoot = document.querySelector("#scene-outro .colophon");
  if (outroClass && outroDisplay && outroSub && outroFoot) {
    tl.from(
      outroClass,
      { y: 12, opacity: 0, duration: 0.55, ease: "power3.out" },
      8.5,
    );
    tl.from(
      outroDisplay,
      { y: 28, opacity: 0, scale: 1.04, duration: 0.85, ease: "power3.out" },
      8.62,
    );
    tl.from(
      outroSub,
      { y: 10, opacity: 0, duration: 0.55, ease: "power3.out" },
      9.0,
    );
    tl.from(
      outroFoot,
      { y: 8, opacity: 0, duration: 0.5, ease: "power3.out" },
      9.25,
    );
  }

  /* ---------- Shader transitions ----------
     Domain Warp on every handoff (Shadow Cut style guide).
     init() reads __hf if present (set by the HDR engine), wires
     transitions into the timeline at the requested times, and
     registers the timeline on window.__timelines under the
     compositionId we pass.

     Transition layout (5 cuts, 0.45s each):
        1.40 → 1.85: intro      → sdr-vid
        3.20 → 3.65: sdr-vid    → hdr-vid    (BT.709 → PQ jump)
        5.00 → 5.45: hdr-vid    → sdr-still  (PQ → BT.709 jump)
        6.50 → 6.95: sdr-still  → hdr-still  (BT.709 → PQ jump)
        8.00 → 8.45: hdr-still  → outro
  */
  if (typeof HyperShader !== "undefined" && HyperShader.init) {
    HyperShader.init({
      bgColor: "#0a0a0a",
      accentColor: "#C1121F",
      compositionId: "main-comp",
      scenes: [
        "scene-intro",
        "scene-sdr-vid",
        "scene-hdr-vid",
        "scene-sdr-still",
        "scene-hdr-still",
        "scene-outro",
      ],
      transitions: [
        { time: 1.4, shader: "domain-warp", duration: 0.45, ease: "power3.out" },
        { time: 3.2, shader: "domain-warp", duration: 0.45, ease: "power3.out" },
        { time: 5.0, shader: "domain-warp", duration: 0.45, ease: "power3.out" },
        { time: 6.5, shader: "domain-warp", duration: 0.45, ease: "power3.out" },
        { time: 8.0, shader: "domain-warp", duration: 0.45, ease: "power3.out" },
      ],
      timeline: tl,
    });
  }

  /* When init() runs above with a custom timeline it does NOT
     auto-register on window.__timelines — registration only
     happens when the library owns the timeline. So we always
     register the timeline ourselves; this also covers the
     fallback case where HyperShader is unavailable (CDN miss),
     in which case the engine renders scenes as hard cuts but
     internal scene motion still plays. */
  window.__timelines = window.__timelines || {};
  window.__timelines["main-comp"] = tl;
})();
