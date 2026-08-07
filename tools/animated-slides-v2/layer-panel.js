/* ==========================================================================
   Animated Slides v2 — Layer Panel
   Lists the active slide's elements in stacking order (top of the list =
   top of the stack, matching common design-tool convention — the opposite
   of the underlying array order, which is bottom-to-top). Click a row to
   select it on the canvas (Shift/Cmd/Ctrl+click to add to the selection);
   drag a row to reorder, or use the up/down buttons for the same thing
   one step at a time.

   Deliberately reads directly from SlideManager rather than keeping its
   own copy of anything — call renderLayerPanel() again any time the
   active slide's contents or order change (after a transition, an add/
   delete, a reorder, or a selection change) and it fully redraws from
   current state, rather than trying to patch itself incrementally.
   ========================================================================== */

function renderLayerPanel(container, slideManager, canvasEditor) {
  container.innerHTML = '';
  const order = slideManager.getLayerOrder();
  const topToBottom = [...order].reverse(); // display convention: top of list = top of stack

  if (topToBottom.length === 0) {
    container.innerHTML = '<div class="layer-empty">No elements on this slide yet.</div>';
    return;
  }

  let draggedId = null;

  topToBottom.forEach((id) => {
    const data = slideManager.elements[id];
    if (!data) return;
    const schema = ELEMENT_TYPES[data.type];

    const row = document.createElement('div');
    row.className = 'layer-row' + (canvasEditor.selectedIds.has(id) ? ' active' : '');
    row.draggable = true;

    const icon = document.createElement('i');
    icon.className = 'fa-solid ' + (schema.icon || 'fa-shapes');
    row.appendChild(icon);

    // Shows a small link icon when this element's id also appears on
    // another slide — that shared id is the entire mechanic that makes it
    // animate between slides, so it's worth surfacing, not just implicit.
    const isLinked = slideManager.slides.some((s, idx) =>
      idx !== slideManager.activeIndex && s.elements.some((e) => e.id === id)
    );
    if (isLinked) {
      const linkIcon = document.createElement('i');
      linkIcon.className = 'fa-solid fa-link linked-badge';
      linkIcon.title = 'Linked — animates between slides';
      row.appendChild(linkIcon);
    }

    const label = document.createElement('span');
    label.className = 'layer-name';
    label.textContent = data.name || schema.label;
    row.appendChild(label);

    const controls = document.createElement('span');
    controls.className = 'layer-controls';

    const upBtn = document.createElement('button');
    upBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    upBtn.title = 'Bring forward';
    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      slideManager.reorderLayer(id, -1); // -1 in array order = later = on top = "up" in the displayed list
      renderLayerPanel(container, slideManager, canvasEditor);
    });

    const downBtn = document.createElement('button');
    downBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    downBtn.title = 'Send backward';
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      slideManager.reorderLayer(id, 1);
      renderLayerPanel(container, slideManager, canvasEditor);
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    row.appendChild(controls);

    row.addEventListener('click', (e) => {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (additive && canvasEditor.selectedIds.has(id)) {
        canvasEditor.selectedIds.delete(id);
        canvasEditor._renderHandles();
        canvasEditor._renderPopup();
        canvasEditor.onSelect([...canvasEditor.selectedIds]);
        renderLayerPanel(container, slideManager, canvasEditor);
        return;
      }
      canvasEditor.select(id, { additive });
      renderLayerPanel(container, slideManager, canvasEditor);
    });

    row.addEventListener('dragstart', (e) => {
      draggedId = id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      container.querySelectorAll('.layer-row').forEach((r) => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault(); // required for drop to fire at all
      if (draggedId && draggedId !== id) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!draggedId || draggedId === id) return;
      // Dropping onto a row puts the dragged layer immediately above it
      // in the displayed (top-to-bottom) list.
      slideManager.moveLayerBefore(draggedId, id);
      renderLayerPanel(container, slideManager, canvasEditor);
    });

    container.appendChild(row);
  });
}

