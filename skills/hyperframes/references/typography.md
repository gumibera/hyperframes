# Typography

The compiler embeds supported fonts — just write `font-family` in CSS.

## Banned

Inter, Roboto, Open Sans, Noto Sans, Arimo, Lato, Source Sans, PT Sans, Nunito, Poppins, Outfit, Sora, Playfair Display, Cormorant Garamond, Bodoni Moda, EB Garamond, Cinzel, Prata

## Guardrails

You know these rules but you violate them. Stop.

- **Don't pair two sans-serifs.** You do this constantly — one for headlines, one for body. Cross the boundary: serif + sans, or sans + mono.
- **One expressive font per scene.** You pick two interesting fonts trying to make it "better." One performs, one recedes.
- **Weight contrast must be extreme.** You default to 400 vs 700. Video needs 300 vs 900. The difference must be visible in motion at a glance.
- **Video sizes, not web sizes.** Body: 20px minimum. Headlines: 60px+. Data labels: 16px. You will try to use 14px. Don't.

## What You Don't Do Without Being Told

- **Tension should mean something.** Don't pattern-match pairings. Ask WHY these two fonts disagree. The pairing should embody the content's contradiction — mechanical vs human, public vs private, institutional vs personal. If you can't articulate the tension, it's arbitrary.
- **Register switching.** Assign different fonts to different communicative modes — one voice for statements, another for data, another for attribution. Not hierarchy on a page. Voices in a conversation.
- **Tension can live inside a single font.** A font that looks familiar but is secretly strange creates tension with the viewer's expectations, not with another font.
- **One variable changed = dramatic contrast.** Same letterforms, monospaced vs proportional. Same family at different optical sizes. Changing only rhythm while everything else stays constant.
- **Double personality works.** Two expressive fonts can coexist if they share an attitude (both irreverent, both precise) even when their forms are completely different.
- **Time is hierarchy.** The first element to appear is the most important. In video, sequence replaces position.
- **Motion is typography.** How a word enters carries as much meaning as the font. A 0.1s slam vs a 2s fade — same font, completely different message.
- **Fixed reading time.** 3 seconds on screen = must be readable in 2. Fewer words, larger type.
- **Tracking tighter than web.** -0.03em to -0.05em on display sizes. Video encoding compresses letter detail.

## Finding Fonts

Don't default to what you know. If the content is luxury, a grotesque sans might create more tension than the expected Didone serif. Decide the register first, then search.

Save this script to `/tmp/fontquery.py` and run with `curl -s 'https://fonts.google.com/metadata/fonts' > /tmp/gfonts.json && python3 /tmp/fontquery.py /tmp/gfonts.json`:

```python
import json, sys
from collections import OrderedDict

with open(sys.argv[1]) as f:
    data = json.load(f)
fonts = data.get("familyMetadataList", [])

ban = {"Inter","Roboto","Open Sans","Noto Sans","Lato","Poppins","Source Sans 3",
       "PT Sans","Nunito","Outfit","Sora","Playfair Display","Cormorant Garamond",
       "Bodoni Moda","EB Garamond","Cinzel","Prata","Arimo","Source Sans Pro"}
skip_pfx = ("Roboto","Noto ","Google Sans","Bpmf","Playwrite","Anek","BIZ ",
            "Nanum","Shippori","Sawarabi","Zen ","Kaisei","Kiwi ","Yuji ","Radio ")

def ok(f):
    if f["family"] in ban: return False
    if any(f["family"].startswith(b) for b in skip_pfx): return False
    if "latin" not in (f.get("subsets") or []): return False
    return True

seen = set()
R = OrderedDict()

# Trending Sans — recent (2022+), popular (<300)
R["Trending Sans"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") in ("Sans Serif","Display") and f.get("dateAdded","") >= "2022-01-01" and f.get("popularity",9999) < 300:
        R["Trending Sans"].append(f); seen.add(f["family"])

# Trending Serif — recent (2018+), popular (<600)
R["Trending Serif"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") == "Serif" and f.get("dateAdded","") >= "2018-01-01" and f.get("popularity",9999) < 600:
        R["Trending Serif"].append(f); seen.add(f["family"])

# Monospace — recent (2018+), popular (<600)
R["Monospace"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") == "Monospace" and f.get("dateAdded","") >= "2018-01-01" and f.get("popularity",9999) < 600:
        R["Monospace"].append(f); seen.add(f["family"])

# Impact & Condensed — curated names + heavy display fonts
R["Impact & Condensed"] = []
impact = {"Bebas Neue","Archivo Black","Big Shoulders Display","Teko","League Gothic",
          "Barlow Condensed","Staatliches","Anton","Oswald","Saira","Syne",
          "Titillium Web","Alumni Sans","Advent Pro"}
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    is_impact = f["family"] in impact
    is_heavy_display = ("Display" in (f.get("classifications") or [])
        and any(k in list(f.get("fonts",{}).keys()) for k in ("800","900"))
        and f.get("popularity",9999) < 400
        and f.get("category") in ("Sans Serif","Display"))
    if is_impact or is_heavy_display:
        R["Impact & Condensed"].append(f); seen.add(f["family"])

# Bold Geometric Display — curated
R["Bold Geometric Display"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f["family"] in {"DM Serif Display","Abril Fatface","Righteous","Orbitron","Black Ops One"}:
        R["Bold Geometric Display"].append(f); seen.add(f["family"])

# Script & Handwriting — popular (<300)
R["Script & Handwriting"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") == "Handwriting" and f.get("popularity",9999) < 300:
        R["Script & Handwriting"].append(f); seen.add(f["family"])

# Established Classics — good older fonts
R["Established Classics"] = []
classics = {"Josefin Sans","Raleway","Montserrat","Abel","Exo","Red Hat Display",
            "Rubik","Alegreya","Arvo","Besley","Crimson Text","Fraunces",
            "Lora","Merriweather","Vollkorn"}
for f in fonts:
    if f["family"] in classics and f["family"] not in seen:
        R["Established Classics"].append(f); seen.add(f["family"])

# Print
for cat in R:
    R[cat].sort(key=lambda x: x.get("popularity",9999))
limits = {"Trending Sans":15,"Trending Serif":12,"Monospace":8,
          "Impact & Condensed":12,"Bold Geometric Display":8,
          "Script & Handwriting":10,"Established Classics":20}
for cat in R:
    items = R[cat][:limits.get(cat,10)]
    if not items: continue
    print(f"--- {cat} ({len(items)}) ---")
    for ff in items:
        var = "VAR" if ff.get("axes") else "   "
        print(f'  {ff.get("popularity"):4d} | {var} | {ff["family"]}')
    print()
```

Seven categories: trending sans, trending serif, monospace, impact/condensed, bold geometric, script/handwriting, and established classics. Cross classification boundaries when pairing.
