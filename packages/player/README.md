# @hyperframes/player

Embeddable web component for playing HyperFrames compositions. Zero dependencies, works with any framework.

## Install

```bash
npm install @hyperframes/player
```

Or load directly via CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/player"></script>
```

## Usage

```html
<hyperframes-player src="./my-composition/index.html" controls></hyperframes-player>
```

The player loads the composition in a sandboxed iframe, auto-detects its dimensions and duration, and scales it responsively to fit the container.

### With a framework

```typescript
import "@hyperframes/player";

// The custom element is now registered — use it in your markup
// React: <hyperframes-player src="..." controls />
// Vue:   <hyperframes-player :src="url" controls />
```

### Poster image

Show a static image before playback starts:

```html
<hyperframes-player
  src="./composition/index.html"
  poster="./thumbnail.jpg"
  controls
></hyperframes-player>
```

## Attributes

| Attribute       | Type    | Default | Description                                 |
| --------------- | ------- | ------- | ------------------------------------------- |
| `src`           | string  | —       | URL to the composition HTML file            |
| `width`         | number  | 1920    | Composition width in pixels (aspect ratio)  |
| `height`        | number  | 1080    | Composition height in pixels (aspect ratio) |
| `controls`      | boolean | false   | Show play/pause, scrubber, and time display |
| `muted`         | boolean | false   | Mute audio playback                         |
| `poster`        | string  | —       | Image URL shown before playback starts      |
| `playback-rate` | number  | 1       | Speed multiplier (0.5 = half, 2 = double)   |
| `autoplay`      | boolean | false   | Start playing when ready                    |
| `loop`          | boolean | false   | Restart when the composition ends           |

## JavaScript API

```js
const player = document.querySelector("hyperframes-player");

// Playback
player.play();
player.pause();
player.seek(2.5); // jump to 2.5 seconds

// Properties
player.currentTime; // number (read/write)
player.duration; // number (read-only)
player.paused; // boolean (read-only)
player.ready; // boolean (read-only)
player.playbackRate; // number (read/write)
player.muted; // boolean (read/write)
player.loop; // boolean (read/write)
```

## Events

| Event        | Detail            | Fired when                                 |
| ------------ | ----------------- | ------------------------------------------ |
| `ready`      | `{ duration }`    | Composition loaded and duration determined |
| `play`       | —                 | Playback started                           |
| `pause`      | —                 | Playback paused                            |
| `timeupdate` | `{ currentTime }` | Playback position changed (~10 fps)        |
| `ended`      | —                 | Reached the end (when not looping)         |
| `error`      | `{ message }`     | Composition failed to load                 |

```js
player.addEventListener("ready", (e) => {
  console.log(`Duration: ${e.detail.duration}s`);
});

player.addEventListener("ended", () => {
  console.log("Done!");
});
```

## Sizing

The player fills its container and scales the composition to fit while preserving aspect ratio. Set a size on the element or its parent:

```css
hyperframes-player {
  width: 100%;
  max-width: 800px;
  aspect-ratio: 16 / 9;
}
```

The `width` and `height` attributes define the composition's native resolution for aspect ratio calculation — they don't set the player's display size.

## How it works

The player renders compositions in a sandboxed `<iframe>` inside a Shadow DOM. It communicates with the HyperFrames runtime via `postMessage`. If the composition has GSAP timelines (`window.__timelines`) but no runtime, the player auto-injects it from CDN.

## Distribution

| Format | File                           | Use case                       |
| ------ | ------------------------------ | ------------------------------ |
| ESM    | `hyperframes-player.js`        | Bundlers (Vite, webpack, etc.) |
| CJS    | `hyperframes-player.cjs`       | Node.js / require()            |
| IIFE   | `hyperframes-player.global.js` | `<script>` tag, CDN            |

All formats are minified with source maps. TypeScript definitions included.

## License

MIT
