// Browser-side layout-overlap audit.
// Loaded as raw string and injected via page.addScriptTag. Sibling of contrast-audit.browser.js.
//
// Approach:
//   1. Walk the DOM, collect "layout-relevant" elements at this moment.
//   2. Pairwise bbox intersection among same-stacking-context peers.
//   3. Flag intersections above a threshold as `unintentional_overlap` findings.
//
// Layout-relevant heuristic:
//   - Leaf text elements with own non-whitespace text >= 2 chars
//   - <img>, root <svg>, <canvas>, <video> with rendered size >= 20x20
//   - Skip: opacity < 0.10, display none, visibility hidden, pointer-events none,
//           class names containing ghost/glow/grain/vignette/scrim/backdrop/overlay-grain,
//           descendants of <svg> (only root svg counts)

/* eslint-disable */
window.__layoutAudit = function (time) {
  function selectorOf(el) {
    if (el.id) return "#" + el.id;
    var cls = Array.from(el.classList || [])
      .slice(0, 2)
      .join(".");
    return cls ? el.tagName.toLowerCase() + "." + cls : el.tagName.toLowerCase();
  }

  function isDecorativeClass(cls) {
    if (!cls) return false;
    return /\b(ghost|glow|grain|noise|vignette|scrim|backdrop|overlay-grain|radial-glow|halo|bg-|background-)/i.test(
      cls,
    );
  }

  function ownText(el) {
    var t = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.nodeValue;
    }
    return t.trim();
  }

  function hasElementChild(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 1) return true;
    }
    return false;
  }

  function isInsideSvg(el) {
    var p = el.parentElement;
    while (p) {
      if (p.tagName && p.tagName.toLowerCase() === "svg") return true;
      p = p.parentElement;
    }
    return false;
  }

  function effectiveOpacity(el) {
    // Walk up the tree; any ancestor with opacity 0 (or visibility hidden / display none)
    // makes this element invisible regardless of its own style.
    var o = 1;
    var node = el;
    while (node && node.nodeType === 1) {
      var s = getComputedStyle(node);
      if (s.display === "none" || s.visibility === "hidden") return 0;
      var op = parseFloat(s.opacity || "1");
      if (!isNaN(op)) o *= op;
      if (o < 0.01) return 0;
      node = node.parentElement;
    }
    return o;
  }

  function isVisible(el, style, rect) {
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (effectiveOpacity(el) < 0.1) return false;
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.right < 0 || rect.left > 1920) return false;
    if (rect.bottom < 0 || rect.top > 1080) return false;
    return true;
  }

  function effectiveZIndex(el) {
    // Walk up, accumulate stacking-context-forming ancestors with non-auto z-index.
    // For our pairwise test we just need a single value per element.
    var node = el;
    while (node && node.nodeType === 1) {
      var s = getComputedStyle(node);
      var z = s.zIndex;
      if (z !== "auto" && z !== "") {
        var n = parseInt(z, 10);
        if (!isNaN(n)) return n;
      }
      node = node.parentElement;
    }
    return 0;
  }

  function intersect(a, b) {
    var x = Math.max(a.left, b.left);
    var y = Math.max(a.top, b.top);
    var r = Math.min(a.right, b.right);
    var btm = Math.min(a.bottom, b.bottom);
    if (r <= x || btm <= y) return null;
    return { x: x, y: y, width: r - x, height: btm - y };
  }

  var candidates = [];
  var all = document.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var style = getComputedStyle(el);
    var rect = el.getBoundingClientRect();

    if (!isVisible(el, style, rect)) continue;
    if (style.pointerEvents === "none" && !el.matches("img, svg, canvas, video")) continue;

    var classList =
      el.className && el.className.baseVal != null ? el.className.baseVal : el.className || "";
    if (isDecorativeClass(classList)) continue;

    // Skip SVG descendants — only the root <svg> participates
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag !== "svg" && isInsideSvg(el)) continue;

    var isMedia = tag === "img" || tag === "svg" || tag === "canvas" || tag === "video";
    var text = ownText(el);
    var isTextLeaf = text.length >= 2 && !hasElementChild(el);

    if (!isMedia && !isTextLeaf) continue;

    if (isMedia && (rect.width < 20 || rect.height < 20)) continue;

    candidates.push({
      el: el,
      selector: selectorOf(el),
      rect: rect,
      zIndex: effectiveZIndex(el),
      text: isTextLeaf ? text.substring(0, 48) : null,
      kind: isMedia ? "media" : "text",
    });
  }

  var findings = [];
  for (var a = 0; a < candidates.length; a++) {
    for (var b = a + 1; b < candidates.length; b++) {
      var A = candidates[a];
      var B = candidates[b];

      // Skip ancestor-descendant
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;

      // Skip different stacking levels (intentional layering)
      if (A.zIndex !== B.zIndex) continue;

      var ov = intersect(A.rect, B.rect);
      if (!ov) continue;

      var aArea = A.rect.width * A.rect.height;
      var bArea = B.rect.width * B.rect.height;
      var minArea = Math.min(aArea, bArea);
      var ovArea = ov.width * ov.height;
      var pct = minArea > 0 ? ovArea / minArea : 0;

      if (pct < 0.2) continue;

      findings.push({
        time: time,
        code: "unintentional_overlap",
        severity: "warning",
        a: A.selector,
        b: B.selector,
        textA: A.text,
        textB: B.text,
        kindA: A.kind,
        kindB: B.kind,
        overlapPct: Math.round(pct * 100),
        overlapArea: Math.round(ovArea),
      });
    }
  }

  return findings;
};
