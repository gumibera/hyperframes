# Shader Transition Setup

Complete boilerplate for WebGL shader transitions in HyperFrames. Read this when implementing a shader transition — copy the setup code, then plug in the fragment shader from the catalog.

## HTML

```html
<canvas
  id="gl-canvas"
  width="1920"
  height="1080"
  style="position:absolute;top:0;left:0;width:1920px;height:1080px;z-index:100;pointer-events:none;display:none;"
>
</canvas>
```

## WebGL Init + Scene Capture

Handles images, video, shapes, and text. Supports `object-fit: cover` on images and live video re-upload during transitions.

```js
var sceneTextures = {};
var sceneHasVideo = {}; // tracks which scenes have live video
var glCanvas = document.getElementById("gl-canvas");
var gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });
gl.viewport(0, 0, 1920, 1080);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

// Wait for all media to load before capturing
function waitForMedia() {
  return new Promise(function (resolve) {
    var promises = [];
    document.querySelectorAll("img").forEach(function (img) {
      if (!img.complete)
        promises.push(
          new Promise(function (r) {
            img.onload = r;
            img.onerror = r;
          }),
        );
    });
    document.querySelectorAll("video").forEach(function (vid) {
      if (vid.readyState < 2)
        promises.push(
          new Promise(function (r) {
            vid.addEventListener("loadeddata", r, { once: true });
          }),
        );
    });
    Promise.all(promises).then(resolve);
  });
}

function captureScene(sceneId) {
  return new Promise(function (resolve) {
    var scene = document.getElementById(sceneId);
    var origOpacity = scene.style.opacity;
    var origZ = scene.style.zIndex;
    scene.style.opacity = "1";
    scene.style.zIndex = "999";

    if (scene.querySelector("video")) sceneHasVideo[sceneId] = scene.querySelector("video");

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var c = document.createElement("canvas");
        c.width = 1920;
        c.height = 1080;
        var ctx = c.getContext("2d");

        ctx.fillStyle = window.getComputedStyle(scene).backgroundColor;
        ctx.fillRect(0, 0, 1920, 1080);

        var sr = scene.getBoundingClientRect();
        var els = scene.querySelectorAll("*");
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          var r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          var x = r.left - sr.left,
            y = r.top - sr.top,
            w = r.width,
            h = r.height;

          ctx.save();
          ctx.globalAlpha = parseFloat(cs.opacity) || 1;

          // <img> elements (with object-fit: cover support)
          if (el.tagName === "IMG" && el.complete && el.naturalWidth > 0) {
            try {
              if (cs.objectFit === "cover") {
                var iR = el.naturalWidth / el.naturalHeight,
                  bR = w / h;
                var sx = 0,
                  sy = 0,
                  sw = el.naturalWidth,
                  sh = el.naturalHeight;
                if (iR > bR) {
                  sw = sh * bR;
                  sx = (el.naturalWidth - sw) / 2;
                } else {
                  sh = sw / bR;
                  sy = (el.naturalHeight - sh) / 2;
                }
                ctx.drawImage(el, sx, sy, sw, sh, x, y, w, h);
              } else {
                ctx.drawImage(el, x, y, w, h);
              }
            } catch (e) {}
            ctx.restore();
            continue;
          }

          // <video> elements (grabs current frame)
          if (el.tagName === "VIDEO" && el.readyState >= 2) {
            try {
              var vR = el.videoWidth / el.videoHeight,
                bR2 = w / h;
              var vx = 0,
                vy = 0,
                vw = el.videoWidth,
                vh = el.videoHeight;
              if (vR > bR2) {
                vw = vh * bR2;
                vx = (el.videoWidth - vw) / 2;
              } else {
                vh = vw / bR2;
                vy = (el.videoHeight - vh) / 2;
              }
              ctx.drawImage(el, vx, vy, vw, vh, x, y, w, h);
            } catch (e) {}
            ctx.restore();
            continue;
          }

          // Background color
          var bg = cs.backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
            ctx.fillStyle = bg;
            var br = parseInt(cs.borderRadius) || 0;
            if (br >= Math.min(w, h) / 2 - 1 && Math.abs(w - h) < 4) {
              ctx.beginPath();
              ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
              ctx.fill();
            } else if (br > 0) {
              ctx.beginPath();
              ctx.moveTo(x + br, y);
              ctx.arcTo(x + w, y, x + w, y + h, br);
              ctx.arcTo(x + w, y + h, x, y + h, br);
              ctx.arcTo(x, y + h, x, y, br);
              ctx.arcTo(x, y, x + w, y, br);
              ctx.closePath();
              ctx.fill();
            } else {
              ctx.fillRect(x, y, w, h);
            }
          }

          // Text (leaf nodes only, with text-shadow)
          var hasChildEls = el.querySelector("div, span, img, video");
          var text = "";
          for (var j = 0; j < el.childNodes.length; j++)
            if (el.childNodes[j].nodeType === 3) text += el.childNodes[j].textContent;
          text = text.trim();
          if (text && !hasChildEls) {
            ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
            ctx.fillStyle = cs.color;
            if (cs.letterSpacing && cs.letterSpacing !== "normal")
              ctx.letterSpacing = cs.letterSpacing;
            var shadow = cs.textShadow;
            if (shadow && shadow !== "none") {
              var sp = shadow.match(/rgba?\([^)]+\)\s+(-?\d+)px\s+(-?\d+)px\s+(-?\d+)px/);
              if (sp) {
                ctx.shadowColor = shadow.match(/rgba?\([^)]+\)/)[0];
                ctx.shadowOffsetX = parseFloat(sp[1]);
                ctx.shadowOffsetY = parseFloat(sp[2]);
                ctx.shadowBlur = parseFloat(sp[3]);
              }
            }
            if (cs.textAlign === "center" || w > 1800) {
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(text, x + w / 2, y + h / 2);
            } else {
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillText(text, x, y + h / 2);
            }
          }
          ctx.restore();
        }

        scene.style.opacity = origOpacity;
        scene.style.zIndex = origZ;

        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        sceneTextures[sceneId] = tex;
        resolve();
      });
    });
  });
}

// Re-capture video scenes every frame (call in updateTrans and during holds)
function recaptureVideoScene(sceneId) {
  var video = sceneHasVideo[sceneId];
  if (!video || video.readyState < 2) return;
  var scene = document.getElementById(sceneId);
  var c = document.createElement("canvas");
  c.width = 1920;
  c.height = 1080;
  var ctx = c.getContext("2d");
  ctx.fillStyle = window.getComputedStyle(scene).backgroundColor;
  ctx.fillRect(0, 0, 1920, 1080);
  var sr = scene.getBoundingClientRect();
  var els = scene.querySelectorAll("*");
  for (var i = 0; i < els.length; i++) {
    var el = els[i],
      cs = window.getComputedStyle(el);
    if (cs.display === "none") continue;
    var r = el.getBoundingClientRect();
    if (r.width < 1) continue;
    var x = r.left - sr.left,
      y = r.top - sr.top,
      w = r.width,
      h = r.height;
    ctx.save();
    ctx.globalAlpha = parseFloat(cs.opacity) || 1;
    if (el.tagName === "VIDEO" && el.readyState >= 2) {
      try {
        var vR = el.videoWidth / el.videoHeight,
          bR = w / h;
        var sx = 0,
          sy = 0,
          sw = el.videoWidth,
          sh = el.videoHeight;
        if (vR > bR) {
          sw = sh * bR;
          sx = (el.videoWidth - sw) / 2;
        } else {
          sh = sw / bR;
          sy = (el.videoHeight - sh) / 2;
        }
        ctx.drawImage(el, sx, sy, sw, sh, x, y, w, h);
      } catch (e) {}
    } else if (el.tagName === "IMG" && el.complete) {
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (e) {}
    } else {
      var bg = cs.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)") {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, w, h);
      }
      var txt = "";
      for (var j = 0; j < el.childNodes.length; j++)
        if (el.childNodes[j].nodeType === 3) txt += el.childNodes[j].textContent;
      txt = txt.trim();
      if (txt && !el.querySelector("div,span,img,video")) {
        ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        ctx.fillStyle = cs.color;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, x, y + h / 2);
      }
    }
    ctx.restore();
  }
  gl.bindTexture(gl.TEXTURE_2D, sceneTextures[sceneId]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}
```

