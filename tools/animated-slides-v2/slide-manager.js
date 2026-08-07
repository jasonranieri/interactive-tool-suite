/* ==========================================================================
   Animated Slides v2 — Slide Manager
   Owns the multi-slide project state and the actual "animated slides"
   mechanic: switching slides diffs element IDs between the old and new
   slide — elements present in both animate to their new state, elements
   only in the old slide fade out, elements only in the new slide fade in.

   Layer order (z-index / stacking) is just the order of a slide's
   `elements` array — no separate concept to maintain. Reordering layers
   IS reordering that array; DOM order is kept in sync with it after every
   transition.

   `elements` / `nodes` (id -> data / id -> node) always describe the
   CURRENTLY ACTIVE slide only, and are mutated in place rather than
   replaced — CanvasEditor holds a reference to these same objects, so
   mutating in place is what keeps it working across slide switches
   without needing to be reconstructed each time.
   ========================================================================== */

/**
 * Project-wide canvas settings — artboard size, background, snap-to-grid,
 * and nav bar styling (nested under `nav`, using nav-bar.js's own
 * defaults). One object for the whole project, not per-slide — the exact
 * mistake fixed in v1 was nav styling accidentally living on each slide
 * and drifting apart.
 */
function defaultCanvasSettings() {
  return {
    width: 1920, height: 1080,
    backgroundColor: '#ffffff',
    snapToGrid: false, gridSize: 20,
    nav: defaultNavStyle(),
  };
}

class SlideManager {
  /**
   * @param svg, layer     the canvas SVG root and its element layer <g>
   * @param slides         [{ id, name, elements: [data, ...] }, ...]
   * @param canvasSettings optional — defaults via defaultCanvasSettings()
   */
  constructor({ svg, layer, slides, canvasSettings }) {
    this.svg = svg;
    this.layer = layer;
    this.slides = slides;
    this.canvasSettings = canvasSettings || defaultCanvasSettings(); // mutated in place — see setState
    this.activeIndex = 0;
    this.elements = {}; // mutated in place — see class comment
    this.nodes = {};    // mutated in place
    this.editor = null; // set via attachEditor(), since CanvasEditor needs `elements`/`nodes` to already exist
    this.onSlideChange = () => {}; // hook for UI (nav bar, slide list) to refresh

    this._rebuildActiveSlide(false);
  }

  attachEditor(editor) {
    this.editor = editor;
  }

  /** Public wrapper — flushes in-progress edits on the live elements map
   *  back into slides[activeIndex].elements, without switching slides.
   *  Used by anything (like slide thumbnails) that needs slides[]
   *  to be current without triggering a transition. */
  commitActiveSlideElements() {
    this._commitActiveSlideElements();
  }

  getActiveSlide() {
    return this.slides[this.activeIndex];
  }

  /**
   * Switches to a different slide, animating the transition by default.
   * animate:false is used for undo/redo jumps and the very first render,
   * where an animated transition would be more confusing than helpful.
   */
  goToSlide(newIndex, animate = true) {
    if (newIndex === this.activeIndex || newIndex < 0 || newIndex >= this.slides.length) return;
    if (this.editor) this.editor.deselect();
    this._commitActiveSlideElements(); // persist any in-progress edits back into slides[] before switching away

    const oldIds = new Set(Object.keys(this.elements));
    const newSlide = this.slides[newIndex];
    const newIds = new Set(newSlide.elements.map((e) => e.id));

    // Elements that don't exist on the new slide: fade out and remove.
    oldIds.forEach((id) => {
      if (newIds.has(id)) return;
      const node = this.nodes[id];
      if (animate) {
        gsap.to(node.group, { opacity: 0, duration: 0.4, onComplete: () => node.group.remove() });
      } else {
        node.group.remove();
      }
      delete this.nodes[id];
      delete this.elements[id];
    });

    // Elements on the new slide, in the new slide's order — appendChild on
    // an already-attached node MOVES it, so walking them in order also
    // keeps DOM (= stacking) order correct without any separate step.
    newSlide.elements.forEach((newData) => {
      const id = newData.id;
      if (oldIds.has(id)) {
        // Persisted across the transition — update the SAME data object
        // other code (CanvasEditor, an open popup) may already hold a
        // reference to, then animate it to the new slide's values.
        const data = this.elements[id];
        Object.assign(data, newData);
        updateElementNode(this.nodes[id], data, { animate, duration: 0.8 });
      } else {
        // New on this slide.
        const data = { ...newData };
        const node = createElementNode(data);
        this.layer.appendChild(node.group);
        gsap.set(node.group, { opacity: 0 });
        if (animate) gsap.to(node.group, { opacity: 1, duration: 0.5, delay: 0.15 });
        else gsap.set(node.group, { opacity: 1 });
        this.elements[id] = data;
        this.nodes[id] = node;
        if (this.editor) this.editor.registerNode(node);
      }
      this.layer.appendChild(this.nodes[id].group);
    });

    this.activeIndex = newIndex;
    // Seed with the destination slide's REAL stored order, not null. This
    // used to be null ("starts fresh for the newly active one"), but the
    // _currentOrder() fallback for a null _activeOrder is
    // Object.keys(this.elements) — and this.elements is patched
    // incrementally above, not rebuilt, so persisted (linked) elements
    // keep whatever key position they had on the PREVIOUS slide while
    // newly-appearing elements land at the end. That silently diverged
    // from this slide's actual stored order (even though the canvas
    // itself still rendered correctly, since the loop above walks
    // newSlide.elements directly) — any drag-reorder done from the layer
    // panel right after arriving on a slide was then computed against
    // that wrong baseline and got committed back, making reorders look
    // like they randomly didn't stick or reverted after navigating.
    this._activeOrder = newSlide.elements.map((e) => e.id);
    this.onSlideChange();
  }

