/* ==========================================================================
   Tabbed Panels — Tab Manager
   Owns the project state: an ordered list of tabs, each holding an ordered
   list of blocks. No canvas/SVG/animation layer to keep in sync here (that
   complexity in Animated Slides v2's SlideManager is specific to the
   cross-slide animated-transition mechanic, which this tool doesn't have),
   so this is considerably simpler: tabs/blocks are plain data, and the
   editor just re-renders the active tab's block list on any change.

   Conventions carried over from v2 (see CLAUDE.md):
   - Tabs and blocks are tracked by stable `id`, never by array index —
     indices shift the moment an array is spliced.
   - `tabs` is mutated in place (push/splice), never reassigned, since
     history.js's setState() and anything else holding a reference to it
     needs to keep seeing the same object.
   ========================================================================== */

function defaultTab(title) {
  return { id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), title, blocks: [] };
}

/**
 * Project-wide styles — heading/subtitle typography, the badge/button
 * primary+secondary colour pairs, spacing between blocks, and the tab
 * label's own typography. One object for the whole project, not
 * per-block/per-tab: a block only ever picks a *variant* (h2/h3/h4,
 * primary/secondary); this object defines what that variant (or, for
 * blockSpacing/tabLabel, the whole layout) actually looks like. Same
 * split as v2's canvasSettings.nav Active/Inactive colours.
 */
function defaultStyles() {
  return {
    h2: { size: 28, color: '#111827' },
    h3: { size: 22, color: '#111827' },
    h4: { size: 18, color: '#111827' },
    subtitle: { size: 16, color: '#6b7280' },
    badge: {
      primary: { bg: '#2563eb', text: '#ffffff', border: '#2563eb' },
      secondary: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
    },
    button: {
      primary: { bg: '#2563eb', text: '#ffffff', border: '#2563eb' },
      secondary: { bg: '#ffffff', text: '#111827', border: '#d1d5db' },
    },
    // "Plain"'s border matches the card's white background, so the grid
    // lines read as absent rather than needing separate rendering logic
    // for "no border" — same bg/text/border shape as badge/button, so it
    // reuses the exact same colour-table UI, just with different variant
    // labels ("Bordered"/"Plain" instead of "Primary"/"Secondary").
    table: {
      bordered: { bg: '#fafaf8', text: '#111827', border: '#cbc8be' },
      plain: { bg: '#ffffff', text: '#111827', border: '#ffffff' },
    },
    blockSpacing: 12, // gap between stacked blocks in the player body, px
    tabLabel: { fontSize: 15, paddingX: 24, paddingY: 16 }, // tab-nav.js's .tp-tabnav-tab
  };
}

/** JSON-clone a block — plain-data-only, but a shallow {...b} isn't
 *  enough once a block can hold nested data (table.rows is an array of
 *  arrays; list.items is an array). Without this, undo/redo snapshots and
 *  the live block would share the same nested array reference, so
 *  editing one would silently corrupt the "before" snapshot on the undo
 *  stack. */
function cloneBlock(b) { return JSON.parse(JSON.stringify(b)); }

class TabManager {
  /**
   * @param tabs   [{ id, title, blocks: [{id, type, ...fields}, ...] }, ...]
   * @param styles optional — defaults via defaultStyles()
   */
  constructor({ tabs, styles }) {
    this.tabs = tabs && tabs.length ? tabs : [defaultTab('Tab 1')];
    this.activeTabId = this.tabs[0].id;
    this.styles = styles || defaultStyles(); // mutated in place — see setState
    this.onChange = () => {}; // hook for UI (tab strip, block list, property panel) to refresh
  }

  getActiveTab() {
    return this.tabs.find((t) => t.id === this.activeTabId) || this.tabs[0];
  }

  setActiveTab(id) {
    if (!this.tabs.some((t) => t.id === id) || id === this.activeTabId) return;
    this.activeTabId = id;
    this.onChange();
  }

  /* ---- Tabs ---- */

  addTab(afterId = this.activeTabId) {
    const tab = defaultTab('Tab ' + (this.tabs.length + 1));
    const i = this.tabs.findIndex((t) => t.id === afterId);
    this.tabs.splice(i + 1, 0, tab);
    this.activeTabId = tab.id;
    this.onChange();
    return tab.id;
  }

