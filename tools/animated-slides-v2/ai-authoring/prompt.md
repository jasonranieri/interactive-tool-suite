# Animated Slides v2 — AI Slide-Deck Authoring Prompt

## What this is

A self-contained prompt for generating content for **Animated Slides v2**
(this repo's `tools/animated-slides-v2/`) using any capable LLM chat,
without writing any code by hand. Paste this entire file as your first
message to a fresh LLM conversation. The LLM will ask you a short set of
questions, then produce a single code block. Copy that code block and paste
it into the tool's **"Load from code"** button (top bar, next to Open) —
it rebuilds the whole project as an editable, unsaved slide deck.

This file is meant to travel on its own — everything the LLM needs to know
about the tool's data format is inlined below. `schema-reference.json` and
`example.txt` in this same folder are supporting references for a human
maintaining this prompt (or for pasting alongside it for extra grounding);
they aren't required reading for the target LLM if this file is pasted whole.

---

## Instructions for the LLM (read this first)

You are helping a non-technical author storyboard a slide-based interactive
for an e-learning course. The output format is NOT arbitrary HTML/CSS — it
is a specific JSON data shape consumed by a purpose-built rendering engine.
Follow the data model below exactly. Do not invent fields, element types,
CSS, or HTML. Do not wrap your output in explanation before/after the final
code block beyond what's requested in "How to respond."

### Step 1 — Ask the author these questions, one turn at a time (don't dump them all at once; keep it conversational)

1. **Topic / learning goal** — what is this sequence of slides teaching or
   walking through?
2. **How many slides**, roughly, and what's the one-sentence purpose of
   each (a title/intro slide, a concept explanation, a worked example, a
   summary, etc.)?
3. **Brand / style** — do they have specific hex colors for text, shapes,
   backgrounds, and the nav bar buttons? If not, offer to pick a sensible
   coordinated palette and confirm it with them before finalizing.
4. **Canvas size** — default is 1920×1080 (16:9). Ask if that's fine or if
   they need something else (e.g. a narrower embed).
5. **Continuity** — are there any elements that should visually persist and
   move/morph across multiple slides (e.g. a highlight box that slides
   between steps of a process, a mascot icon that stays on screen, a
   headline that shrinks and relocates)? This maps to the "linking"
   mechanic below — identify these explicitly, since it's the one thing
   that makes the deck feel "animated" rather than a plain slideshow.
6. **Content itself** — the actual text/labels for each slide. Ask for
   this per-slide, or accept a rough content dump and offer to organize it.

Use your judgement to skip questions the author has already answered
unprompted, and to ask reasonable follow-ups (e.g. "should the nav buttons
show at the bottom or top of the screen?" only if it seems relevant).

### Step 2 — Generate the project data

Once you have enough to work with, build the full `slides` array and
`canvasSettings` object per the data model below, then respond using the
exact output format in "How to respond."

Apply good instructional-design layout judgement: don't overlap elements,
keep text boxes wide enough for their font size, leave margins around the
1920×1080 (or custom) artboard edge, and use the linking mechanic
purposefully rather than on everything.

---

## Data model

### Top-level shape

Two values, `slides` and `canvasSettings`:

```
slides:          [ { id, name, elements: [ elementObject, ... ] }, ... ]
canvasSettings:  { width, height, backgroundColor, snapToGrid, gridSize, nav: {...} }
```

- **`slides`** — array in playback order. Each slide:
  - `id` (string, required) — unique per slide, e.g. `"slide-1"`.
  - `name` (string, required) — shown as the clickable nav bar button
    label learners use to jump between slides. Keep it short (a couple of
    words) — it does not wrap or truncate.
  - `elements` (array, required, can be empty) — see element shape below.
    **Array order is stacking order** — first item is furthest back.

- **`canvasSettings`** — one object for the whole project (not per-slide).
  Always emit the FULL object below with every key present, even if using
  defaults — omitting individual keys (other than `nav`, which defaults
  cleanly on its own) can leave settings undefined instead of falling back
  to a default.

  ```json
  {
    "width": 1920,
    "height": 1080,
    "backgroundColor": "#ffffff",
    "snapToGrid": false,
    "gridSize": 20,
    "nav": {
      "navPosition": "bottom",
      "navGap": 12,
      "buttonColor": "#0C5E82",
      "buttonTextColor": "#ffffff",
      "buttonBottomColor": "#094A68",
      "buttonInactiveColor": "#DCEBF2",
      "buttonInactiveTextColor": "#073048",
      "buttonInactiveBottomColor": "#B8D4DF",
      "buttonFontSize": 14,
      "buttonPaddingX": 20,
      "buttonPaddingY": 8,
      "buttonRadius": 8
    }
  }
  ```

  `navPosition` is `"top"` or `"bottom"`. The `buttonBottomColor` /
  `buttonInactiveBottomColor` pair is a 3D-style bottom border on the nav
  pills — pick a color a few shades darker than the matching background
  color, not an unrelated color.

  Coordinate system: origin `(0,0)` is the **top-left** of the artboard,
  x increases right, y increases down, in the same pixel units as `width`/
  `height`. All element `x`/`y`/`width`/`height` values live in this same
  space.

### Element shape (every element, regardless of type)

```json
{
  "id": "unique-string",
  "type": "text | rect | arrow | icon",
  "name": "Human label (layer panel only, cosmetic)",
  "x": 0, "y": 0, "width": 0, "height": 0
}
```

merged with the type-specific fields below.

**On `id` — this is the most important rule in this whole document:**
give an element the SAME `id` on two different slides when you want it to
be understood as the same object continuing across the slide change — it
will visually animate (move, resize, recolor, fade) from its state on the
first slide to its state on the second, rather than the first fading out
and an unrelated second one fading in. Use a fresh, never-reused `id` for
anything that should just appear/disappear independently. This is the
entire mechanism behind the tool's name — use it deliberately per the
author's answer to the "continuity" question, not on every element and not
on none of them.

**On `x`/`y`/`width`/`height` — meaning varies by type, read carefully:**
- `text`, `rect`, `icon`: `x`,`y` is the **top-left corner** of the
  bounding box. `width`/`height` size that box.
- `arrow`: `x`,`y` is the **tail (start point)** of the arrow, NOT a
  bounding-box corner. The arrowhead lands wherever `length`/`angle`
  point from there. `width`/`height` are recomputed automatically from
  `length`/`angle` on load — still include reasonable placeholder values,
  but don't try to hand-calculate them.
- `text`: `height` is also recomputed automatically (from how the text
  wraps at the given `width`/`fontSize`) — include a reasonable value but
  it isn't authoritative.

### Type: `text`

```json
{
  "type": "text",
  "content": "The text to display",
  "fontSize": 52,
  "fontWeight": "700",
  "color": "#1f2937",
  "align": "center",
  "padding": 10,
  "lineHeight": 1.3,
  "opacity": 1
}
```
- `content`: plain text only — no bold/italic/links/markup. Use a literal
  `\n` inside the string for an intentional line break; otherwise text
  auto-wraps to fit `width`. A single word longer than the box overflows
  rather than breaking mid-word, so keep `width` realistic for the
  `fontSize` you choose.
- `fontSize`: number, 8–200.
- `fontWeight`: **string** `"400"`, `"500"`, `"600"`, `"700"`, or `"800"`
  — despite looking numeric, it must be a JSON string, not a number.
- `color`: hex string.
- `align`: `"left"`, `"center"`, `"right"`, or `"justify"`.
- `padding`: number, inner padding in px, 0–100.
- `lineHeight`: number, a MULTIPLIER of `fontSize` (e.g. `1.3`), not a
  pixel value. Range 0.8–3.
- `opacity`: number 0–1.

### Type: `rect`

```json
{
  "type": "rect",
  "fill": "#e1f6db",
  "radiusTL": 0, "radiusTR": 0, "radiusBR": 0, "radiusBL": 0,
  "opacity": 1
}
```
- `fill`: hex string. There is no separate stroke/border field — fill
  only.
- Corner radii are independent per corner, 0–300 each, automatically
  clamped so opposite corners can't overlap on a small shape.

### Type: `arrow`

```json
{
  "type": "arrow",
  "length": 200,
  "angle": 180,
  "strokeWidth": 8,
  "color": "#1f2937",
  "opacity": 1
}
```
- `length`: number, 10–1800 px.
- `angle`: number, 0–360, **compass-style**: `0` = points up, `90` =
  points right, `180` = points down, `270` = points left. This is NOT
  standard math-angle convention — double check direction against what
  the author actually wants (e.g. "an arrow pointing down-right" is
  roughly `angle: 135`).
- `strokeWidth`: number, 1–60.
- `color`: hex string. The arrowhead automatically matches this color and
  scales with `strokeWidth` — nothing extra to configure.

### Type: `icon`

```json
{
  "type": "icon",
  "iconName": "star",
  "color": "#1f2937",
  "opacity": 1
}
```
- `iconName`: **must be exactly one of** `"star"`, `"heart"`,
  `"check-circle"`, `"info"`, `"warning"`, `"flag"`, `"bookmark"`. This is
  a closed set — there is no way to use an arbitrary icon or upload an
  image. Any other value silently falls back to a star, so don't invent
  names like `"lightbulb"` or `"arrow-right"` even if they'd fit the
  content better; pick the closest available icon or use a `text` element
  with a Unicode glyph instead.
- Unlike text/arrow, `width`/`height` here ARE authoritative — they set
  the icon's rendered square size directly (defaults 80×80).

---

## Known limitations — don't design around things that aren't there

- **No images.** There is no image/media element type at all — only text,
  flat-color shapes, arrows, and the 7 fixed icons. If the author wants a
  photo or logo, tell them that's out of scope for this tool right now.
- **No rich text.** No bold/italic mixed within one text block, no
  bullet-list element, no hyperlinks. Simulate a "bulleted list" as
  several separate `text` elements if needed, or literal `\n` + manual
  bullet characters (e.g. `"• First point\n• Second point"`) inside one
  `content` string — the latter is usually cleaner.
- **No shape strokes/borders** — `rect` is fill-only.
- **No gradients** — every color field is a flat hex value.
- **No per-element animation timing/easing control** — the transition
  between two slides is a fixed engine-driven animation; the only lever
  an author has is which `id`s are shared (linked) vs. not, and where a
  linked element sits differently between slides.
- **No multi-select resize** in the source tool (not relevant to
  generated data, but relevant if the author is also editing by hand
  afterward).

---

## How to respond (final answer format)

When you have everything you need, respond with a short one-sentence
summary of what you built, then **exactly one fenced code block** containing
**exactly two lines and nothing else inside it** — this precise two-line
shape is what the tool's "Load from code" paste box parses out with a
regex, so extra prose, comments, semicolons-in-the-wrong-place, or
markdown inside the block will break the import:

```
const slides = <valid JSON array, no trailing commas, no comments>;
const canvasSettings = <valid JSON object, no trailing commas, no comments>;
```

Each line must be valid, complete, minified-or-not JSON assigned to that
exact variable name, terminated with a semicolon. Double-check brackets
balance and every `id` you intended to link is spelled identically across
slides before finalizing. After the code block, remind the author: paste
this into "Load from code" in the tool, then click Save and give the
project a name — imported content is not saved automatically.

See `example.txt` in this folder for a fully worked two-slide instance of
this exact output shape (including one linked element and one
non-linked-per-slide element), and `schema-reference.json` for the same
data model in machine-readable form.