  /** Full, non-animated rebuild of whatever slide is at this.activeIndex —
   *  used on first load and after an undo/redo jump. */
  _rebuildActiveSlide() {
    Object.values(this.nodes).forEach((node) => node.group.remove());
    // Clear IN PLACE rather than reassigning to a new object — CanvasEditor
    // holds a reference to this exact object from construction time, and
    // reassigning `this.nodes = {}` here would silently desync the two,
    // since CanvasEditor would keep looking at the old, abandoned object.
    Object.keys(this.nodes).forEach((k) => delete this.nodes[k]);
    Object.keys(this.elements).forEach((k) => delete this.elements[k]);
    this.slides[this.activeIndex].elements.forEach((data) => {
      const d = { ...data };
      const node = createElementNode(d);
      this.layer.appendChild(node.group);
      gsap.set(node.group, { opacity: 1 });
      this.elements[d.id] = d;
      this.nodes[d.id] = node;
      if (this.editor) this.editor.registerNode(node);
    });
  }

  /** Returns the active slide's element order, reconciled against what
   *  actually exists right now: known ids keep their custom order, any id
   *  present in `elements` but missing from the stored order (added since
   *  the order was last set) gets appended, and any id no longer in
   *  `elements` (deleted) gets dropped. Without this, _activeOrder was a
   *  frozen snapshot that silently excluded anything added after a
   *  reorder — new elements existed in the live data but never made it
   *  into the committed slide array. */
  _currentOrder() {
    const liveIds = Object.keys(this.elements);
    if (!this._activeOrder) return liveIds;
    const known = this._activeOrder.filter((id) => this.elements[id]);
    const newIds = liveIds.filter((id) => !known.includes(id));
    const merged = [...known, ...newIds];
    this._activeOrder = merged;
    return merged;
  }

  _commitActiveSlideElements() {
    // `elements` order may have been changed by layer reordering — see
    // reorderLayer() — so this walks that order, not Object.values()'
    // insertion order, to keep the array the true source of truth for
    // stacking order.
    const order = this._currentOrder();
    this.slides[this.activeIndex].elements = order
      .filter((id) => this.elements[id])
      .map((id) => ({ ...this.elements[id] }));
  }

  /** Moves an element earlier/later in the active slide's stacking order.
   *  direction: -1 to move up (later = on top), 1 to move down. */
  reorderLayer(id, direction) {
    const order = this._currentOrder();
    const i = order.indexOf(id);
    // Array order is bottom-to-top (index 0 = furthest back — see class
    // comment), so moving to a LATER index is moving UP the stack. direction
    // -1 ("up") therefore needs to INCREASE the index, hence `i - direction`
    // rather than `i + direction`, which had this exactly backwards: passing
    // -1 moved the element to an earlier (lower) index, i.e. further back,
    // the opposite of what the doc comment above and the layer panel's
    // "up"/"down" buttons intended.
    const j = i - direction;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this._activeOrder = order;
    // Re-append in the new order to update actual DOM/render stacking.
    order.forEach((elId) => this.layer.appendChild(this.nodes[elId].group));
    this.onSlideChange();
  }

