# TTS Integration

How to add narrated voiceover to a website-to-hyperframes composition.

## When to Use TTS

**Narration is the default for ALL video types.** Silent videos feel like slideshows. Generate voiceover unless the user explicitly says "no narration" or "no voiceover."

- **Explainer videos** — always narrated, longest script
- **Product promos** — always narrated, punchy copy
- **Social clips** — narrated with bold captions, short and energetic
- **Launch announcements** — brief narration adds drama and polish

## Step 1: Write the Narration Script

**Write like a human product demo narrator, NOT marketing copy.** The script should feel like someone casually but enthusiastically showing you a product — not reading a press release.

### The #1 Rule: Conversational Tone

**BAD (corporate copy — sounds robotic when spoken):**

> "Stripe is the financial infrastructure that powers the internet. Accept payments, manage subscriptions, and build custom revenue models."

**GOOD (product demo — sounds natural when spoken):**

> "So this is Stripe — basically the backbone behind how the internet handles money. You can take payments, set up subscriptions, build out billing... all from one platform."

**BAD (bullet point narration):**

> "Trusted by millions of businesses worldwide, from startups to Fortune 500 companies."

**GOOD (conversational):**

> "And it's not just startups using this — Google's on here, Shopify, Coinbase, Amazon... pretty much everyone."

### Script Writing Rules

- **2.5 words per second** is natural speaking pace. 30s video = 75 words, 60s = 150 words.
- **Start with energy** — first sentence should hook, not inform. "So this is..." or "Check this out..." or "Meet [product]..."
- **Use contractions** — "it's" not "it is", "you'll" not "you will", "that's" not "that is"
- **Use filler words sparingly but intentionally** — "basically", "pretty much", "honestly" make it human
- **Vary sentence length** — mix short punchy phrases with longer ones
- **Add pauses with punctuation** — "And the uptime? Ninety nine point nine percent." The question mark creates a natural pause.
- **End with casual CTA** — "Check it out at stripe dot com" not "Get started at stripe dot com"
- **Don't list features** — tell a story. "You set up payments, and then it just... handles everything" vs "Accept payments, manage subscriptions, build revenue models"

**Natural pronunciation — write numbers as people actually say them:**

| On the website | Write in script as                | Why                                                       |
| -------------- | --------------------------------- | --------------------------------------------------------- |
| 135+           | more than one hundred thirty five | nobody says "one hundred thirty five plus"                |
| $1.9T          | nearly two trillion dollars       | round it, sound natural                                   |
| 99.999%        | ninety nine point nine percent    | simplify for speech — the extra nines are unpronounceable |
| 200M+          | over two hundred million          | "plus" sounds robotic                                     |
| 24/7           | twenty four seven                 | standard spoken form                                      |
| 10x            | ten times                         | spell out multipliers                                     |
| API            | A P I                             | spell out acronyms                                        |
| stripe.com     | stripe dot com                    | spell out URLs                                            |
| Fortune 500    | Fortune five hundred              | spell out numbers in names                                |

The TTS engine reads what you write literally. "99.999%" becomes "ninety nine point nine nine nine percent" which sounds ridiculous. Simplify numbers for natural speech — the visual on screen can show the exact figure while the voice rounds it.

Save the script as `narration-script.txt` in the project directory.

## Step 2: Generate TTS Audio

Three options, in order of recommendation:

### Voice Selection: Audition Before Committing

**Never use the first voice you find.** Always audition 2-3 voices with a short test phrase before generating the full narration.

#### Audition Process (Required)

1. **Search for voices** that match the brand tone:
   - Use `mcp__elevenlabs__search_voices` with descriptive terms: "warm conversational", "friendly narrator", "product demo"
   - Use `mcp__claude_ai_HeyGen__list_audio_voices` to browse HeyGen options
2. **Generate a test clip** with a short excerpt (first sentence of the script) using 2-3 different voices
3. **Pick the one that sounds most natural and conversational** — not the most "professional" or "polished"

#### What to listen for:

- **Natural breathing/pauses** — robotic voices have unnaturally even pacing
- **Emphasis variation** — good voices stress important words naturally
- **Warmth** — the voice should sound like someone talking TO you, not AT you
- **Speed** — slightly faster than news-anchor pace, like a friend explaining something cool

### Option A: HeyGen TTS (Always Available)

HeyGen TTS is available via MCP and returns word-level timestamps automatically. **Use this as the primary option.**

```
Tool: mcp__claude_ai_HeyGen__text_to_speech
Input:
  text: "[narration script]"
  voiceId: "[pick based on audition]"
  speed: 1.0  (adjust 0.9-1.1 based on content)
```

