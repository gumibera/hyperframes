/* opacity-mixed-fade — single 6s scene with one HDR video and one SDR
   video side-by-side. Both wrapper divs run an IDENTICAL animation that
   exercises BOTH problematic patterns:

     1. tl.set at t=0  → opacity:0                              (hidden)
     2. tl.to at t=1   → opacity:1            (entry fade-in, 0.7s)
     3. tl.to at t=2   → opacity:0.15, yoyo+repeat 1            (1.5s out / 1.5s back)

   Phase 2 verifies the entry-fade case (the one that showed up as a bug
   in hdr-feature-stack scene 6 — SDR clips were visible at opacity 0
   before the fix).

   Phase 3 verifies the opacity-yoyo case (continuous fade in/out via
   GSAP yoyo+repeat). This was the user's original suspected bug.

   Both phases share the same root path through the engine: GSAP writes
   to wrapper.style.opacity → engine must respect it for both the HDR
   compositor path (getEffectiveOpacity walks the wrapper) AND the SDR
   DOM-injection path (img inherits wrapper's CSS opacity). Any
   divergence between HDR (left) and SDR (right) at the same timestamp
   reveals a bug in the SDR pipeline. */

(function () {
  var tl = gsap.timeline({ paused: true });

  tl.set(["#frame-hdr", "#frame-sdr"], { opacity: 0 }, 0);
  tl.to(["#frame-hdr", "#frame-sdr"], { opacity: 1, duration: 0.7, ease: "power3.out" }, 1);
  tl.to(
    ["#frame-hdr", "#frame-sdr"],
    { opacity: 0.15, duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: 1 },
    2,
  );

  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
