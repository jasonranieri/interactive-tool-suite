# HANDOFF.md

A snapshot of exactly where this project stood at the end of the last
work session — for a new session to pick up without the full
conversation history. This file is disposable: rewrite it (don't append
to it) at the end of each work session. For durable architecture,
conventions, and the deployment pipeline checklist, see `CLAUDE.md`
instead — this file only covers what's transient.

## Not yet confirmed by the person (do this first if picking this back up)

Everything below was verified working via local browser preview (serving
the repo directly and driving it with Playwright — see CLAUDE.md's
"Local preview" section). **Nothing has touched Apps Script for real** —
the deployed `AppScript/TabbedPanels.html` + module files exist and went
through the 5-substitution pass, and the `PAGES` entry is uncommented,
but none of it has actually been pasted into a live Apps Script project
yet. Before treating Tabbed Panels as done: paste
`AppScript/TabbedPanels.html`, `TabTypesJs.html`, `RichtextEditorJs.html`,
`BlockRendererJs.html`, `TabNavJs.html`, `TabManagerJs.html` into the
Apps Script editor (it already has `HistoryJs.html` — Tabbed Panels
reuses that one as-is), redeploy, and do a real Save/Open/Rename/Delete
round-trip, plus click through the Export flow once for real.

## What's built across this project's sessions on Tabbed Panels

**Session 1** (scaffolding): resolved the open design questions
(block-schema content model, hand-rolled rich text, block types), built
the original `tools/tabbed-panels/` scaffold, smoke-tested it.

**Session 2** (Apps Script deployment): generated `AppScript/
TabbedPanels.html` + module wrapper files via the 5-substitution pass,
uncommented the `PAGES` entry, opened PR #7.

**Session 3** (this one — canvas redesign + new components, in response
to a supplied mockup): a substantial rework, all pushed to PR #7's
branch as follow-up commits.

