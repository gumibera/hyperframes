/* Velvet Standard — six-scene SDR baseline.
   Motion rules: sine.inOut for all morphs, power1.out for entrances,
   long sustains, slow cross-warp morphs. No bouncing, no overshoot. */

(function () {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "sine.inOut" } });

  /* The whole comp is 10s. Six scenes, each with a slow Velvet handoff:
       0.00 – 1.60   intro card        (1.60s on screen, 0.45s morph)
       1.60 – 4.00   sdr video A       (2.40s)
       4.00 – 5.80   sdr still         (1.80s)
       5.80 – 8.00   sdr video B       (2.20s)
       8.00 – 10.00  outro card        (2.00s)
   */

  const FADE = 0.55;

  const scenes = [
    { id: "scene-intro", in: 0.0, out: 1.6 },
    { id: "scene-video-a", in: 1.6, out: 4.0 },
    { id: "scene-still", in: 4.0, out: 5.8 },
    { id: "scene-video-b", in: 5.8, out: 8.0 },
    { id: "scene-outro", in: 8.0, out: 10.0 },
  ];

  scenes.forEach((s) => {
    const el = document.getElementById(s.id);

    tl.fromTo(
      el,
      { opacity: 0, scale: 1.04, filter: "blur(8px) brightness(0.85)" },
      {
        opacity: 1,
        scale: 1.0,
        filter: "blur(0px) brightness(1)",
        duration: FADE,
        ease: "power1.out",
      },
      s.in,
    );

    if (s.out < 10.0) {
      tl.to(
        el,
        {
          opacity: 0,
          scale: 0.985,
          filter: "blur(6px) brightness(0.92)",
          duration: FADE,
          ease: "sine.inOut",
        },
        s.out - FADE,
      );
    }
  });

  /* ----- Inner motion per scene ----- */

  // Intro: serif headline glides up + gold rule sweeps in
  const introCard = document.querySelector("#scene-intro .display");
  const introBrow = document.querySelector("#scene-intro .eyebrow");
  if (introCard && introBrow) {
    tl.from(introBrow, { y: 14, opacity: 0, duration: 0.7, ease: "power1.out" }, 0.05);
    tl.from(introCard, { y: 26, opacity: 0, duration: 0.95, ease: "power1.out" }, 0.18);
  }

  // SDR Video A: subtle Ken Burns push-in
  const vidA = document.getElementById("vid-sdr-1");
  if (vidA) {
    tl.fromTo(
      vidA,
      { scale: 1.06 },
      { scale: 1.0, duration: 2.4, ease: "sine.out" },
      1.6,
    );
  }

  // Still: slow horizontal drift to give photo motion
  const still = document.getElementById("img-sdr");
  if (still) {
    tl.fromTo(
      still,
      { scale: 1.08, x: -20 },
      { scale: 1.02, x: 18, duration: 1.8, ease: "sine.inOut" },
      4.0,
    );
  }

  // SDR Video B: pull-back, opposite Ken Burns
  const vidB = document.getElementById("vid-sdr-2");
  if (vidB) {
    tl.fromTo(
      vidB,
      { scale: 1.0 },
      { scale: 1.06, duration: 2.2, ease: "sine.inOut" },
      5.8,
    );
  }

  // Outro: gold rule sweeps in, headline lifts
  const outroDisplay = document.querySelector("#scene-outro .display");
  const outroBrow = document.querySelector("#scene-outro .eyebrow");
  const outroFoot = document.querySelector("#scene-outro .colophon");
  if (outroDisplay && outroBrow && outroFoot) {
    tl.from(outroBrow, { y: 12, opacity: 0, duration: 0.7, ease: "power1.out" }, 8.05);
    tl.from(outroDisplay, { y: 20, opacity: 0, duration: 0.85, ease: "power1.out" }, 8.18);
    tl.from(outroFoot, { y: 8, opacity: 0, duration: 0.6, ease: "power1.out" }, 8.55);
  }

  window.__timelines = window.__timelines || {};
  window.__timelines["main-comp"] = tl;
})();
