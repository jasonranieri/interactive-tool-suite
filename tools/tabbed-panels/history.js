/* ==========================================================================
   Tabbed Panels — History (undo/redo)
   Deliberately generic — works with any serializable state via a
   getState()/setState() pair, so it isn't tied to TabManager internals
   and could equally undo changes made anywhere else in the tool later.
   Copied verbatim from animated-slides-v2/history.js — no tool-specific
   logic in here, so there was nothing to adapt.

   Snapshot-based rather than diff/command-based: given how small this
   tool's state is, cloning the whole thing on each discrete action is far
   simpler to get right than tracking fine-grained diffs, with no real
   performance cost.

   Usage:
     const history = new History({ getState, setState });
     // at the START of a discrete action (pointerdown, field focus):
     history.beginAction();
     // ...user drags / types...
     // when the action COMPLETES (pointerup, field blur/change):
     history.commitAction();
     // elsewhere:
     history.undo(); history.redo();
   Calling beginAction() at the start and commitAction() at the end is what
   turns a hundred intermediate drag positions into ONE undo step, rather
   than one per pixel moved.
   ========================================================================== */

class History {
  constructor({ getState, setState, limit = 50, onChange = () => {} }) {
    this.getState = getState;
    this.setState = setState;
    this.limit = limit;
    this.onChange = onChange; // called after any undo/redo/commit — hook for updating button disabled-state etc.
    this.undoStack = [];
    this.redoStack = [];
    this._pending = null;
  }

  beginAction() {
    this._pending = this._clone(this.getState());
  }

  commitAction() {
    if (this._pending === null) return;
    const before = this._pending;
    this._pending = null;
    const after = this._clone(this.getState());
    if (JSON.stringify(before) === JSON.stringify(after)) return; // nothing actually changed — don't pollute the stack
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const current = this._clone(this.getState());
    const previous = this.undoStack.pop();
    this.redoStack.push(current);
    this.setState(previous);
    this.onChange();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const current = this._clone(this.getState());
    const next = this.redoStack.pop();
    this.undoStack.push(current);
    this.setState(next);
    this.onChange();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  _clone(state) { return JSON.parse(JSON.stringify(state)); }
}