- **Canvas redesign**: the authoring canvas is now a white "player card"
  on a gray stage, with a genuinely WYSIWYG tab strip (underline +
  overflow chevrons) — see CLAUDE.md's "Internal architecture" for the
  new `tab-nav.js` module this required (mirrors `nav-bar.js`'s "reused
  verbatim by editor and export" role). Tab add/rename/delete/reorder
  moved out of the canvas entirely into a new Tabs drawer, since the
  WYSIWYG strip only shows what a learner would actually see.
- **New block types**: Badge (label + primary/secondary) and Table
  (add/remove rows and columns in the property panel, plain-text cells).
- **Heading changes**: levels expanded to h2/h3/h4, plus an optional
  `subtitle` field (settled as a field on Heading rather than a separate
  block type — see the clarifying-questions exchange in conversation).
- **Paragraph changes**: added a text-align field (left/center/right/
  justify).
- **New global Styles drawer**: heading/subtitle size+colour, and
  badge/button primary+secondary colour tables (background/text/border)
  — a new `styles` object on project state (`defaultStyles()` in
  `tab-manager.js`), read by `block-renderer.js` as a parameter so
  a block only ever picks a *variant*, never a literal colour.
- **Export built**: self-contained HTML bundle, same pattern as v2's
  Export modal — fetches `tab-types.js`/`block-renderer.js`/`tab-nav.js`
  in the repo-source version, embeds them as `MODULE_SOURCES` string
  constants in the Apps-Script-deployed copy (generated programmatically
  from the real files, not hand-typed, to avoid escaping mistakes).
- **Real bug found and fixed via Playwright smoke testing**: the block
  property panel would go blank after the very first block selection in
  a session (`openPanel()` called `closePanel()`, whose "deselect if we
  were on the property panel" check read the *stale* `activePanel` from
  before the switch). Fixed by splitting the panel-hiding DOM work
  (`hidePanels()`) out from the state-clearing `closePanel()`. Applied
  to both the repo source and the deployed copy, then re-verified with
  the exact repro sequence.
- **Another real bug fixed proactively** (not from smoke testing, caught
  during the styles/tab-manager rewrite): `getState()`/`setState()`
  previously shallow-copied blocks (`{...block}`), which doesn't protect
  nested arrays — `list.items` and (new) `table.rows` would share the
  same array reference between an undo snapshot and the live block, so
  editing the live block could silently corrupt an already-pushed undo
  entry. Fixed with a `cloneBlock()` JSON round-trip.

Every UI change in this session was verified via two rounds of
Playwright smoke testing (initial pass across all 10 checks, then a
targeted re-test of the exact bug-repro sequence after the fix) — see
this session's conversation for the full checklist; both passed clean
on the second round.

**Session 4** (this one — follow-up request, still PR #7): replaced the
Tabs drawer with a persistent bottom tab bar, and extended the Styles
drawer with layout controls.

- **Bottom tab bar** (`#editor-tab-bar`) replaces the side "Tabs"
  drawer entirely — same role and layout as v2's `#editor-slide-bar`:
  one live-content thumbnail per tab (`renderTabThumbnail()` reuses the
  same `renderBlock()` the canvas uses, scaled down via CSS `transform`,
  mirroring v2's `renderSlideThumbnailSVG()` trick), hover-revealed
  duplicate/delete buttons, double-click-to-rename, native HTML5
  drag-to-reorder, and a "+ Tab" button. The left rail's "Manage tabs"
  icon is gone; the top tab-nav strip inside the player card now only
  ever switches tabs.
- **Styles drawer gained two sections**: "Layout" (a single "Spacing
  between blocks" field — `styles.blockSpacing`, applied by setting
  `#block-list`'s `style.gap` directly) and "Tab label" (font size +
  vertical/horizontal padding — `styles.tabLabel`, passed to
  `tab-nav.js`'s `renderTabNav()` as an optional `tabLabelStyle` param
  and applied as inline styles on each `.tp-tabnav-tab` button).
- Regenerated `AppScript/TabbedPanels.html`, `TabManagerJs.html`,
  `TabNavJs.html` to match (including the `MODULE_SOURCES` Export
  embedding, which needed the updated `tab-nav.js` re-baked in).
- **Verified via a 10-point Playwright smoke test, passed clean on the
  first round** — no bugs found this time (unlike session 3, which
  found two real ones). Covered: left-rail button count, bottom bar
  existence/thumbnails, add/switch-tab, thumbnail content reflecting
  live edits, hover-reveal duplicate/delete, duplicate producing a
  correctly-named copy, rename propagating to both the thumbnail label
  and the active tab-nav strip, drag-reorder actually reordering the
  DOM, and both new Styles fields (spacing, tab label font size) driving
  real computed-style changes on `#block-list` and `.tp-tabnav-tab`.

**Session 5** (this one — swatch consistency + Table styling, still PR
#7): the person flagged, from a screenshot of v2's Canvas Settings
drawer, that colour swatches across the Styles drawer weren't visually
consistent, asked for hover tooltips naming what each swatch recolours,
and asked how to add Table styling without overloading the panel.

- **Real bug found and fixed**: Badge/Button colour-table swatches had
  never gotten the same sizing/rounding CSS rule the Headings/Subtitle
  swatches had — they rendered as the unstyled native browser colour
  input. Not a mockup mismatch, a genuine gap from when the colour-table
  section was first built. Fixed by extending the shared selector.
- **Hover tooltips added**: every swatch now has a `title` attribute
  naming exactly what it recolours (e.g. "Background — Bordered").
- **Table styling**: added as a global variant (`style`: bordered/plain
  on the Table block, same pattern as Badge/Button) rather than raw
  per-instance colour pickers — the person explicitly chose this option
  when asked, specifically to avoid the property panel growing without
  bound as more block types gain styling. `renderVariantColourTable()`
  was generalized to take a `variants` param so Badges/Buttons/Tables
  all share one function.
- **Verified via an 8-point Playwright smoke test, passed clean on the
  first round** — swatch sizing/tooltips confirmed identical across all
  three sections, the new Tables colour-table structurally matches
  Badges/Buttons, and changing a Tables swatch colour live-updated an
  actual rendered table's header in the canvas.
- **Backlog item logged, not started**: the person wants the same
  swatch-consistency treatment (and likely the same tooltip pattern)
  applied to Animated Slides v2's Canvas Settings drawer — explicitly
  deferred as separate future work, not bundled into this session.

## What's next

1. **Do the real Apps Script round-trip** described above — still the
   single most important unverified thing.
2. **v2 Canvas Settings swatch consistency audit** — the backlog item
   from this session. Not started; needs its own look at
   `tools/animated-slides-v2/index.html`'s settings-panel CSS/JS.
3. Everything under "What's NOT built yet" in CLAUDE.md's Tabbed Panels
   section: touch/tablet drag-and-drop, accessibility pass, narrow-window
   layout — standing gaps carried over from v2, not yet looked at here.
4. Nothing else is currently flagged as missing from the reviewed scope
   — the next likely direction is either the Apps Script verification
   above, the v2 audit, or new feature requests from the person.

## Older, still-outstanding items from earlier in the project

- GitHub → Apps Script auto-deploy via `clasp` — deferred at project
  start, never revisited. Now genuinely two tools' worth of
  `AppScript/*.html` files to hand-sync, worth revisiting sooner rather
  than later.

## Where to find things

`CLAUDE.md` has the architecture (including Tabbed Panels' full internal
architecture, the project-wide styles system, and content-model
decisions), conventions, the Apps Script deployment pipeline checklist,
and the local-preview workflow.
