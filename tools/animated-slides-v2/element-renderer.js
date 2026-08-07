/* ==========================================================================
   Animated Slides v2 — Shared Element Renderer
   The single "recipe card" for drawing and updating each element type.
   Used identically by the authoring canvas AND the exported player — no
   second copy to drift out of sync. Requires GSAP and element-types.js to
   be loaded first.

   This engine is deliberately "dumb": given element data, it creates or
   updates the visual SVG node. It knows nothing about selection, drag
   handles, or resize handles — those are authoring-only concerns the
   editor layers on top, so this file works unchanged inside the exported
   player, which has no editing UI at all.

   TWO DELIBERATE CHOICES WORTH KNOWING ABOUT:

   1. Text uses native SVG <text>/<tspan>, NOT <foreignObject>.
      foreignObject embeds HTML inside SVG, and browsers apply the SVG
      viewBox scale to that embedded HTML inconsistently — notably, setting
      opacity below 1 forces a compositing layer that changes the render
      path, so text visibly changed size purely from an opacity change even
      though every underlying value was correct. Native SVG text obeys the
      viewBox transform reliably everywhere. Tradeoff: SVG text has no
      automatic wrapping, so we wrap manually (see layoutText), and inline
      HTML formatting inside a single text element is not supported.

   2. GSAP is used ONLY for genuine animated transitions (animate:true).
      Instant updates set attributes directly — no reason to route a slider
      drag through an animation engine.
   ========================================================================== */

const svgNS = "http://www.w3.org/2000/svg";
const TEXT_FONT_FAMILY = "'IBM Plex Sans', system-ui, sans-serif";

const ICON_PATHS = {
  "star": "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  "heart": "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  "check-circle": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  "info": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  "warning": "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  "flag": "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z",
  "bookmark": "M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"
  // Add new icons here — they show up in the icon picker automatically
  // (see element-types.js's iconpicker field type), no other file to touch.
};

/* ---- Text measurement ----
   Uses a canvas rather than the DOM: measuring via getComputedTextLength()
   would force a layout/reflow on every keystroke, and canvas measurement of
   the same font is accurate enough for wrapping while costing nothing. */
const _measureCanvas = document.createElement('canvas').getContext('2d');

function measureTextWidth(str, fontSize, fontWeight) {
  _measureCanvas.font = `${fontWeight || 700} ${fontSize}px ${TEXT_FONT_FAMILY}`;
  return _measureCanvas.measureText(str).width;
}

/**
 * Wraps a string into lines that fit within maxWidth. Honours explicit
 * newlines the author typed, then word-wraps each resulting paragraph.
 * A single word longer than maxWidth is left overflowing rather than
 * broken mid-word — breaking it would usually be more surprising.
 */
function wrapTextLines(content, maxWidth, fontSize, fontWeight) {
  const lines = [];
  (content || '').split('\n').forEach(paragraph => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); return; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = line + ' ' + words[i];
      if (measureTextWidth(candidate, fontSize, fontWeight) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  });
  return lines;
}

/**
 * Rebuilds the <tspan> children of a text element for the current content,
 * width, font and alignment — and sets data.height to whatever the wrapped
 * result actually needs, so text is never clipped.
 */
function layoutText(textEl, data) {
  const fontSize = data.fontSize || 52;
  const fontWeight = data.fontWeight || '700';
  const padding = data.padding !== undefined ? data.padding : 10;
  const lineHeight = (data.lineHeight || 1.3) * fontSize;
  const align = data.align || 'center';
  const innerWidth = Math.max(1, data.width - padding * 2);

  const lines = wrapTextLines(data.content, innerWidth, fontSize, fontWeight);

  // Grow the element's box to fit the wrapped text.
  const naturalHeight = lines.length * lineHeight + padding * 2;
  data.height = Math.max(naturalHeight, ELEMENT_TYPES.text.defaultSize.height);

  // Horizontal anchoring
  let anchor, x;
  if (align === 'left' || align === 'justify') { anchor = 'start';  x = padding; }
  else if (align === 'right')                  { anchor = 'end';    x = data.width - padding; }
  else                                         { anchor = 'middle'; x = data.width / 2; }
  textEl.setAttribute('text-anchor', anchor);

  // Vertically centre the block of lines within the element's box.
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = (data.height - blockHeight) / 2 + fontSize * 0.82; // 0.82 ≈ cap height above baseline

  textEl.textContent = '';
  lines.forEach((line, i) => {
    const tspan = document.createElementNS(svgNS, 'tspan');
    tspan.setAttribute('x', x);
    tspan.setAttribute('y', firstBaseline + i * lineHeight);
    tspan.textContent = line || ' '; // keep empty lines occupying space
    textEl.appendChild(tspan);
  });
}

