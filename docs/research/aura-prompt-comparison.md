# Aura Prompt Comparison: With Screenshot vs Without

## Soulscape (NO screenshot — timed out)

```
Recreate the imported webpage as faithfully as possible using the captured 
page structure from the imported site as the structural reference and the 
attached DESIGN.md as the design-system and asset reference.

Screenshot capture timed out during import, so no screenshot reference is 
attached. Use the captured page structure from the imported site to preserve 
exact structure, section order, and supporting source details. Use the 
DESIGN.md to preserve exact design-system choices and asset references.

Rebuild all major sections supported by the source, preserving the original 
page flow instead of collapsing it into a smaller subset. Match the 
composition, section order, spacing, imagery placement, and responsive 
structure as closely as practical from the imported source.

Detect and preserve any motion patterns evidenced by the captured import 
structure, including scroll reveals, marquee effects, hover states, masked 
text reveals, parallax, or ambient background movement.

Avoid long inline SVG markup unless there is no practical alternative. Let 
the captured page structure from the imported site drive supporting structure 
and let the DESIGN.md drive design-system and asset decisions instead of 
adding extra interpretation.

Rebuild it as clean, maintainable HTML, CSS, and JavaScript instead of 
converting it into React.

Attached Files: DESIGN.md (7.7 KB)

This import is in EXACTLY mode. Screenshot capture timed out, so treat the 
captured page structure from the imported site as the required structural 
reference and the attached DESIGN.md as the design-system and asset 
reference. Match the original texts, names, numbers, and brand references 
unless something is clearly broken or inaccessible.

Preserve motion cues from the captured import structure when present, use 
the attached DESIGN.md as the supporting design-system and asset reference, 
and do not replace the imported design with Aura defaults or a new house 
style.

Detected source implementation cues that must be preserved:
- Preserve the source CSS custom properties and theme tokens
- Typography is explicitly defined in the source. Match the original font 
  families, weights, and headline/body hierarchy
- Preserve the detected runtime motion stack (GSAP, ScrollTrigger) and 
  reproduce comparable scroll reveals, text animations, hover states
- Marquee-style motion is present in the source. Keep that behavior
- Three.js evidence is present in the imported source. Preserve the 3D 
  scene or the closest faithful equivalent
```

## Notion (WITH screenshot)

```
Recreate the attached webpage EXACTLY like the screenshot as an HTML + 
JavaScript implementation using Tailwind CSS. Treat the screenshot as the 
primary visual reference. Use the captured page structure from the imported 
site as the structural reference and the attached DESIGN.md as a secondary 
typography and asset inventory reference.

Use DESIGN.md only to preserve font families, font weights, typographic 
tone, and asset references. If DESIGN.md conflicts with the screenshot on 
colors, surfaces, layout, or composition, follow the screenshot.

Avoid long inline SVG markup unless there is no practical alternative. Let 
the screenshot drive styling decisions instead of adding extra interpretation.

Attached Files: DESIGN.md (16.4 KB)

This import is in EXACTLY mode. Treat the screenshot as the primary visual 
reference, the captured page structure from the imported site as the 
structural source of truth, and the attached DESIGN.md as a secondary 
typography and asset inventory reference.

If the screenshot and captured structure conflict, follow the screenshot 
for layout, surfaces, typography, and motion. Use DESIGN.md only to 
preserve font families, font weights, typographic tone, and asset 
references. If DESIGN.md conflicts with the screenshot on colors, surfaces, 
layout, or composition, follow the screenshot.

Match the original texts, names, numbers, and brand references unless 
something is clearly broken or inaccessible.

Preserve motion cues from the screenshot when present, use the captured 
import structure as supporting structure, use the attached DESIGN.md as a 
secondary typography and asset inventory reference.

Do not replace the imported design with Aura defaults or a new house style.

Detected source implementation cues that must be preserved:
- Preserve the source CSS custom properties and theme tokens
- Typography is explicitly defined in the source. Match the original font 
  families, weights, and headline/body hierarchy
- Marquee-style motion is present in the source. Keep that behavior
```

## Key Differences

| Aspect | NO screenshot | WITH screenshot |
|--------|--------------|-----------------|
| **Primary reference** | "captured page structure" (HTML) | "screenshot" (image) |
| **DESIGN.md role** | "design-system and asset reference" (PRIMARY) | "secondary typography and asset inventory reference" (SECONDARY) |
| **Conflict resolution** | DESIGN.md drives design decisions | "If DESIGN.md conflicts with the screenshot, follow the screenshot" |
| **Output format** | "clean, maintainable HTML, CSS, and JavaScript" | "HTML + JavaScript implementation using Tailwind CSS" |
| **Motion detection** | Lists specific: GSAP, ScrollTrigger, Three.js | Only: marquee, CSS custom properties |
| **Structure emphasis** | "Rebuild all major sections...preserving the original page flow" | Less emphasis on structure completeness |

## What's SAME in Both

1. "EXACTLY mode" — match original texts, names, numbers, brand references
2. "Do not replace the imported design with Aura defaults or a new house style"
3. "Avoid long inline SVG markup"
4. "Detected source implementation cues" section (dynamic, varies per site)
5. "Preserve motion cues"
6. DESIGN.md always attached
7. "Captured page structure" always referenced

## What's Dynamic (Varies Per Site)

The "Detected source implementation cues" section changes based on what Aura found in the HTML:
- Soulscape: GSAP, ScrollTrigger, Three.js, marquee (JS-heavy site)
- Notion: CSS custom properties, marquee only (CSS-heavy site)
- This section is programmatically generated based on source code analysis