## Shader Compilation + Shared Constants

```js
var vertSrc =
  "attribute vec2 a_pos; varying vec2 v_uv; void main(){" +
  "v_uv=a_pos*0.5+0.5; v_uv.y=1.0-v_uv.y; gl_Position=vec4(a_pos,0,1);}";

var quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

function compileShader(src, type) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    console.error("Shader:", gl.getShaderInfoLog(s));
  return s;
}

function mkProg(fragSrc) {
  var p = gl.createProgram();
  gl.attachShader(p, compileShader(vertSrc, gl.VERTEX_SHADER));
  gl.attachShader(p, compileShader(fragSrc, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error("Link:", gl.getProgramInfoLog(p));
  return p;
}

// Shared uniform header — every fragment shader starts with this
var H =
  "precision mediump float;" +
  "varying vec2 v_uv;" +
  "uniform sampler2D u_from, u_to;" +
  "uniform float u_progress;" +
  "uniform vec2 u_resolution;\n";
```

## Noise Libraries

Include only what each shader needs. Do NOT include multiple libraries that redefine `hash()` in the same shader.

```js
// Quintic C2 noise + inter-octave rotation FBM
var NQ =
  "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
  "float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);" +
  "f=f*f*f*(f*(f*6.-15.)+10.);" + // quintic interpolation — C2 continuous
  "return mix(mix(hash(i),hash(i+vec2(1,0)),f.x)," +
  "mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}" +
  "float fbm(vec2 p){float v=0.,a=.5;" +
  "mat2 R=mat2(.8,.6,-.6,.8);" + // inter-octave rotation (~37deg)
  "for(int i=0;i<5;i++){v+=a*vnoise(p);p=R*p*2.02;a*=.5;}return v;}";

// Noise with analytical derivatives (quintic) + erosion FBM
// Use for transitions that need gradient-based edge lighting
var ND =
  "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
  "vec3 noised(vec2 p){vec2 i=floor(p),f=fract(p);" +
  "vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);" +
  "float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));" +
  "return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y," +
  "du*vec2(b-a+(a-b-c+d)*u.y,c-a+(a-b-c+d)*u.x));}" +
  "float erosionFBM(vec2 p){float v=0.,a=.5;vec2 d=vec2(0);mat2 R=mat2(.8,.6,-.6,.8);" +
  "for(int i=0;i<6;i++){vec3 n=noised(p);d+=n.yz;v+=a*n.x/(1.+dot(d,d));p=R*p*2.02;a*=.5;}return v;}";

// Cosine palette: a + b*cos(2pi(c*t + d))
var CP = "vec3 palette(float t,vec3 a,vec3 b,vec3 c,vec3 d){" + "return a+b*cos(6.2832*(c*t+d));}";
```