/* ---- Font loading ----
   Text measurement depends on the real webfont being available. If it
   hasn't loaded yet, wrapping is computed against a fallback font and will
   be slightly wrong. Re-layout every text node once fonts are ready. */
const _textNodes = new Set();
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    _textNodes.forEach(({ textEl, data }) => layoutText(textEl, data));
  });
}

/**
 * Builds an SVG path `d` string for a rectangle with an independent corner
 * radius per corner — something native <rect> can't express (it only
 * supports one uniform rx/ry). Radii are clamped so opposite corners never
 * overlap on a small shape.
 */
function roundedRectPath(width, height, tl, tr, br, bl) {
  const maxR = Math.min(width, height) / 2;
  tl = Math.min(tl, maxR); tr = Math.min(tr, maxR);
  br = Math.min(br, maxR); bl = Math.min(bl, maxR);
  return `
    M ${tl} 0
    L ${width - tr} 0
    A ${tr} ${tr} 0 0 1 ${width} ${tr}
    L ${width} ${height - br}
    A ${br} ${br} 0 0 1 ${width - br} ${height}
    L ${bl} ${height}
    A ${bl} ${bl} 0 0 1 0 ${height - bl}
    L 0 ${tl}
    A ${tl} ${tl} 0 0 1 ${tl} 0
    Z
  `.trim();
}
function createElementNode(data) {
  const g = document.createElementNS(svgNS, "g");
  g.setAttribute("id", data.id);
  g.setAttribute("data-type", data.type);
  gsap.set(g, { x: data.x, y: data.y, opacity: 0 });

  if (data.type === 'text') {
    const textEl = document.createElementNS(svgNS, "text");
    textEl.setAttribute('font-family', TEXT_FONT_FAMILY);
    g.appendChild(textEl);
    applyTextStyle(textEl, data, false);
    _textNodes.add({ textEl, data });
    return { group: g, textEl };
  }

  if (data.type === 'rect') {
    const shape = document.createElementNS(svgNS, "path");
    g.appendChild(shape);
    applyRectStyle(shape, data, false);
    return { group: g, shape };
  }

  if (data.type === 'arrow') {
    const visualGroup = document.createElementNS(svgNS, 'g');
    g.appendChild(visualGroup);

    const defs = document.createElementNS(svgNS, "defs");
    const marker = document.createElementNS(svgNS, "marker");
    marker.setAttribute("id", "marker-" + data.id);
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "4");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const markerPath = document.createElementNS(svgNS, "path");
    markerPath.setAttribute("d", "M 0 1 L 4 3 L 0 5 Z");
    markerPath.setAttribute("stroke-linejoin", "round");
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    visualGroup.appendChild(defs);

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("marker-end", "url(#marker-" + data.id + ")");
    visualGroup.appendChild(line);

    // Invisible, much wider line layered on top purely to catch pointer
    // events — kept OUTSIDE visualGroup since it must always stay fully
    // hit-testable regardless of the visible arrow's opacity.
    const hitLine = document.createElementNS(svgNS, "line");
    hitLine.setAttribute("stroke", "#000");
    hitLine.setAttribute("opacity", "0");
    hitLine.setAttribute("pointer-events", "stroke");
    g.appendChild(hitLine);

    applyArrowStyle(line, markerPath, hitLine, visualGroup, data, false);
    return { group: g, line, markerPath, hitLine, visualGroup };
  }

  if (data.type === 'icon') {
    const iconSvg = document.createElementNS(svgNS, "svg");
    iconSvg.setAttribute("viewBox", "0 0 24 24");
    iconSvg.setAttribute("width", data.width);
    iconSvg.setAttribute("height", data.height);
    const iconPath = document.createElementNS(svgNS, "path");
    iconSvg.appendChild(iconPath);
    g.appendChild(iconSvg);
    applyIconStyle(iconSvg, iconPath, data, false);
    return { group: g, iconSvg, iconPath };
  }

  throw new Error(`Unknown element type: ${data.type}`);
}

