/* hdr-feature-stack — six-scene HDR feature exercise.

   Pattern matches mixed-sdr-hdr: build a paused gsap timeline of
   internal scene motion, then hand it to HyperShader.init() which
   appends the GL transition machinery and registers it on
   window.__timelines under our compositionId. */

(function () {
  var tl = gsap.timeline({ paused: true });

  /* Initial state — every off-screen / faded element is parked at
     opacity:0 so the shader transition cross-dissolves into a clean
     reveal rather than a pre-hydrated layout. Position 0 set()s are
     idempotent and replay correctly when the engine seeks. */
  tl.set("#s1-slate", { opacity: 0, x: -20 }, 0);

  tl.set("#s2-pip", { opacity: 0, scale: 0.92 }, 0);
  tl.set("#s2-headline", { opacity: 0, y: 60 }, 0);
  tl.set("#s2-sub", { opacity: 0, y: 30 }, 0);

  tl.set("#s3-caption", { opacity: 0, y: 30 }, 0);

  tl.set("#s4-circle", { opacity: 0, scale: 0.7 }, 0);
  tl.set("#s4-rounded", { opacity: 0, x: 80 }, 0);

  tl.set("#s5-a", { opacity: 0, y: -40, rotate: -3 }, 0);
  tl.set("#s5-b", { opacity: 0, scale: 0.92 }, 0);
  tl.set("#s5-c", { opacity: 0, y: 40, rotate: 3 }, 0);

  tl.set("#s6-f1", { opacity: 0, x: -120, rotate: -8 }, 0);
  tl.set("#s6-f2", { opacity: 0, scale: 0.7, skewX: 12 }, 0);
  tl.set("#s6-f3", { opacity: 0, y: 80 }, 0);

  /* Scene 1 (0–5s) — solo HUD slate slides in from left. */
  tl.to("#s1-slate", { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.4);

  /* Scene 2 (5–10s) — PiP pop-in, headline + subtitle reveal. */
  tl.to("#s2-pip", { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.4)" }, 5.4);
  tl.to("#s2-headline", { y: 0, opacity: 1, duration: 0.9, ease: "expo.out" }, 5.9);
  tl.to("#s2-sub", { y: 0, opacity: 1, duration: 0.6, ease: "power2.out" }, 6.5);

  /* Scene 3 (10–15s) — caption rises into frame. */
  tl.to("#s3-caption", { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 10.6);

  /* Scene 4 (15–20s) — masked HDR frames enter, then breathe. */
  tl.to("#s4-circle", { scale: 1, opacity: 1, duration: 0.8, ease: "back.out(1.3)" }, 15.5);
  tl.to("#s4-rounded", { x: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 15.9);
  tl.to(
    "#s4-circle",
    { rotate: 6, duration: 3.5, ease: "sine.inOut", yoyo: true, repeat: 1 },
    16.5,
  );

  /* Scene 5 (20–25s) — three layered framed videos enter staggered. */
  tl.to("#s5-a", { y: 0, rotate: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 20.5);
  tl.to("#s5-b", { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.2)" }, 20.85);
  tl.to("#s5-c", { y: 0, rotate: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 21.2);

  /* Scene 6 (25–30s) — three framed clips. Each enters with an opacity
     fade-in (0→1) plus a transform from off-state, then loops a transform
     yoyo. Earlier scenes already exercise the opacity-yoyo path; this
     scene focuses on transforms over a white field so motion is legible. */
  tl.to("#s6-f1", { x: 0, rotate: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 25.5);
  tl.to("#s6-f2", { scale: 1, skewX: 0, opacity: 1, duration: 0.8, ease: "back.out(1.3)" }, 25.8);
  tl.to("#s6-f3", { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 26.1);
  tl.to(
    "#s6-f1",
    { x: -30, rotate: -4, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: 1 },
    26.6,
  );
  tl.to(
    "#s6-f2",
    { scale: 1.08, skewX: -6, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: 1 },
    26.6,
  );
  tl.to(
    "#s6-f3",
    { y: -40, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: 1 },
    26.6,
  );

  /* Hand the timeline to HyperShader so it appends GL transitions
     onto our existing gsap.timeline rather than creating its own.
     This is the same handoff used by the mixed-sdr-hdr fixture and
     is the only init pattern that keeps the engine's seek-driven
     shader transitions in sync with our internal scene motion. */
  if (typeof HyperShader !== "undefined" && HyperShader.init) {
    HyperShader.init({
      compositionId: "main",
      bgColor: "#050507",
      scenes: ["scene-1", "scene-2", "scene-3", "scene-4", "scene-5", "scene-6"],
      transitions: [
        { time: 4.6, duration: 0.4, shader: "domain-warp" },
        { time: 9.6, duration: 0.4, shader: "cross-warp-morph" },
        { time: 14.6, duration: 0.4, shader: "flash-through-white" },
        { time: 19.6, duration: 0.4, shader: "gravitational-lens" },
        { time: 24.6, duration: 0.4, shader: "domain-warp" },
      ],
      timeline: tl,
    });
  }

  /* When init() is given a custom timeline it intentionally skips
     auto-registration on window.__timelines — registration only
     happens when the library owns the timeline. So we register here
     ourselves; this also covers the fallback path where HyperShader
     fails to load (CDN miss). */
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
