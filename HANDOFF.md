# HANDOFF.md

A snapshot of exactly where this project stood at the end of the last
work session — for a new session to pick up without the full
conversation history. This file is disposable: rewrite it (don't append
to it) at the end of each work session. For durable architecture,
conventions, and the deployment pipeline checklist, see `CLAUDE.md`
instead — this file only covers what's transient.

## Not yet confirmed by the person (do this first if picking this back up)

Everything below was verified working via local browser preview
(serving the repo directly and driving it with Playwright — see
CLAUDE.md's "Local preview" section) during the session, and all of it
is merged to `main`. What's **not** yet confirmed: whether it's been
pasted into the live Apps Script project and redeployed there, and
exercised for real (including Save/Load, which can't be tested in local
preview since that needs `google.script.run`). If picking this up,
paste the current `AppScript/AnimatedSlidesV2.html`, `AppScript/
NavBarJs.html`, `AppScript/SlideManagerJs.html`, and `AppScript/
CanvasEditorJs.html` into the Apps Script editor, redeploy, and do a
real save/load round-trip before treating v2 as done.

## What's built and merged this session

Picking up from an earlier session that had already shipped v2's core
feature set (schema-driven elements, undo/redo, cross-slide linking,
multi-select, project management) — this session added, in order:

- **`Code.gs` brought into the repo** — it existed only inside the live
  Apps Script project before; now checked in at `AppScript/Code.gs`. Its
  `GITHUB_OWNER`/`GITHUB_REPO` were placeholders (`your-org-or-username`
  / `authoring-tools`) that would have made every save/load/delete/
  rename call fail against a nonexistent repo — fixed to the real values.
- **"Load from code"** — a new top-bar button that parses a previously
  Exported HTML blob's embedded `const slides = ...;` / `const
  canvasSettings = ...;` lines back into an editable project. Paired with
  `tools/animated-slides-v2/ai-authoring/prompt.md` (+ `schema-
  reference.json` + `example.txt`): a self-contained prompt an author can
  paste into any LLM chat to storyboard a slide deck by answering a few
  questions, then paste the generated code block straight into the tool.
- **Bug fix**: layer reordering could silently revert after navigating
  between slides. Root cause was `goToSlide()` resetting the tracked
  stacking order to `null` on every transition, while the fallback it
  fell back to (`Object.keys(elements)`) didn't actually match the
  destination slide's real stored order once persisted/linked elements
  were involved. Fixed in `slide-manager.js` / `SlideManagerJs.html`.
- **Bug fix**: the layer panel's "bring forward" (up chevron) and "send
  backward" (down chevron) buttons were swapped — `reorderLayer()`'s
  direction math didn't match its own doc comment or the array's actual
  bottom-to-top convention. Fixed.
- **Shift-to-axis-lock dragging** — holding Shift while dragging an
  element (single or multi-select) locks movement to whichever axis has
  moved further from the drag's start, re-evaluated every frame.
- **Left rail redesign** — was a 200px column with labeled buttons and an
  always-visible layer list; now a 64px vertical stack of icon-only
  buttons (4 add-element icons, a divider, then Link/Layers/Settings).
  Layers and Settings each open their own non-blocking slide-out drawer
  (`.side-panel`) instead of the layer list always taking up rail space
  or Settings being a centered modal that covered the canvas while you
  adjusted it. Opening one drawer closes the other, since both dock to
  the same right edge.
- **Settings drawer rebuilt twice** — first pass added slide-switch
  toggles, square colour swatches, more spacing, and grouped "Button
  colors" into Active/Inactive subsections with swatches in a row. A
  second pass then rebuilt it again against a design mockup the person
  supplied, which surfaced a few real discrepancies worth remembering if
  touching this again:
  - "Navigation" and a near-identical "Button Style" section in the
    mockup turned out to be a mockup duplication, not two genuinely
    different sections — merged back into one Navigation group.
  - Snap to Grid ended up as an On/Off dropdown, not the slide switch
    from the first pass — the person changed their mind after seeing it
    in context.
  - The Active/Inactive background on/off toggles added in the first
    pass were dropped entirely — background is unconditionally shown
    again, same as before that feature existed.
  - The "Gap" (spacing between nav buttons) field was dropped from the
    settings UI specifically — `navGap` still exists in the data model
    and still drives real spacing at its default (12), it's just no
    longer author-configurable from this panel.
  - "Button colors" renamed to "Colours" (matches the "Colour, not
    Color" house convention) and rebuilt as an actual 3-row × 2-column
    table (Background/Text/Border × Active/Inactive) instead of two
    toggle-headed subgroups.
  - Every settings field group now renders through a shared 2-column CSS
    grid, and sections are separated by a divider line, not just gap
    spacing.
- **Standalone JS modules extracted** — `tools/animated-slides-v2/`
  previously only had `index.html`; the seven modules it `<script
  src>`-loads (`element-types.js`, `element-renderer.js`, `canvas-
  editor.js`, `history.js`, `slide-manager.js`, `layer-panel.js`,
  `nav-bar.js`) didn't exist anywhere as standalone files, only baked
  into the `AppScript/*Js.html` wrapper templates. Extracted verbatim, so
  `index.html` now actually boots as a real standalone page — see
  CLAUDE.md's "Local preview" section. This is also now the deployment
  source of truth going forward: edit these files first, then reapply
  the AppScript wrapper substitutions, rather than editing the
  `AppScript/*Js.html` copies directly.

All of the above is merged to `main` via PRs #1 through #5.

## What's next: Tabbed Panels

The person has said they're comfortable with v2 as it stands and wants
to start a new tool: **Tabbed Panels** (tabs the learner navigates
between; each tab holds formatted text, lists, and buttons linking out
to external webpages). Nothing has been built for this yet — no folder,
no `Code.gs` `PAGES` entry, no scaffolding. See CLAUDE.md's "Starting a
new tool: Tabbed Panels" section for the open design questions worth
resolving before writing much code (mainly: what the per-tab content
model actually is — plain rich text vs. a small block schema).

## Standing "polish" list for v2 — not started

1. Custom color pickers — the native browser color input is now a small
   restyled square swatch rather than a full-width bar, but it's still
   the native OS color picker underneath when clicked; a true custom
   picker (matching the rest of the UI) hasn't been built.
2. Icon library is thin — only 7 icons (star, heart, check-circle, info,
   warning, flag, bookmark), all hand-coded SVG paths in
   `element-renderer.js`'s `ICON_PATHS`.
3. Touch/tablet support is incomplete — layer and slide drag-to-reorder
   use native HTML5 drag-and-drop, which doesn't work on touchscreens.
   Canvas drag/selection is fine (built on pointer events, not
   mouse-specific ones).
4. Narrow-window layout untested — the canvas column doesn't have a
   defined behavior below a certain width.
5. No accessibility pass anywhere — keyboard-only navigation, focus
   states, screen-reader labels.
6. Export modal is copy-paste only, no live preview of the result.

## Known deliberate scope boundaries — not bugs, don't "fix" these

- Multi-select supports move/delete/duplicate as a group, but **not**
  resize — resizing several different-typed elements as one operation
  was explicitly descoped, not overlooked.
- A plain click (no drag) on a member of a multi-selection narrows the
  selection to just that element; click-and-drag moves the whole group.
  This was a specific, deliberate fix per an explicit request.
- `STORAGE_API_KEY` / `STORAGE_ENDPOINT` stay as plain placeholders in
  repo source files, never scriptlets — only the Apps-Script-deployed
  copies get the `<?!= ... ?>` swap. See CLAUDE.md's deployment
  pipeline section for why.
- The Active/Inactive nav-button background on/off toggle was built,
  tested, and then explicitly removed again per the person's direction
  during the settings-drawer mockup pass — don't reintroduce it as a
  "missing feature" without checking first.

## Older, still-outstanding items from earlier in the project

- GitHub → Apps Script auto-deploy via `clasp` — deferred at project
  start, never revisited. Deployment is still a fully manual copy-paste
  process into the Apps Script editor. Worth revisiting once Tabbed
  Panels exists too, since by then there'll be two tools' worth of
  `AppScript/*.html` files to keep hand-synced.

## Where to find things

`CLAUDE.md` has the architecture, conventions, the Apps Script
deployment pipeline checklist, and the local-preview workflow. Read its
"Starting a new tool: Tabbed Panels" section before writing Tabbed
Panels code — it lists the shared foundation to build on and the open
design questions worth settling first.