/**
 * Updates an existing node to match new data. animate:true for slide-to-
 * slide transitions; false (default) for instant edits.
 */
function updateElementNode(node, data, { animate = false, duration = 0.8 } = {}) {
  if (animate) {
    gsap.to(node.group, { x: data.x, y: data.y, opacity: 1, duration, ease: "power3.inOut" });
  } else {
    gsap.set(node.group, { x: data.x, y: data.y, opacity: 1 });
  }

  if (data.type === 'text') {
    applyTextStyle(node.textEl, data, animate, duration);
  } else if (data.type === 'rect') {
    applyRectStyle(node.shape, data, animate, duration);
  } else if (data.type === 'arrow') {
    applyArrowStyle(node.line, node.markerPath, node.hitLine, node.visualGroup, data, animate, duration);
  } else if (data.type === 'icon') {
    applyIconStyle(node.iconSvg, node.iconPath, data, animate, duration);
  }
}

/**
 * Either tweens an SVG element's attributes with GSAP (animate:true) or
 * sets them directly (animate:false).
 */
function setOrTween(el, attrs, animate, duration) {
  if (animate) {
    gsap.to(el, { attr: attrs, duration, ease: "power3.inOut" });
  } else {
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  }
}

/* ---- Per-type style application ---- */

function applyTextStyle(textEl, data, animate, duration = 0.8) {
  textEl.setAttribute('font-weight', data.fontWeight || '700');
  textEl.setAttribute('fill', data.color || '#1f2937');

  const targetFontSize = data.fontSize || 52;
  const targetWidth = data.width;
  const targetOpacity = data.opacity !== undefined ? data.opacity : 1;

  if (animate) {
    // Line wrapping is fundamentally discrete (a line count change can't
    // be "half-wrapped"), but font size and width can genuinely ease —
    // re-running layoutText() every animation frame with the currently
    // interpolated values gets as close to a smooth resize as text reflow
    // allows, rather than the box snapping to its final size instantly.
    const proxy = {
      fontSize: textEl._lastFontSize || targetFontSize,
      width: textEl._lastWidth || targetWidth,
      opacity: parseFloat(textEl.getAttribute('opacity') || '1'),
    };
    gsap.to(proxy, {
      fontSize: targetFontSize, width: targetWidth, opacity: targetOpacity,
      duration, ease: 'power3.inOut',
      onUpdate: () => {
        textEl.setAttribute('font-size', proxy.fontSize);
        textEl.setAttribute('opacity', proxy.opacity);
        layoutText(textEl, { ...data, fontSize: proxy.fontSize, width: proxy.width });
      },
      onComplete: () => {
        layoutText(textEl, data); // final pass against the real data object, so data.height ends up correctly synced
      },
    });
  } else {
    textEl.setAttribute('font-size', targetFontSize);
    textEl.setAttribute('opacity', targetOpacity);
    layoutText(textEl, data);
  }
  textEl._lastFontSize = targetFontSize;
  textEl._lastWidth = targetWidth;
}

function applyRectStyle(shape, data, animate, duration = 0.8) {
  const target = {
    width: data.width, height: data.height,
    tl: data.radiusTL || 0, tr: data.radiusTR || 0, br: data.radiusBR || 0, bl: data.radiusBL || 0,
  };

  if (animate) {
    // GSAP can't natively tween an SVG path's `d` string (that needs the
    // paid MorphSVG plugin) — so instead we tween the plain numbers
    // through a proxy object and rebuild the path from them every frame.
    const from = shape._lastGeom || target;
    const proxy = { ...from };
    gsap.to(proxy, {
      ...target, duration, ease: 'power3.inOut',
      onUpdate: () => {
        shape.setAttribute('d', roundedRectPath(proxy.width, proxy.height, proxy.tl, proxy.tr, proxy.br, proxy.bl));
      },
    });
  } else {
    shape.setAttribute('d', roundedRectPath(target.width, target.height, target.tl, target.tr, target.br, target.bl));
  }
  shape._lastGeom = target;

  setOrTween(shape, {
    fill: data.fill || '#e1f6db',
    opacity: data.opacity !== undefined ? data.opacity : 1,
  }, animate, duration);
}