  duplicateTab(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const original = this.tabs[i];
    const copy = {
      id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      title: original.title + ' copy',
      blocks: original.blocks.map(cloneBlock),
    };
    this.tabs.splice(i + 1, 0, copy);
    this.activeTabId = copy.id;
    this.onChange();
  }

  renameTab(id, title) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !title) return;
    tab.title = title;
    this.onChange();
  }

  deleteTab(id) {
    if (this.tabs.length <= 1) return; // never delete the last tab
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const deletingActive = id === this.activeTabId;
    this.tabs.splice(i, 1);
    if (deletingActive) {
      this.activeTabId = this.tabs[Math.min(i, this.tabs.length - 1)].id;
    }
    this.onChange();
  }

  /** Moves a tab to sit immediately after `targetId` (drag-and-drop reorder
   *  in the tab strip). No-op-safe against a vanished target. */
  moveTabAfter(draggedId, targetId) {
    const from = this.tabs.findIndex((t) => t.id === draggedId);
    if (from === -1 || draggedId === targetId) return;
    const [moved] = this.tabs.splice(from, 1);
    const targetIndex = this.tabs.findIndex((t) => t.id === targetId);
    if (targetIndex === -1) { this.tabs.splice(from, 0, moved); return; }
    this.tabs.splice(targetIndex + 1, 0, moved);
    this.onChange();
  }

  /* ---- Blocks (within the active tab) ---- */

  addBlock(type, afterBlockId = null) {
    const tab = this.getActiveTab();
    const id = 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const block = makeDefaultBlock(type, id);
    const i = afterBlockId ? tab.blocks.findIndex((b) => b.id === afterBlockId) : tab.blocks.length - 1;
    tab.blocks.splice(i + 1, 0, block);
    this.onChange();
    return id;
  }

  updateBlock(blockId, patch) {
    const tab = this.getActiveTab();
    const block = tab.blocks.find((b) => b.id === blockId);
    if (!block) return;
    Object.assign(block, patch);
    this.onChange();
  }

  deleteBlock(blockId) {
    const tab = this.getActiveTab();
    const i = tab.blocks.findIndex((b) => b.id === blockId);
    if (i === -1) return;
    tab.blocks.splice(i, 1);
    this.onChange();
  }

  /** Moves `draggedId` to sit immediately after `targetId` within the
   *  active tab's blocks — same drag-and-drop reorder pattern as
   *  moveTabAfter(), one level down. `targetId === null` moves it to the
   *  very front. */
  moveBlockAfter(draggedId, targetId) {
    const tab = this.getActiveTab();
    const from = tab.blocks.findIndex((b) => b.id === draggedId);
    if (from === -1 || draggedId === targetId) return;
    const [moved] = tab.blocks.splice(from, 1);
    if (targetId === null) { tab.blocks.unshift(moved); this.onChange(); return; }
    const targetIndex = tab.blocks.findIndex((b) => b.id === targetId);
    if (targetIndex === -1) { tab.blocks.splice(from, 0, moved); return; }
    tab.blocks.splice(targetIndex + 1, 0, moved);
    this.onChange();
  }

  /* ---- History integration: state spans every tab + which is active ---- */

  getState() {
    return {
      activeTabId: this.activeTabId,
      tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, blocks: t.blocks.map(cloneBlock) })),
      styles: JSON.parse(JSON.stringify(this.styles)),
    };
  }

  setState(snap) {
    // Mutate `tabs` in place rather than reassign — same reference-identity
    // reasoning as slide-manager.js's setState(): anything holding a direct
    // reference to this array needs to see it update in place.
    this.tabs.length = 0;
    snap.tabs.forEach((t) => this.tabs.push({ id: t.id, title: t.title, blocks: t.blocks.map(cloneBlock) }));
    this.activeTabId = this.tabs.some((t) => t.id === snap.activeTabId) ? snap.activeTabId : this.tabs[0].id;

    // Same in-place-mutation reasoning for `styles`. Backfill any keys
    // missing from an older saved project (e.g. a group added after that
    // project was last saved) with their defaults, same pattern as v2's
    // renderSettingsModal() backfilling nav keys, so the styles panel
    // reflects the actual effective value instead of reading as unset.
    const incoming = snap.styles || defaultStyles();
    const defaults = defaultStyles();
    Object.keys(this.styles).forEach((k) => delete this.styles[k]);
    Object.keys(defaults).forEach((k) => {
      this.styles[k] = incoming[k] !== undefined ? incoming[k] : defaults[k];
    });

    this.onChange();
  }
}