  /** Moves `draggedId` to sit immediately after `targetId` in the array
   *  (= immediately BEFORE it in the layer panel's displayed order, which
   *  shows top-of-stack first — the reverse of array order). Used by
   *  drag-and-drop reordering in the layer panel. */
  moveLayerBefore(draggedId, targetId) {
    const order = this._currentOrder();
    const fromIndex = order.indexOf(draggedId);
    if (fromIndex === -1 || draggedId === targetId) return;
    order.splice(fromIndex, 1);
    const targetIndex = order.indexOf(targetId); // recomputed AFTER removal, so this is correct regardless of drag direction
    if (targetIndex === -1) { order.splice(fromIndex, 0, draggedId); return; } // target vanished somehow — put it back where it was
    order.splice(targetIndex + 1, 0, draggedId);
    this._activeOrder = order;
    order.forEach((elId) => this.layer.appendChild(this.nodes[elId].group));
    this.onSlideChange();
  }

  getLayerOrder() {
    return this._currentOrder();
  }

  /** Moves a slide to a new position in the deck. Tracks the active slide
   *  by its stable id (not index) across the move, since indices shift —
   *  the same care taken in deleteSlide(). */
  reorderSlide(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= this.slides.length || toIndex < 0 || toIndex >= this.slides.length) return;
    this._commitActiveSlideElements();
    const activeSlideId = this.slides[this.activeIndex].id;

    const [moved] = this.slides.splice(fromIndex, 1);
    this.slides.splice(toIndex, 0, moved);

    this.activeIndex = this.slides.findIndex((s) => s.id === activeSlideId);
    this.onSlideChange();
  }

  addSlide(afterIndex = this.activeIndex) {
    this._commitActiveSlideElements();
    const newSlide = { id: 'slide-' + Date.now(), name: 'Slide ' + (this.slides.length + 1), elements: [] };
    this.slides.splice(afterIndex + 1, 0, newSlide);
    this.goToSlide(afterIndex + 1, false);
  }

  /** Duplicates a whole slide — every element on the copy keeps the SAME
   *  id as its counterpart on the original, so they're automatically
   *  linked (will animate between the two) without any manual re-linking.
   *  This is usually exactly what "duplicate this slide" means in
   *  practice: a continuation of the same content, not an unrelated copy. */
  duplicateSlide(index) {
    this._commitActiveSlideElements();
    const original = this.slides[index];
    const newSlide = {
      id: 'slide-' + Date.now(),
      name: original.name + ' copy',
      elements: original.elements.map((e) => ({ ...e })),
    };
    this.slides.splice(index + 1, 0, newSlide);
    this.goToSlide(index + 1, false);
  }

  deleteSlide(index) {
    if (this.slides.length <= 1) return; // never delete the last slide
    const deletingActive = index === this.activeIndex;
    this.slides.splice(index, 1);

    if (deletingActive) {
      // The active slide itself was deleted from under us — land on a
      // sensible neighbor and force a rebuild rather than animate, since
      // there's no real "from -> to" transition here.
      this.activeIndex = Math.min(index, this.slides.length - 1);
      this._activeOrder = null;
      this._rebuildActiveSlide();
    } else if (index < this.activeIndex) {
      // A slide before the one being viewed was removed — everything
      // after it shifts down by one position, but it's still the same
      // slide on screen, so just correct the index. No re-render needed.
      this.activeIndex -= 1;
    }
    // else: a slide after the active one was deleted — activeIndex and
    // what's currently rendered are both still correct as they are.

    this.onSlideChange();
  }

  /* ---- History integration: state spans every slide + which is active ---- */

  getState() {
    this._commitActiveSlideElements();
    return {
      activeIndex: this.activeIndex,
      canvasSettings: { ...this.canvasSettings, nav: { ...this.canvasSettings.nav } },
      slides: this.slides.map((s) => ({ id: s.id, name: s.name, elements: s.elements.map((e) => ({ ...e })) })),
    };
  }

  setState(snap) {
    this.slides = snap.slides.map((s) => ({ id: s.id, name: s.name, elements: s.elements.map((e) => ({ ...e })) }));

    // Mutate canvasSettings (and its nested nav object) in place rather
    // than reassign — anything holding a direct reference to either (the
    // nav bar, a settings panel) needs to see the same objects update in
    // place, not get silently orphaned. Same reference-identity issue
    // fixed earlier for elements/nodes in _rebuildActiveSlide.
    const incoming = snap.canvasSettings || defaultCanvasSettings();
    const incomingNav = incoming.nav || defaultNavStyle();
    Object.keys(this.canvasSettings).forEach((k) => { if (k !== 'nav') delete this.canvasSettings[k]; });
    Object.entries(incoming).forEach(([k, v]) => { if (k !== 'nav') this.canvasSettings[k] = v; });
    Object.keys(this.canvasSettings.nav).forEach((k) => delete this.canvasSettings.nav[k]);
    Object.assign(this.canvasSettings.nav, incomingNav);

    this.activeIndex = snap.activeIndex;
    this._activeOrder = null;
    this._rebuildActiveSlide();
    if (this.editor) this.editor.deselect();
    this.onSlideChange();
  }
}

