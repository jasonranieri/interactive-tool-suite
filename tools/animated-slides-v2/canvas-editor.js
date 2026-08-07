/* ==========================================================================
   Animated Slides v2 — Canvas Editor
   Selection (including multi-select), drag-to-move, resize handles, and
   the floating contextual properties popup. Sits entirely ON TOP of
   element-renderer.js — never modifies it, only reads/writes the same
   element `data` objects and calls updateElementNode() to reflect
   changes. This is what keeps the renderer reusable unchanged inside the
   exported player, which has none of this.

   MULTI-SELECT: Shift or Cmd/Ctrl+click adds to the selection; clicking an
   already-selected element with a modifier held removes it. Multiple
   selected elements move together as a rigid group and can be deleted or
   duplicated together, but resizing and the full properties popup stay
   single-element only — resizing several different-typed elements as one
   operation isn't supported, so with 2+ selected the popup becomes a
   small "N selected" toolbar (Duplicate/Delete) instead.

   Coordinate handling: every pointer interaction converts screen (mouse)
   coordinates to the SVG's own user-space coordinates via
   svg.getScreenCTM().inverse() — the robust, browser-native way to do this
   regardless of how the SVG is scaled on screen. Given this project's
   history with viewBox-scaling bugs, this is deliberately NOT done via any
   manual scale-factor guessing.
   ========================================================================== */

function screenToSVGPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

class CanvasEditor {
  /**
   * @param svg       the root <svg> element
   * @param elements  { id: data } — the live element data objects
   * @param nodes     { id: node } — the corresponding renderer nodes
   * @param popupHost a DOM element the floating popup gets appended to
   *                  (should cover the same area as the canvas, positioned
   *                  relative, so the popup can be absolutely positioned
   *                  within it using screen coordinates)
   * @param onChange  called with (data) whenever a field or drag changes
   *                  something — hook for autosave/dirty-state elsewhere
   * @param onSelect  called with an array of currently-selected ids
   */
  constructor({ svg, elements, nodes, popupHost, onChange = () => {}, onSelect = () => {}, history = null, getCanvasSettings = () => null }) {
    this.svg = svg;
    this.elements = elements;
    this.nodes = nodes;
    this.popupHost = popupHost;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.history = history;
    // A getter, not a captured object — canvasSettings can be replaced
    // wholesale on load/undo, so reading it fresh each time avoids the
    // same staleness problem fixed for elements/nodes earlier.
    this.getCanvasSettings = getCanvasSettings;
    this.selectedIds = new Set();
    this.handleLayer = null;
    this._multiHandleLayers = [];
    this.popupEl = null;
    this.drag = null; // active drag/resize state, or null

    this.svg.addEventListener('pointerdown', (e) => {
      if (e.target === this.svg) this._startMarquee(e);
    });

    Object.values(nodes).forEach((node) => this._attachSelection(node));

    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', () => this._onPointerUp());
    window.addEventListener('keydown', (e) => {
      // Don't hijack keys while someone's typing in the popup — only
      // treat these as canvas shortcuts when focus isn't on a text-
      // editing control.
      const tag = document.activeElement && document.activeElement.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isTyping || this.selectedIds.size === 0) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected();
        return;
      }

      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'd') {
        e.preventDefault(); // otherwise the browser's own "bookmark this page" fires
        this.duplicateSelected();
        return;
      }