This returns an audio URL + word timestamps. Download the audio:

```bash
curl -o narration.wav "[audio_url]"
```

**Audition process:**

1. Use `mcp__claude_ai_HeyGen__list_audio_voices` with `language: "English"` to browse voices
2. Look for voices described as "Chill", "Smooth", "Relaxed", "Charming" — avoid "Professional", "Dominant", "Firm"
3. Generate test clips with 2-3 candidates using a short excerpt of the script
4. Pick the most natural, conversational one

**Good HeyGen voices for product demos:** Chill Brian, Smooth Dev, Charming Charles, Relaxed Reece

### Option B: ElevenLabs TTS (If Available — Better Voice Quality)

If the ElevenLabs MCP server is installed (`mcp__elevenlabs__*` tools), use it for wider voice variety and more natural-sounding output:

```
Tool: mcp__elevenlabs__search_voices
Input: query "warm conversational narrator"

Then:
Tool: mcp__elevenlabs__text_to_speech
Input:
  text: "[narration script]"
  voice_id: "[from search results]"
```

Note: ElevenLabs does NOT return word timestamps — you'll need to transcribe the audio separately (Step 3). ElevenLabs MCP may not be available in all environments.

### Option C: Local Kokoro TTS (Offline Fallback)

Only use Kokoro if MCP TTS tools are unavailable. Kokoro voices are functional but less expressive.

```bash
npx hyperframes tts narration-script.txt --voice af_nova --output narration.wav --speed 0.95
```

Best Kokoro voices:
| Content | Voice | Why |
|---------|-------|-----|
| Product demo | `af_nova` | Warmest of the available options |
| Tutorial | `bf_emma` | Clear, natural pacing |
| Marketing | `af_sky` | Most energetic |

## Step 3: Get Word-Level Timestamps

Transcribe the generated audio back to get precise word timings:

```bash
npx hyperframes transcribe narration.wav
```

This produces `transcript.json`:

```json
[
  { "text": "Stripe", "start": 0.0, "end": 0.4 },
  { "text": "is", "start": 0.45, "end": 0.55 },
  { "text": "financial", "start": 0.6, "end": 1.1 },
  { "text": "infrastructure", "start": 1.15, "end": 1.8 }
]
```

## Step 4: Map Timestamps to Scenes

Divide the transcript into segments that correspond to scenes:

```
Scene 1 intro narration: words 0-15 → starts at word[0].start, ends at word[15].end
Scene 2 feature narration: words 16-35 → starts at word[16].start, ends at word[35].end
...
```

Set each scene's `data-start` and `data-duration` to match its narration segment. This creates natural transitions — the scene changes when the narration moves to the next topic.

## Step 5: Add Audio to Composition

In the root `index.html`, add the narration as an audio element:

```html
<audio
  id="narration-audio"
  data-start="0"
  data-duration="[total narration duration]"
  data-track-index="10"
  src="narration.wav"
  data-volume="1"
></audio>
```

## Step 6: Add Captions (Optional but Recommended)

If adding captions synced to the narration, invoke `/hyperframes` and pass the `transcript.json`. The captions skill handles word-level timing, per-word styling, and animation automatically.

### Caption Emphasis with Marker-Highlight

For extra visual impact, use the `/hyperframes` skill to add hand-drawn emphasis on key words in captions:

- **Brand names** (e.g., "Stripe") → `highlight` mode with brand accent color
- **Big numbers** (e.g., "two trillion") → `circle` or `burst` mode
- **CTA words** (e.g., "Check it out") → `highlight` with thicker stroke

This is optional but makes captions feel alive. See the `/hyperframes` skill's marker-highlight reference for integration patterns.

Captions go in a separate sub-composition (`compositions/captions.html`) loaded as an overlay:

```html
<div
  id="caption-overlay"
  data-composition-id="captions"
  data-composition-src="compositions/captions.html"
  data-start="0"
  data-duration="[narration duration]"
  data-track-index="2"
  data-width="1920"
  data-height="1080"
></div>
```

## Common Issues

**Audio too fast/slow:** Adjust TTS speed. HeyGen and ElevenLabs support speed parameters. For Kokoro, use `--speed 0.9` or `--speed 1.1`.

**Transcript timestamps are off:** Upgrade the whisper model: `npx hyperframes transcribe narration.wav --model medium.en` for better accuracy.

**Scene transitions feel abrupt:** Add 0.5-1s overlap between scenes — start the next scene's entrance animation slightly before the current scene fully exits.
