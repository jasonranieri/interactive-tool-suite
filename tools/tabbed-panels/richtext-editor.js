/* ==========================================================================
   Tabbed Panels — Rich Text Editor
   Hand-rolled (no third-party lib, per the reviewed schema draft): a
   contenteditable div plus a small toolbar that toggles inline marks via
   document.execCommand. Deliberately minimal — bold/italic/underline/link
   only, no block-level formatting (that's what separate block types are
   for), no nested marks beyond what execCommand already gives us for free.

   Storage format: sanitized HTML, restricted to <b> <i> <u> <a href> (see
   ALLOWED_TAGS below). Sanitizing on every input event (not just blur)
   means a value handed to onChange is never anything execCommand could
   have snuck in (e.g. a pasted <script> or a style attribute).
   ========================================================================== */

const RICHTEXT_ALLOWED_TAGS = { B: [], STRONG: [], I: [], EM: [], U: [], A: ['href', 'target', 'rel'], BR: [] };

function sanitizeRichHtml(html) {
  const scratch = document.createElement('div');
  scratch.innerHTML = html || '';

  (function walk(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE || !(child.tagName in RICHTEXT_ALLOWED_TAGS)) {
        // Unwrap disallowed elements (e.g. a pasted <div>/<span>) rather
        // than dropping their text content.
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      const allowedAttrs = RICHTEXT_ALLOWED_TAGS[child.tagName];
      [...child.attributes].forEach((attr) => {
        if (!allowedAttrs.includes(attr.name)) child.removeAttribute(attr.name);
      });
      walk(child);
    });
  })(scratch);

  return scratch.innerHTML;
}

/**
 * Wires a toolbar + contenteditable pair for one richtext field.
 * @param root      container element; gets `.tp-richtext-toolbar` and
 *                  `.tp-richtext-editable` children appended to it.
 * @param value     initial sanitized HTML string.
 * @param inline    which marks to expose, e.g. ['bold','italic','underline','link'].
 * @param onChange  called with the new sanitized HTML on every edit.
 */
function attachRichTextField(root, { value = '', inline = [], onChange = () => {} }) {
  root.innerHTML = '';
  root.classList.add('tp-richtext-field');

  const MARK_BUTTONS = {
    bold: { icon: 'fa-bold', command: 'bold' },
    italic: { icon: 'fa-italic', command: 'italic' },
    underline: { icon: 'fa-underline', command: 'underline' },
    link: { icon: 'fa-link', command: 'link' }, // handled specially — see below
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'tp-richtext-toolbar';
  inline.forEach((mark) => {
    const spec = MARK_BUTTONS[mark];
    if (!spec) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tp-richtext-btn';
    btn.innerHTML = `<i class="fa-solid ${spec.icon}"></i>`;
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection alive
    btn.addEventListener('click', async () => {
      editable.focus();
      if (mark === 'link') {
        const existing = document.queryCommandValue('createLink');
        const url = await Shell.prompt('Enter a URL, or leave blank to remove the link.', existing || 'https://', { heading: 'Link' });
        if (url === false) return;
        document.execCommand(url ? 'createLink' : 'unlink', false, url || undefined);
      } else {
        document.execCommand(spec.command, false, null);
      }
      commit();
    });
    toolbar.appendChild(btn);
  });

  const editable = document.createElement('div');
  editable.className = 'tp-richtext-editable';
  editable.contentEditable = 'true';
  editable.innerHTML = sanitizeRichHtml(value);

  function commit() {
    onChange(sanitizeRichHtml(editable.innerHTML));
  }

  editable.addEventListener('input', commit);
  editable.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  root.appendChild(toolbar);
  root.appendChild(editable);
  return editable;
}