      const nudgeMap = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (nudgeMap[e.key]) {
        e.preventDefault();
        const [dx, dy] = nudgeMap[e.key];
        const step = e.shiftKey ? 10 : 1; // Shift = bigger nudge, same convention as most design tools
        this.nudgeSelected(dx * step, dy * step);
      }
    });
  }

  /** The "primary" selected id — the most recently selected one. Used
   *  wherever exactly one id is needed (the single-element popup, drag
   *  anchoring). Returns null when nothing is selected. */
  get selectedId() {
    if (this.selectedIds.size === 0) return null;
    return [...this.selectedIds][this.selectedIds.size - 1];
  }

  /** Clones every selected element a short offset away and selects the
   *  copies — undoable, same as everything else. */
  duplicateSelected() {
    if (this.selectedIds.size === 0) return;
    const ids = [...this.selectedIds];
    if (this.history) this.history.beginAction();
    const layer = this.svg.querySelector('#elements-layer');
    const newIds = [];
    ids.forEach((id, i) => {
      const original = this.elements[id];
      const newId = original.type + '-' + Date.now() + '-' + i + '-' + Math.floor(Math.random() * 1000);
      const clone = { ...original, id: newId, x: original.x + 24, y: original.y + 24 };
      if (clone.name) clone.name = clone.name + ' copy';
      const node = createElementNode(clone);
      layer.appendChild(node.group);
      gsap.to(node.group, { opacity: 1, duration: 0.3 });
      this.elements[newId] = clone;
      this.nodes[newId] = node;
      this.registerNode(node);
      newIds.push(newId);
    });
    if (this.history) this.history.commitAction();
    this.onChange({ duplicatedIds: newIds });
    this.selectedIds = new Set(newIds);
    this._renderHandles();
    this._renderPopup();
    this.onSelect([...this.selectedIds]);
  }

  /** Nudges every selected element by (dx, dy) — a single undo step per
   *  key press, same pattern as a field commit. */
  nudgeSelected(dx, dy) {
    if (this.selectedIds.size === 0) return;
    if (this.history) this.history.beginAction();
    this.selectedIds.forEach((id) => {
      const data = this.elements[id];
      if (!data) return;
      data.x += dx;
      data.y += dy;
      updateElementNode(this.nodes[id], data, { animate: false });
    });
    this._renderHandles();
    this._syncPopupFields();
    if (this.history) this.history.commitAction();
    this.onChange({});
  }

  /** Removes every selected element entirely — from the canvas, the live
   *  data/node maps, and (via history) is undoable as one step. */
  deleteSelected() {
    if (this.selectedIds.size === 0) return;
    const ids = [...this.selectedIds];
    if (this.history) this.history.beginAction();
    ids.forEach((id) => {
      const node = this.nodes[id];
      if (node) node.group.remove();
      delete this.nodes[id];
      delete this.elements[id];
    });
    this.deselect();
    if (this.history) this.history.commitAction();
    this.onChange({ deletedIds: ids });
  }

  _attachSelection(node) {
    node.group.style.cursor = 'move';
    node.group.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const id = node.group.getAttribute('id');
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;

      if (additive && this.selectedIds.has(id)) {
        // Clicking an already-selected element with a modifier held toggles it off.
        this.selectedIds.delete(id);
        this._renderHandles();
        this._renderPopup();
        this.onSelect([...this.selectedIds]);
        return;
      }

      if (!additive && this.selectedIds.has(id) && this.selectedIds.size > 1) {
        // A plain click landed on an element that's already part of a
        // multi-selection — keep the whole group selected and start
        // dragging it together, rather than collapsing down to just this
        // one. This is what lets you grab ANY selected element to move
        // the group, not just whichever one you originally shift-clicked.
        // If it turns out there's no real drag (just a click), pointerup
        // narrows the selection down to this element instead — see
        // narrowCandidate handling in _onPointerMove/_onPointerUp.
        this._startDrag(e, { type: 'move', id });
        this.drag.narrowCandidate = id;
        return;
      }

      this.select(id, { additive });
      this._startDrag(e, { type: 'move', id });
    });

    const id = node.group.getAttribute('id');
    const hoverOutline = document.createElementNS(svgNS, 'rect');
    hoverOutline.setAttribute('fill', 'none');
    hoverOutline.setAttribute('stroke', '#8A9291');
    hoverOutline.setAttribute('stroke-width', 1.5);
    hoverOutline.setAttribute('pointer-events', 'none');
    hoverOutline.style.display = 'none';
    node.group.appendChild(hoverOutline);
    node._hoverOutline = hoverOutline;

    node.group.addEventListener('pointerenter', () => {
      if (this.drag || this.selectedIds.has(id)) return;
      const box = this._getLocalBBox(this.elements[id]);
      hoverOutline.setAttribute('x', box.x);
      hoverOutline.setAttribute('y', box.y);
      hoverOutline.setAttribute('width', box.width);
      hoverOutline.setAttribute('height', box.height);
      hoverOutline.style.display = '';
    });
    node.group.addEventListener('pointerleave', () => {
      hoverOutline.style.display = 'none';
    });
  }

  /** Local (group-relative) bounding box for a given element's data —
   *  used by both the hover outline and resize-handle placement. Arrows
   *  need real min/max math since their line can extend in any direction
   *  from the origin, not just down-right. */
  _getLocalBBox(data) {
    if (data.type === 'arrow') {
      const angleRad = (data.angle || 0) * Math.PI / 180;
      const x2 = (data.length || 200) * Math.sin(angleRad);
      const y2 = -(data.length || 200) * Math.cos(angleRad);
      const pad = (data.strokeWidth || 8) / 2;
      return {
        x: Math.min(0, x2) - pad, y: Math.min(0, y2) - pad,
        width: Math.abs(x2) + pad * 2, height: Math.abs(y2) + pad * 2,
      };
    }
    return { x: 0, y: 0, width: data.width, height: data.height };
  }

  /** @param options.additive  true (Shift/Cmd/Ctrl held) adds to the
   *  current selection instead of replacing it. */
  select(id, { additive = false } = {}) {
    try {
      if (!additive) {
        this.selectedIds.forEach((sid) => {
          if (this.nodes[sid] && this.nodes[sid]._hoverOutline) this.nodes[sid]._hoverOutline.style.display = 'none';
        });
        this.selectedIds.clear();
      }
      this.selectedIds.add(id);
      if (this.nodes[id] && this.nodes[id]._hoverOutline) this.nodes[id]._hoverOutline.style.display = 'none';
      this._renderHandles();
      this._renderPopup();
      this.onSelect([...this.selectedIds]);
    } catch (err) {
      // Caught (not left uncaught) so the real error reaches the console
      // with its actual message/stack — an uncaught error bubbling
      // through GSAP's cross-origin code gets reported by the browser as
      // an opaque "Script error." with no detail otherwise.
      console.error('CanvasEditor.select failed for id=' + id, err);
    }
  }

  deselect() {
    this.selectedIds.clear();
    this._clearHandles();
    this._clearPopup();
    this.onSelect([]);
  }

  /** Attaches selection/hover behavior to a node created outside the
   *  editor's own lifecycle — e.g. by SlideManager when an element first
   *  appears on a slide during a transition. */
  registerNode(node) {
    this._attachSelection(node);
  }

  /** Re-renders handles and the popup for whatever's currently selected —
   *  for external callers (like History.setState after an undo/redo) that
   *  changed element data without going through the editor's own drag/
   *  field-edit paths. No-op if nothing is selected. */
  refreshSelection() {
    if (this.selectedIds.size === 0) return;
    this._renderHandles();
    this._renderPopup();
  }

  /** Starts a rubber-band selection drag from a pointerdown on empty
   *  canvas. Resolved on pointerup: if the pointer barely moved, it's
   *  treated as a plain click (deselect); otherwise every element whose
   *  bounding box overlaps the dragged rectangle gets selected. */
  _startMarquee(e) {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const startSVG = screenToSVGPoint(this.svg, e.clientX, e.clientY);
    this.marqueeDrag = { startSVG, additive, moved: false };
    if (!this._marqueeRect) {
      this._marqueeRect = document.createElementNS(svgNS, 'rect');
      this._marqueeRect.setAttribute('fill', 'rgba(12,94,130,0.1)');
      this._marqueeRect.setAttribute('stroke', '#0C5E82');
      this._marqueeRect.setAttribute('stroke-width', 1);
      this._marqueeRect.setAttribute('stroke-dasharray', '4 3');
      this._marqueeRect.setAttribute('pointer-events', 'none');
      this._marqueeRect.style.display = 'none';
      this.svg.appendChild(this._marqueeRect);
    }
  }

  _updateMarquee(e) {
    const pt = screenToSVGPoint(this.svg, e.clientX, e.clientY);
    const start = this.marqueeDrag.startSVG;
    const x = Math.min(pt.x, start.x);
    const y = Math.min(pt.y, start.y);
    const w = Math.abs(pt.x - start.x);
    const h = Math.abs(pt.y - start.y);
    if (w > 2 || h > 2) this.marqueeDrag.moved = true;
    this._marqueeRect.setAttribute('x', x);
    this._marqueeRect.setAttribute('y', y);
    this._marqueeRect.setAttribute('width', w);
    this._marqueeRect.setAttribute('height', h);
    this._marqueeRect.style.display = '';
  }

  _finishMarquee() {
    const { additive, moved } = this.marqueeDrag;
    this._marqueeRect.style.display = 'none';

    if (!moved) {
      // No real drag happened — this was just a click on empty canvas.
      if (!additive) this.deselect();
      this.marqueeDrag = null;
      return;
    }

    const mx = parseFloat(this._marqueeRect.getAttribute('x'));
    const my = parseFloat(this._marqueeRect.getAttribute('y'));
    const mw = parseFloat(this._marqueeRect.getAttribute('width'));
    const mh = parseFloat(this._marqueeRect.getAttribute('height'));

    const hits = Object.keys(this.elements).filter((id) => {
      const box = this._getAbsoluteBBox(id);
      return !(box.x > mx + mw || box.x + box.width < mx || box.y > my + mh || box.y + box.height < my);
    });

    if (!additive) this.selectedIds.clear();
    hits.forEach((id) => this.selectedIds.add(id));
    this._renderHandles();
    this._renderPopup();
    this.onSelect([...this.selectedIds]);
    this.marqueeDrag = null;
  }

  /** Bounding box in absolute (SVG user-space) coordinates — _getLocalBBox
   *  is relative to the element's own group, which is what the marquee
   *  hit-test needs converted into the same space the marquee rect lives in. */
  _getAbsoluteBBox(id) {
    const data = this.elements[id];
    const local = this._getLocalBBox(data);
    return { x: data.x + local.x, y: data.y + local.y, width: local.width, height: local.height };
  }

  _startDrag(e, info) {
    if (this.history) this.history.beginAction();
    const svgPt = screenToSVGPoint(this.svg, e.clientX, e.clientY);
    const data = this.elements[info.id];
    this.drag = {
      ...info,
      startSVG: svgPt,
      startData: { x: data.x, y: data.y, width: data.width, height: data.height,
                   length: data.length, angle: data.angle },
      // For a multi-select move, every selected element's starting
      // position — moved together as a rigid group, all snapping in sync
      // with whichever one was actually grabbed.
      multiStart: (info.type === 'move' && this.selectedIds.size > 1)
        ? [...this.selectedIds].map((sid) => ({ id: sid, x: this.elements[sid].x, y: this.elements[sid].y }))
        : null,
    };
  }

  _onPointerMove(e) {
    if (this.marqueeDrag) { this._updateMarquee(e); return; }
    if (!this.drag) return;
    const data = this.elements[this.drag.id];
    const node = this.nodes[this.drag.id];
    const svgPt = screenToSVGPoint(this.svg, e.clientX, e.clientY);
    const dx = svgPt.x - this.drag.startSVG.x;
    const dy = svgPt.y - this.drag.startSVG.y;

    if (this.drag.narrowCandidate && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      // Real movement happened — this is a genuine drag of the group, not
      // a plain click, so don't narrow the selection down on release.
      this.drag.narrowCandidate = null;
    }

    // Shift while moving locks the drag to whichever axis has moved
    // further from the drag's start point — horizontal-only or
    // vertical-only, decided fresh each frame so crossing the diagonal
    // partway through a drag can still flip which axis is locked.
    let moveDx = dx, moveDy = dy;
    if (this.drag.type === 'move' && e.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) moveDy = 0;
      else moveDx = 0;
    }

    if (this.drag.type === 'move' && this.drag.multiStart) {
      // Snap the grabbed element's new position, derive the actual delta
      // that resulted, then apply that SAME delta to everything else
      // selected — keeps the group's relative layout intact rather than
      // snapping each element to the grid independently.
      const anchor = this.drag.multiStart.find((m) => m.id === this.drag.id);
      const snappedX = this._snap(anchor.x + moveDx);
      const snappedY = this._snap(anchor.y + moveDy);
      const appliedDx = snappedX - anchor.x;
      const appliedDy = snappedY - anchor.y;
      this.drag.multiStart.forEach((m) => {
        const d = this.elements[m.id];
        if (!d) return;
        d.x = m.x + appliedDx;
        d.y = m.y + appliedDy;
        updateElementNode(this.nodes[m.id], d, { animate: false });
      });
      this._renderHandles();
      this.onChange({});
      return;
    }

    if (this.drag.type === 'move') {
      data.x = this._snap(this.drag.startData.x + moveDx);
      data.y = this._snap(this.drag.startData.y + moveDy);
    } else if (this.drag.type === 'resize') {
      this._applyResize(data, dx, dy, this.drag.corner);
    } else if (this.drag.type === 'arrow-tip') {
      // Dragging the arrowhead directly sets length+angle from the vector,
      // rather than requiring two separate numeric edits.
      const vx = this.drag.startData.x2 + dx;
      const vy = this.drag.startData.y2 + dy;
      data.length = Math.round(Math.max(10, Math.hypot(vx, vy)));
      let deg = Math.atan2(vx, -vy) * 180 / Math.PI; // inverse of applyArrowStyle's angle math
      if (deg < 0) deg += 360;
      data.angle = Math.round(deg);
    }

    updateElementNode(node, data, { animate: false });
    this._renderHandles(); // handle positions track width/height/length changes
    this._syncPopupFields();
    this.onChange(data);
  }

  _onPointerUp() {
    if (this.marqueeDrag) { this._finishMarquee(); return; }
    if (!this.drag) return;
    const narrowTo = this.drag.narrowCandidate;
    if (this.history) this.history.commitAction();
    this.drag = null;
    if (narrowTo) this.select(narrowTo); // was a plain click on a multi-selected element, no real drag — narrow to just this one
  }

  /** Rounds to whole numbers always, and additionally to the nearest grid
   *  increment when snap-to-grid is on (a project-wide canvas setting). */
  _snap(value) {
    const cs = this.getCanvasSettings();
    if (cs && cs.snapToGrid) {
      const g = cs.gridSize || 20;
      return Math.round(value / g) * g;
    }
    return Math.round(value);
  }

  _applyResize(data, dx, dy, corner) {
    const s = this.drag.startData;
    if (corner === 'right') { // text's single width handle
      data.width = this._snap(Math.max(50, s.width + dx));
      return;
    }
    let newX = s.x, newY = s.y, newW = s.width, newH = s.height;
    if (corner.includes('right')) newW = Math.max(20, s.width + dx);
    if (corner.includes('left'))  { newW = Math.max(20, s.width - dx); newX = s.x + dx; }
    if (corner.includes('bottom')) newH = Math.max(20, s.height + dy);
    if (corner.includes('top'))    { newH = Math.max(20, s.height - dy); newY = s.y + dy; }
    data.x = this._snap(newX); data.y = this._snap(newY);
    data.width = this._snap(newW); data.height = this._snap(newH);
  }

  /* ---- Selection outline + resize handles ---- */

  _clearHandles() {
    if (this.handleLayer) { this.handleLayer.remove(); this.handleLayer = null; }
    this._multiHandleLayers.forEach((l) => l.remove());
    this._multiHandleLayers = [];
  }

  _renderHandles() {
    this._clearHandles();
    if (this.selectedIds.size === 0) return;

    if (this.selectedIds.size > 1) {
      // Multi-select: a plain outline per selected element, no resize
      // handles — resizing several different-typed elements as one
      // operation isn't supported.
      this.selectedIds.forEach((id) => {
        const data = this.elements[id];
        const node = this.nodes[id];
        if (!data || !node) return;
        const box = this._getLocalBBox(data);
        const layer = document.createElementNS(svgNS, 'g');
        layer.setAttribute('class', 'selection-handles');
        node.group.appendChild(layer);
        const outline = document.createElementNS(svgNS, 'rect');
        outline.setAttribute('x', box.x); outline.setAttribute('y', box.y);
        outline.setAttribute('width', box.width); outline.setAttribute('height', box.height);
        outline.setAttribute('fill', 'none');
        outline.setAttribute('stroke', '#0C5E82');
        outline.setAttribute('stroke-width', 2);
        outline.setAttribute('stroke-dasharray', '4 3');
        outline.setAttribute('pointer-events', 'none');
        layer.appendChild(outline);
        this._multiHandleLayers.push(layer);
      });
      return;
    }

    const id = this.selectedId;
    const data = this.elements[id];
    const node = this.nodes[id];
    if (!data || !node) return;

    const layer = document.createElementNS(svgNS, 'g');
    layer.setAttribute('class', 'selection-handles');
    node.group.appendChild(layer); // child of the element's own group — inherits its x/y automatically
    this.handleLayer = layer;

    if (data.type === 'arrow') {
      const angleRad = (data.angle || 0) * Math.PI / 180;
      const x2 = (data.length || 200) * Math.sin(angleRad);
      const y2 = -(data.length || 200) * Math.cos(angleRad);
      this._addHandle(layer, x2, y2, (e) => {
        e.stopPropagation();
        this._startDrag(e, { type: 'arrow-tip', id });
        this.drag.startData.x2 = x2;
        this.drag.startData.y2 = y2;
      });
      return;
    }

    // Outline
    const outline = document.createElementNS(svgNS, 'rect');
    outline.setAttribute('x', 0); outline.setAttribute('y', 0);
    outline.setAttribute('width', data.width); outline.setAttribute('height', data.height);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', '#0C5E82');
    outline.setAttribute('stroke-width', 2);
    outline.setAttribute('stroke-dasharray', '4 3');
    outline.setAttribute('pointer-events', 'none');
    layer.appendChild(outline);

    if (data.type === 'text') {
      // Width-only handle — height is auto-derived from content, not
      // something an author drags.
      this._addHandle(layer, data.width, data.height / 2, (e) => {
        e.stopPropagation();
        this._startDrag(e, { type: 'resize', id, corner: 'right' });
      });
    } else {
      [['top-left', 0, 0], ['top-right', data.width, 0],
       ['bottom-left', 0, data.height], ['bottom-right', data.width, data.height]]
        .forEach(([corner, hx, hy]) => {
          this._addHandle(layer, hx, hy, (e) => {
            e.stopPropagation();
            this._startDrag(e, { type: 'resize', id, corner });
          });
        });
    }
  }

  _addHandle(layer, x, y, onDown) {
    const h = document.createElementNS(svgNS, 'circle');
    h.setAttribute('cx', x); h.setAttribute('cy', y); h.setAttribute('r', 8);
    h.setAttribute('fill', '#fff');
    h.setAttribute('stroke', '#0C5E82');
    h.setAttribute('stroke-width', 2);
    h.style.cursor = 'pointer';
    h.addEventListener('pointerdown', onDown);
    layer.appendChild(h);
  }

  /* ---- Contextual properties popup ---- */

  _clearPopup() {
    if (this.popupEl) this.popupEl.remove();
    this.popupEl = null;
  }

  _renderPopup() {
    this._clearPopup();
    if (this.selectedIds.size === 0) return;

    if (this.selectedIds.size > 1) {
      this._renderMultiSelectToolbar();
      return;
    }

    const data = this.elements[this.selectedId];
    const schema = ELEMENT_TYPES[data.type];

    const popup = document.createElement('div');
    popup.className = 'element-popup';
    this.popupEl = popup;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'popup-name';
    nameInput.value = data.name || schema.label;
    nameInput.addEventListener('focus', () => {
      if (this.history) this.history.beginAction();
    });
    nameInput.addEventListener('input', () => {
      data.name = nameInput.value;
      this.onChange(data);
    });
    nameInput.addEventListener('change', () => {
      if (this.history) this.history.commitAction();
    });
    popup.appendChild(nameInput);

    const primary = Object.entries(schema.fields).filter(([, f]) => (f.tier || 'primary') === 'primary');
    const secondary = Object.entries(schema.fields).filter(([, f]) => f.tier === 'secondary');

    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'popup-fields';
    primary.forEach(([key, field]) => fieldsWrap.appendChild(this._buildField(data, key, field)));
    popup.appendChild(fieldsWrap);

    if (secondary.length) {
      const more = document.createElement('button');
      more.className = 'popup-more-toggle';
      more.textContent = 'More options';
      const moreWrap = document.createElement('div');
      moreWrap.className = 'popup-fields';
      moreWrap.style.display = 'none';
      secondary.forEach(([key, field]) => moreWrap.appendChild(this._buildField(data, key, field)));
      more.addEventListener('click', () => {
        const showing = moreWrap.style.display !== 'none';
        moreWrap.style.display = showing ? 'none' : 'block';
        more.textContent = showing ? 'More options' : 'Fewer options';
        this._positionPopup(); // size changed — reposition to stay on screen
      });
      popup.appendChild(more);
      popup.appendChild(moreWrap);
    }

    const actionsRow = document.createElement('div');
    actionsRow.style.display = 'flex';
    actionsRow.style.gap = 'var(--space-2)';
    actionsRow.style.marginTop = 'var(--space-3)';

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'btn btn-secondary';
    duplicateBtn.style.flex = '1';
    duplicateBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Duplicate';
    duplicateBtn.title = 'Cmd/Ctrl + D';
    duplicateBtn.addEventListener('click', () => this.duplicateSelected());

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.style.flex = '1';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    deleteBtn.title = 'Delete or Backspace';
    deleteBtn.addEventListener('click', () => this.deleteSelected());

    actionsRow.appendChild(duplicateBtn);
    actionsRow.appendChild(deleteBtn);
    popup.appendChild(actionsRow);

    this.popupHost.appendChild(popup);
    this._positionPopup();
  }

  /** Shown instead of the full properties popup whenever 2+ elements are
   *  selected — just enough to act on the group as a whole. */
  _renderMultiSelectToolbar() {
    const popup = document.createElement('div');
    popup.className = 'element-popup';
    this.popupEl = popup;

    const label = document.createElement('div');
    label.style.fontWeight = '700';
    label.style.fontSize = 'var(--text-sm)';
    label.style.marginBottom = 'var(--space-3)';
    label.textContent = `${this.selectedIds.size} elements selected`;
    popup.appendChild(label);

    const actionsRow = document.createElement('div');
    actionsRow.style.display = 'flex';
    actionsRow.style.gap = 'var(--space-2)';

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'btn btn-secondary';
    duplicateBtn.style.flex = '1';
    duplicateBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Duplicate';
    duplicateBtn.title = 'Cmd/Ctrl + D';
    duplicateBtn.addEventListener('click', () => this.duplicateSelected());

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.style.flex = '1';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    deleteBtn.title = 'Delete or Backspace';
    deleteBtn.addEventListener('click', () => this.deleteSelected());

    actionsRow.appendChild(duplicateBtn);
    actionsRow.appendChild(deleteBtn);
    popup.appendChild(actionsRow);

    this.popupHost.appendChild(popup);
    this._positionPopup(); // positions relative to the primary (most-recently-selected) element
  }

  _buildField(data, key, field) {
    const wrap = document.createElement('div');
    wrap.className = 'popup-field';
    const label = document.createElement('label');
    label.textContent = field.label;
    wrap.appendChild(label);

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      field.options.forEach(([val, text]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = text;
        if (val === data[key]) opt.selected = true;
        input.appendChild(opt);
      });
    } else if (field.type === 'color') {
      input = document.createElement('input'); input.type = 'color'; input.value = data[key];
    } else if (field.type === 'range' || field.type === 'number') {
      input = document.createElement('input');
      input.type = field.type === 'range' ? 'range' : 'number';
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
      input.value = data[key];
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea'); input.rows = 3; input.value = data[key];
    } else if (field.type === 'iconpicker') {
      input = document.createElement('select');
      Object.keys(ICON_PATHS).forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        if (name === data[key]) opt.selected = true;
        input.appendChild(opt);
      });
    }
    input.dataset.fieldKey = key;

    input.addEventListener('focus', () => {
      if (this.history) this.history.beginAction();
    });
    input.addEventListener('input', () => {
      let val = input.value;
      if (field.type === 'number' || field.type === 'range') val = parseFloat(val);
      data[key] = val;
      updateElementNode(this.nodes[this.selectedId], data, { animate: false });
      this._renderHandles(); // width/height may have changed (e.g. text width)
      this._positionPopup();
      this.onChange(data);
    });
    input.addEventListener('change', () => {
      if (this.history) this.history.commitAction();
    });

    wrap.appendChild(input);
    return wrap;
  }

  /** Keeps popup fields in sync when a drag (not a field edit) changed
   *  something the popup displays, e.g. dragging the text width handle.
   *  A no-op for the multi-select toolbar, which has no such fields. */
  _syncPopupFields() {
    if (!this.popupEl) return;
    const data = this.elements[this.selectedId];
    if (!data) return;
    this.popupEl.querySelectorAll('[data-field-key]').forEach((input) => {
      const key = input.dataset.fieldKey;
      if (document.activeElement !== input) input.value = data[key];
    });
  }

  /**
   * Positions the popup beside the (primary) selected element's on-screen
   * bounding box, flipping to whichever side keeps it fully within
   * popupHost's bounds — so it never covers the element it's editing, and
   * never runs off the canvas edge.
   */
  _positionPopup() {
    if (!this.popupEl || !this.selectedId) return;
    const node = this.nodes[this.selectedId];
    if (!node) return;
    const hostRect = this.popupHost.getBoundingClientRect();
    const elRect = node.group.getBoundingClientRect();
    const popupRect = this.popupEl.getBoundingClientRect();
    const gap = 16;

    let left = elRect.right - hostRect.left + gap;
    if (left + popupRect.width > hostRect.width) {
      left = elRect.left - hostRect.left - popupRect.width - gap;
    }
    if (left < gap) left = gap; // neither side fits — pin inside the host rather than overflow

    let top = elRect.top - hostRect.top;
    if (top + popupRect.height > hostRect.height - gap) {
      top = hostRect.height - popupRect.height - gap;
    }
    if (top < gap) top = gap;

    this.popupEl.style.left = left + 'px';
    this.popupEl.style.top = top + 'px';
  }
}

