/* ==========================================================================
   Animated Slides v2 — Element Type Schema
   One declaration per element type. This is the "packing list" — the
   properties panel gets generated from these field lists instead of each
   type having its own hand-written form, and the renderer (element-
   renderer.js) reads the same field names when drawing/updating a node.

   Every element also has these, handled by the engine directly rather than
   declared per-type since ALL types share them: id, type, x, y, width,
   height. Only what's specific to a type goes in its `fields`.
   ========================================================================== */

const ELEMENT_TYPES = {

  text: {
    label: 'Text',
    icon: 'fa-font',
    defaultSize: { width: 400, height: 120 },
    fields: {
      content:    { type: 'textarea', label: 'Text',       default: 'New text', tier: 'primary' },
      fontSize:   { type: 'number',   label: 'Font size',   default: 52, min: 8, max: 200, tier: 'primary' },
      fontWeight: { type: 'select',   label: 'Weight',      default: '700', tier: 'secondary',
                    options: [['400','Regular'], ['500','Medium'], ['600','Semibold'], ['700','Bold'], ['800','Extra bold']] },
      color:      { type: 'color',    label: 'Colour',       default: '#1f2937', tier: 'primary' },
      align:      { type: 'select',   label: 'Align',       default: 'center', tier: 'secondary',
                    options: [['left','Left'], ['center','Center'], ['right','Right'], ['justify','Justify']] },
      padding:    { type: 'number',   label: 'Padding',     default: 10, min: 0, max: 100, tier: 'secondary' },
      lineHeight: { type: 'number',   label: 'Line height', default: 1.3, min: 0.8, max: 3, step: 0.1, tier: 'secondary' },
      opacity:    { type: 'range',    label: 'Opacity',     default: 1, min: 0, max: 1, step: 0.05, tier: 'secondary' },
    },
  },

  rect: {
    label: 'Shape',
    icon: 'fa-square',
    defaultSize: { width: 300, height: 200 },
    fields: {
      fill:      { type: 'color',  label: 'Fill',              default: '#e1f6db', tier: 'primary' },
      radiusTL:  { type: 'number', label: 'Radius (top-left)',  default: 0, min: 0, max: 300, tier: 'secondary' },
      radiusTR:  { type: 'number', label: 'Radius (top-right)', default: 0, min: 0, max: 300, tier: 'secondary' },
      radiusBR:  { type: 'number', label: 'Radius (btm-right)', default: 0, min: 0, max: 300, tier: 'secondary' },
      radiusBL:  { type: 'number', label: 'Radius (btm-left)',  default: 0, min: 0, max: 300, tier: 'secondary' },
      opacity:   { type: 'range',  label: 'Opacity',            default: 1, min: 0, max: 1, step: 0.05, tier: 'secondary' },
    },
  },

  arrow: {
    label: 'Arrow',
    icon: 'fa-arrow-down',
    defaultSize: { width: 200, height: 200 }, // overwritten immediately from length/angle — see applyArrowStyle
    fields: {
      length:      { type: 'number', label: 'Length',           default: 200, min: 10, max: 1800, tier: 'primary' },
      angle:       { type: 'number', label: 'Angle (0=up, 90=right, 180=down, 270=left)', default: 180, min: 0, max: 360, step: 1, tier: 'primary' },
      strokeWidth: { type: 'number', label: 'Thickness',        default: 8, min: 1, max: 60, tier: 'secondary' },
      color:       { type: 'color',  label: 'Colour',            default: '#1f2937', tier: 'primary' },
      opacity:     { type: 'range',  label: 'Opacity',          default: 1, min: 0, max: 1, step: 0.05, tier: 'secondary' },
    },
  },

  icon: {
    label: 'Icon',
    icon: 'fa-star',
    defaultSize: { width: 80, height: 80 },
    fields: {
      iconName: { type: 'iconpicker', label: 'Icon',  default: 'star', tier: 'primary' },
      color:    { type: 'color',      label: 'Colour', default: '#1f2937', tier: 'primary' },
      opacity:  { type: 'range',      label: 'Opacity', default: 1, min: 0, max: 1, step: 0.05, tier: 'secondary' },
    },
  },

};

/**
 * Builds a fresh element's data object from its schema defaults — this is
 * what "add element" calls. Keeps default-value logic in one place instead
 * of repeated inline object literals scattered through the editor.
 */
function makeDefaultElement(type, id, x, y) {
  const schema = ELEMENT_TYPES[type];
  if (!schema) throw new Error(`Unknown element type: ${type}`);

  const data = {
    id, type, x, y,
    name: schema.label, // shown as the popup's heading — free text, author can rename
    width: schema.defaultSize.width,
    height: schema.defaultSize.height,
  };

  Object.entries(schema.fields).forEach(([key, field]) => {
    data[key] = field.default;
  });

  return data;
}