## Render + State Machine

```js
function renderShader(prog, texFrom, texTo, progress) {
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texFrom);
  gl.uniform1i(gl.getUniformLocation(prog, "u_from"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texTo);
  gl.uniform1i(gl.getUniformLocation(prog, "u_to"), 1);
  gl.uniform1f(gl.getUniformLocation(prog, "u_progress"), progress);
  gl.uniform2f(gl.getUniformLocation(prog, "u_resolution"), 1920, 1080);
  var pos = gl.getAttribLocation(prog, "a_pos");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

var progPass = mkProg(H + "void main(){gl_FragColor=texture2D(u_from,v_uv);}");

var trans = {
  active: false,
  prog: null,
  fromId: null,
  toId: null,
  progress: 0,
};

function beginTrans(prog, fromId, toId) {
  trans.prog = prog;
  trans.fromId = fromId;
  trans.toId = toId;
  trans.progress = 0;
  trans.active = true;
}

function updateTrans() {
  if (!trans.active) return;
  // Re-capture video scenes every frame during transition
  if (sceneHasVideo[trans.fromId]) recaptureVideoScene(trans.fromId);
  if (sceneHasVideo[trans.toId]) recaptureVideoScene(trans.toId);
  renderShader(trans.prog, sceneTextures[trans.fromId], sceneTextures[trans.toId], trans.progress);
}

function endTrans(showId) {
  trans.active = false;
  renderShader(progPass, sceneTextures[showId], sceneTextures[showId], 0);
}
```

## GSAP Timeline Integration

```js
// Wait for media, start videos, capture all scenes, then build timeline
var sceneIds = ["scene1", "scene2" /* ... */];
waitForMedia()
  .then(function () {
    // Start any background videos (muted)
    document.querySelectorAll("video").forEach(function (v) {
      v.play();
    });
    return Promise.all(sceneIds.map(captureScene));
  })
  .then(function () {
    glCanvas.style.display = "block";
    renderShader(progPass, sceneTextures["scene1"], sceneTextures["scene1"], 0);
    document.querySelectorAll(".scene").forEach(function (s) {
      s.style.opacity = "0";
    });

    var tl = gsap.timeline({
      paused: true,
      onUpdate: function () {
        updateTrans();
      },
    });

    // For each transition:
    tl.call(
      function () {
        beginTrans(myShaderProg, "scene1", "scene2");
      },
      null,
      T,
    );
    var tw = { p: 0 };
    tl.to(
      tw,
      {
        p: 1,
        duration: DUR,
        ease: "power2.inOut",
        onUpdate: function () {
          trans.progress = tw.p;
        },
      },
      T,
    );
    tl.call(
      function () {
        endTrans("scene2");
      },
      null,
      T + DUR,
    );

    window.__timelines["main"] = tl;
  });
```
