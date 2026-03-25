---
name: media
description: Video, audio, and image handling constraints for HyperFrames. Use when adding media elements to a composition or troubleshooting media playback.
---

# Media

Constraints for working with video, audio, and images in HyperFrames compositions.

## When to Use

- Adding video, audio, or image clips to a composition
- Troubleshooting media that won't play or render
- Working with transparent video, trimming, or volume control

## Video

### Required Attributes

Every `<video>` element must have:

```html
<video
  id="el-1"
  data-start="0"
  data-duration="15"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
  crossorigin="anonymous"
></video>
```

- **`muted`** — required. Video elements must not carry audio. Use a separate `<audio>` element.
- **`playsinline`** — required. Prevents fullscreen on mobile.
- **`crossorigin="anonymous"`** — required for CORS-safe rendering in headless Chrome.

### Supported Codecs

The renderer uses headless Chrome. Only web-compatible codecs work:

| Codec      | Container | Works                 |
| ---------- | --------- | --------------------- |
| H.264      | MP4       | Yes                   |
| VP8        | WebM      | Yes                   |
| VP9        | WebM      | Yes (including alpha) |
| AV1        | MP4/WebM  | Yes                   |
| HEVC/H.265 | MP4       | No                    |
| ProRes     | MOV       | No                    |

If the source video uses an unsupported codec, transcode first:

```bash
ffmpeg -i input.mov -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k output.mp4
```

### Transparent Video

Use WebM VP9 with alpha channel for overlays (talking heads, animated elements):

```html
<video
  id="el-overlay"
  data-start="0"
  data-duration="10"
  data-track-index="2"
  src="overlay.webm"
  muted
  playsinline
  crossorigin="anonymous"
  style="z-index:50;"
></video>
```

Encode transparent video:

```bash
ffmpeg -i input.mov -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 2M output.webm
```

### Trimming

Use `data-media-start` to set an in-point offset into the source file:

```html
<!-- Play from 5s into the source, for 10s -->
<video
  id="el-1"
  data-start="0"
  data-duration="10"
  data-media-start="5"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
></video>
```

The framework seeks the video to the `data-media-start` position and plays from there.

### Video Duration

If `data-duration` is omitted on a video element, the framework uses the source media's intrinsic duration. For predictable timing, always set `data-duration` explicitly.

## Audio

### Separate Audio Element

Audio must always be a separate `<audio>` element, even if the audio source is the same file as a video:

```html
<!-- Video (muted) -->
<video
  id="el-video"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="interview.mp4"
  muted
  playsinline
></video>

<!-- Audio from same file -->
<audio
  id="el-audio"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="interview.mp4"
  data-volume="1"
></audio>
```

### Volume Control

Use `data-volume` (0-1) to set playback volume:

```html
<audio
  id="el-music"
  data-start="0"
  data-duration="60"
  data-track-index="3"
  src="bgm.mp3"
  data-volume="0.3"
></audio>
```

### Audio Trimming

Same as video — use `data-media-start`:

```html
<audio
  id="el-sfx"
  data-start="5"
  data-duration="3"
  data-media-start="10"
  data-track-index="4"
  src="effects.mp3"
></audio>
```

## Images

```html
<img
  id="el-bg"
  data-start="0"
  data-duration="30"
  data-track-index="1"
  src="background.jpg"
  style="width:1920px;height:1080px;object-fit:cover;"
/>
```

- `data-duration` is required on images (no intrinsic duration)
- Use `object-fit: cover` for full-bleed backgrounds
- Use `z-index` for layering with video

## Picture-in-Picture

To animate video position/size, wrap it in a non-timed div. Animate the wrapper, not the video:

```html
<div
  id="pip-frame"
  style="
  position:absolute; top:0; left:0;
  width:1920px; height:1080px;
  z-index:50; overflow:hidden;
"
>
  <video
    id="el-video"
    data-start="0"
    data-duration="60"
    data-track-index="0"
    src="talking-head.mp4"
    muted
    playsinline
    style="width:100%;height:100%;object-fit:cover;"
  ></video>
</div>
```

```js
// Shrink to corner at 10s
tl.to(
  "#pip-frame",
  {
    top: 700,
    left: 1360,
    width: 500,
    height: 280,
    borderRadius: 16,
    duration: 1,
    ease: "power2.inOut",
  },
  10,
);
```

**Key rules:**

- The wrapper div has **no** `data-start`, `data-duration`, or `data-track-index`
- The video inside has all the data attributes
- Animate the wrapper's CSS properties (top, left, width, height)
- Never animate the video element's dimensions directly

## Framework Owns Playback

The framework manages all media playback. Never do any of these in scripts:

```js
// ALL OF THESE ARE WRONG
video.play();
video.pause();
video.currentTime = 5;
audio.play();
audio.pause();
audio.volume = 0.5; // use data-volume attribute instead
```

The framework:

- Plays/pauses media in sync with the master timeline
- Seeks media when the timeline is scrubbed
- Waits for media to load before resolving timing

## Constraints

- **Video must be `muted`.** Audio comes from `<audio>` elements.
- **Video must be `playsinline`.** Required for headless rendering.
- **Do not nest video inside a timed div.** Video must be a direct child of the composition, or inside a non-timed wrapper.
- **Do not animate video element dimensions.** Animate a wrapper div instead.
- **Do not call play/pause/seek on media.** Framework owns playback.
- **Set `data-duration` explicitly** on all clips for predictable timing.
- **Use web-compatible codecs.** H.264, VP8, VP9, AV1 only.
- **Separate audio from video.** Always use `<audio>` for sound.