/**
 * Compass-style angle (0° = up, 90° = right, 180° = down, 270° = left) and
 * a length, rather than raw x1/y1/x2/y2 — much easier for an author to
 * reason about, and the only thing that actually needs to be stored; the
 * line's endpoint is derived from it every time.
 */
function applyArrowStyle(line, markerPath, hitLine, visualGroup, data, animate, duration = 0.8) {
  const color = data.color || '#1f2937';
  const opacity = data.opacity !== undefined ? data.opacity : 1;
  const target = { length: data.length || 200, angle: data.angle || 0, strokeWidth: data.strokeWidth || 8 };

  function applyGeometry(length, angleDeg, strokeWidth) {
    const angleRad = angleDeg * Math.PI / 180;
    const x2 = length * Math.sin(angleRad);
    const y2 = -length * Math.cos(angleRad); // negative: 0° points up (negative Y), not right
    line.setAttribute('x1', 0); line.setAttribute('y1', 0);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke-width', strokeWidth);
    if (hitLine) {
      hitLine.setAttribute('x1', 0); hitLine.setAttribute('y1', 0);
      hitLine.setAttribute('x2', x2); hitLine.setAttribute('y2', y2);
      hitLine.setAttribute('stroke-width', Math.max(24, strokeWidth + 16));
    }
    // Keep width/height as the line's bounding box — not used for
    // rendering, but useful for selection outlines and drag handles.
    data.width = Math.max(Math.abs(x2), strokeWidth);
    data.height = Math.max(Math.abs(y2), strokeWidth);
  }

  line.setAttribute('stroke', color);
  // The line and its arrowhead marker are two separate shapes, and
  // applying opacity to each of them individually caused a visible seam
  // where they overlap (the semi-transparent line and marker double-
  // blend right at the join). Instead, both stay fully opaque themselves
  // and opacity is applied once to visualGroup, which composites them as
  // a single unit first — no seam, since there's nothing left to double-
  // blend by the time opacity is applied.
  if (markerPath) { markerPath.setAttribute('fill', color); markerPath.setAttribute('stroke', color); }
  setOrTween(visualGroup, { opacity }, animate, duration);
  // The arrowhead marker's markerUnits defaults to "strokeWidth", so it
  // scales with the line's thickness automatically — no manual resizing
  // of the marker needed here.

  if (animate) {
    const from = line._lastGeom || target;
    // Animate the short way around the circle — e.g. 350° -> 10° should
    // ease through 360/0, not spin backwards through 180.
    let angleFrom = from.angle;
    const delta = target.angle - angleFrom;
    if (delta > 180) angleFrom += 360;
    else if (delta < -180) angleFrom -= 360;
    const proxy = { length: from.length, angle: angleFrom, strokeWidth: from.strokeWidth };
    gsap.to(proxy, {
      length: target.length, angle: target.angle, strokeWidth: target.strokeWidth,
      duration, ease: 'power3.inOut',
      onUpdate: () => applyGeometry(proxy.length, proxy.angle, proxy.strokeWidth),
    });
  } else {
    applyGeometry(target.length, target.angle, target.strokeWidth);
  }
  line._lastGeom = target;
}

function applyIconStyle(iconSvg, iconPath, data, animate, duration = 0.8) {
  const opacity = data.opacity !== undefined ? data.opacity : 1;
  setOrTween(iconSvg, { width: data.width, height: data.height, opacity }, animate, duration);
  iconSvg.setAttribute('fill', data.color || '#1f2937');
  const d = ICON_PATHS[data.iconName] || ICON_PATHS.star;
  if (iconPath.getAttribute('d') !== d) iconPath.setAttribute('d', d);
}

