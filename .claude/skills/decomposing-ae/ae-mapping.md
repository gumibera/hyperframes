# AE → HyperFrames Mapping

## Layer Types

| AE Layer         | HyperFrames Equivalent                                          |
| ---------------- | --------------------------------------------------------------- |
| Footage (video)  | `<video>` clip (muted, playsinline) + separate `<audio>` clip   |
| Footage (image)  | `<img>` clip                                                    |
| Footage (audio)  | `<audio>` clip                                                  |
| Solid            | `<div>` with `background-color`                                 |
| Text             | `<div>` with styled text; SplitText for per-character animation |
| Shape            | SVG elements or CSS (depending on complexity)                   |
| Null object      | Wrapper `<div>` for grouping transforms                         |
| Adjustment layer | CSS `filter` on a wrapper element                               |
| Pre-comp         | Sub-composition via `data-composition-src`                      |
| Camera           | CSS `perspective` + `transform-style: preserve-3d` on parent    |
| Light            | Approximate with CSS gradients/shadows                          |

## Transform Properties

| AE Property         | GSAP/CSS                                   |
| ------------------- | ------------------------------------------ |
| Position            | `x`, `y` (GSAP)                            |
| Scale               | `scale`, `scaleX`, `scaleY`                |
| Rotation            | `rotation` (GSAP)                          |
| Opacity             | `opacity`                                  |
| Anchor Point        | `transformOrigin`                          |
| 3D Position (X,Y,Z) | `x`, `y`, `z` with `perspective` on parent |
| 3D Rotation (X,Y,Z) | `rotationX`, `rotationY`, `rotationZ`      |

## Effects

| AE Effect          | Approximation                                                   |
| ------------------ | --------------------------------------------------------------- |
| Gaussian Blur      | `filter: blur(Npx)`                                             |
| Drop Shadow        | `filter: drop-shadow(...)`                                      |
| Glow               | Duplicate element + `filter: blur()` + `mix-blend-mode: screen` |
| Turbulent Displace | SVG `feTurbulence` + `feDisplacementMap`                        |
| Gradient Ramp      | CSS `linear-gradient` / `radial-gradient`                       |
| Tritone/Tint       | CSS `filter: sepia() hue-rotate() saturate()`                   |
| Stroke (on text)   | `-webkit-text-stroke` or SVG text with stroke                   |
| CC Particle World  | Script-driven DOM/Canvas in sub-composition                     |
| Fractal Noise      | SVG `feTurbulence`                                              |
| Mosaic             | SVG pixelation filter                                           |
| Color correction   | CSS `filter: brightness() contrast() saturate()`                |
| Fill               | CSS `background-color` or SVG `fill`                            |
| Venetian Blinds    | CSS `clip-path` animation or repeating gradient mask            |
| Color Control      | CSS custom properties / JS variables                            |

## Blend Modes

| AE Mode     | CSS `mix-blend-mode` |
| ----------- | -------------------- |
| Normal      | `normal`             |
| Multiply    | `multiply`           |
| Screen      | `screen`             |
| Overlay     | `overlay`            |
| Soft Light  | `soft-light`         |
| Hard Light  | `hard-light`         |
| Color Dodge | `color-dodge`        |
| Color Burn  | `color-burn`         |
| Difference  | `difference`         |
| Exclusion   | `exclusion`          |
| Add         | `screen` (closest)   |

## Track Mattes

| AE Matte Type  | CSS Equivalent                                                    |
| -------------- | ----------------------------------------------------------------- |
| Alpha Matte    | `mask-image` referencing the matte element                        |
| Alpha Inverted | `mask-image` + `mask-composite: exclude`                          |
| Luma Matte     | `mask-image` + `mask-mode: luminance`                             |
| Luma Inverted  | `mask-image` + `mask-mode: luminance` + `mask-composite: exclude` |

## Easing

| AE Preset     | GSAP Equivalent                                                  |
| ------------- | ---------------------------------------------------------------- |
| Easy Ease     | `"power2.inOut"`                                                 |
| Easy Ease In  | `"power2.in"`                                                    |
| Easy Ease Out | `"power2.out"`                                                   |
| Linear        | `"none"`                                                         |
| Custom bezier | `CustomEase.create("name", "M0,0 C<cx1>,<cy1> <cx2>,<cy2> 1,1")` |

## GSAP Plugins

| Use Case                           | Plugin                     |
| ---------------------------------- | -------------------------- |
| Path-based motion                  | MotionPathPlugin           |
| Shape morphing                     | MorphSVGPlugin             |
| Per-character text animation       | SplitText                  |
| SVG stroke drawing                 | DrawSVGPlugin              |
| Custom easing from AE graph editor | CustomEase                 |
| Physics-based bounce/elastic       | CustomBounce, CustomWiggle |
| Layout/flip animations             | Flip                       |

## Coordinate System Conversion

AE and CSS use different coordinate models:

**AE model:**

- Position relative to composition (0,0 = top-left)
- Anchor Point relative to layer bounds (in layer-local pixels)
- Position moves the anchor point to that comp location

**CSS/GSAP model:**

- `left`/`top` position the element's top-left corner
- `transform-origin` is the pivot for transforms

**Conversion:**

```
CSS left   = AE positionX - AE anchorPointX
CSS top    = AE positionY - AE anchorPointY
CSS transform-origin = anchorPointX + "px " + anchorPointY + "px"
```

For GSAP keyframes animating position, animate `x` and `y` relative to the initial `left`/`top` placement.
