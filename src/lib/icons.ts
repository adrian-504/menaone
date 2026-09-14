// Minimal line-icon set replacing emoji in primary application chrome (sidebar,
// toolbars, page headers, empty states) — Part 1's "SF Symbols or appropriate
// native iconography instead of emoji" requirement. Actual SF Symbols glyphs
// aren't embeddable outside Apple's toolchain, so this is an original,
// SF-Symbols-styled substitute: 18x18 viewBox, 1.6px stroke, currentColor,
// rounded joins — matching the weight and proportions of the system icon set
// closely enough to sit naturally in a native-feeling toolbar.
//
// Deep-content glyphs inside dense table cells/badges (activity note counts,
// doc-link buttons, etc.) are lower priority and may still use a small
// Unicode glyph — this set covers navigation, toolbars, and empty states,
// which is what actually reads as "app chrome" to the eye.

const ICONS: Record<string, string> = {
  home: '<path d="M3 9.5 9 4l6 5.5"/><path d="M4.5 8.5V15h9V8.5"/><path d="M7.5 15v-4h3v4"/>',
  note: '<path d="M5 3h6l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M11 3v3h3"/><path d="M6.5 9.5h5M6.5 12h5"/>',
  check: '<rect x="3.5" y="3.5" width="11" height="11" rx="2.5"/><path d="M6.5 9.2l2 2 3-4"/>',
  clock: '<circle cx="9" cy="9" r="6.5"/><path d="M9 5.5V9l2.5 1.5"/>',
  warning: '<path d="M9 3.2 16 15H2L9 3.2Z"/><path d="M9 8v3.2"/><circle cx="9" cy="13" r="0.6" fill="currentColor" stroke="none"/>',
  database: '<ellipse cx="9" cy="5" rx="6" ry="2.2"/><path d="M3 5v8c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5"/><path d="M3 9c0 1.2 2.7 2.2 6 2.2S15 10.2 15 9"/>',
  people: '<circle cx="6.5" cy="6.5" r="2.5"/><path d="M2 15c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><circle cx="13" cy="7" r="2" opacity=".7"/><path d="M12 11.2c1.9.3 3 1.6 3 3.8" opacity=".7"/>',
  building: '<rect x="4" y="2.5" width="10" height="13" rx="1"/><path d="M6.5 5.5h1M9.5 5.5h1M6.5 8h1M9.5 8h1M6.5 10.5h1M9.5 10.5h1"/><path d="M7.5 15.5v-3h3v3"/>',
  document: '<path d="M5 2.5h5l3 3v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M10 2.5v3h3"/><path d="M6.3 9h5.4M6.3 11.3h5.4M6.3 13.6h3"/>',
  chartBar: '<path d="M3 15.5h12"/><rect x="4.5" y="9.5" width="2.4" height="5.2"/><rect x="8" y="6.5" width="2.4" height="8.2"/><rect x="11.5" y="4" width="2.4" height="10.7"/>',
  chartLine: '<path d="M3 15.5h12"/><path d="M3.5 11.5 7 8l2.5 2 4.5-5"/><circle cx="7" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="9.5" cy="10" r=".9" fill="currentColor" stroke="none"/>',
  dollar: '<circle cx="9" cy="9" r="6.5"/><path d="M9 5v8M11.2 6.9c-.4-.6-1.2-1-2.2-1-1.3 0-2.3.7-2.3 1.7 0 2.3 4.5 1.1 4.5 3.4 0 1-1 1.7-2.3 1.7-1 0-1.9-.4-2.3-1"/>',
  folder: '<path d="M2.5 5.5A1 1 0 0 1 3.5 4.5h3.2l1.3 1.5h5.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5.5Z"/>',
  search: '<circle cx="8" cy="8" r="5"/><path d="m15 15-3.2-3.2"/>',
  command: '<path d="M6.2 3.8a2 2 0 1 1 2 2H12M6.2 14.2a2 2 0 1 0 2-2H12M13.8 3.8a2 2 0 1 0-2 2v8.4a2 2 0 1 0 2-2M6.2 5.8h5.6M6.2 12.2h5.6"/>',
  inbox: '<path d="M3 9h3.5l1.2 2h2.6l1.2-2H15"/><path d="M3 9 4.5 3.5h9L15 9v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z"/>',
  calendar: '<rect x="3" y="3.8" width="12" height="11" rx="1.4"/><path d="M3 7.2h12M6.3 2.2v3M11.7 2.2v3"/>',
  plus: '<path d="M9 3.5v11M3.5 9h11"/>',
  gear: '<path d="M7.7 2.3h2.6l.4 1.8c.5.2.9.5 1.3.8l1.8-.6 1.3 2.3-1.4 1.2a4.6 4.6 0 0 1 0 1.5l1.4 1.2-1.3 2.3-1.8-.6c-.4.3-.8.6-1.3.8l-.4 1.8H7.7l-.4-1.8a4.8 4.8 0 0 1-1.3-.8l-1.8.6-1.3-2.3 1.4-1.2a4.6 4.6 0 0 1 0-1.5L2.9 6.7l1.3-2.3 1.8.6c.4-.3.8-.6 1.3-.8Z"/><circle cx="9" cy="9" r="2.2"/>',
  chevronRight: '<path d="m6.5 3.5 5.5 5.5-5.5 5.5"/>',
  chevronLeft: '<path d="m11.5 3.5-5.5 5.5 5.5 5.5"/>',
  chevronDown: '<path d="m3.5 6.5 5.5 5.5 5.5-5.5"/>',
  sidebar: '<rect x="2.5" y="3" width="13" height="12" rx="1.6"/><path d="M7 3v12"/>',
  link: '<path d="M7.5 10.5 10.5 7.5"/><path d="M9 5.3 10.5 3.8a2.6 2.6 0 0 1 3.7 3.7L12.7 9"/><path d="M9 12.7l-1.5 1.5a2.6 2.6 0 0 1-3.7-3.7L5.3 9"/>',
  tag: '<path d="M9.5 3H14a1 1 0 0 1 1 1v4.5a1 1 0 0 1-.3.7l-6 6a1 1 0 0 1-1.4 0l-5.5-5.5a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 .7-.3Z"/><circle cx="11.3" cy="6.7" r="1" fill="currentColor" stroke="none"/>',
  flag: '<path d="M5 15.5V3"/><path d="M5 4h7l-1.8 3L12 10H5"/>',
  trash: '<path d="M4 5.5h10M7.5 5.5V3.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8v1.7M7 8.5v4M11 8.5v4"/><path d="M5.2 5.5 5.8 15a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-9.5"/>',
  edit: '<path d="M11.5 3.5 14.5 6.5 6 15H3v-3Z"/><path d="M10 5 13 8"/>',
  archive: '<rect x="2.5" y="3.5" width="13" height="3" rx="1"/><path d="M3.5 6.5V14a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V6.5"/><path d="M7.3 9.5h3.4"/>',
  target: '<circle cx="9" cy="9" r="6"/><circle cx="9" cy="9" r="3"/><circle cx="9" cy="9" r=".6" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M9.8 2.5 4 10.5h4l-.8 5 6-8.5H9l.8-4.5Z"/>',
  briefcase: '<rect x="2.5" y="6" width="13" height="8.5" rx="1.3"/><path d="M6.5 6V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6"/><path d="M2.5 10h13"/>',
  meeting: '<circle cx="6" cy="6.5" r="2.2"/><circle cx="12" cy="6.5" r="2.2"/><path d="M2.5 15c0-2.2 1.6-3.6 3.5-3.6s3.5 1.4 3.5 3.6M8.5 15c0-2.2 1.6-3.6 3.5-3.6s3.5 1.4 3.5 3.6"/>',
  close: '<path d="m4.5 4.5 9 9M13.5 4.5l-9 9"/>',
  pin: '<path d="M9 2.5c1.9 0 3.4 1.5 3.4 3.4 0 2.3-3.4 6.6-3.4 6.6S5.6 8.2 5.6 5.9C5.6 4 7.1 2.5 9 2.5Z"/><circle cx="9" cy="5.9" r="1.3"/><path d="M9 12.5V15.5"/>',
  more: '<circle cx="4.5" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="13.5" cy="9" r="1" fill="currentColor" stroke="none"/>',
  moon: '<path d="M13.8 10.2A5.6 5.6 0 0 1 7.3 3.7a5.9 5.9 0 1 0 6.5 6.5Z"/>',
  sun: '<circle cx="9" cy="9" r="3.2"/><path d="M9 2.5v1.6M9 13.9v1.6M2.5 9h1.6M13.9 9h1.6M4.6 4.6l1.1 1.1M12.3 12.3l1.1 1.1M4.6 13.4l1.1-1.1M12.3 5.7l1.1-1.1"/>',
  mail: '<rect x="2.5" y="4" width="13" height="10" rx="1.4"/><path d="M3 5l6 5 6-5"/>',
  board: '<rect x="2.3" y="3" width="4.2" height="12" rx="1.2"/><rect x="7.4" y="3" width="4.2" height="8.2" rx="1.2"/><rect x="12.5" y="3" width="3.2" height="10.5" rx="1.2"/>',
  list: '<circle cx="3.3" cy="5" r="1" fill="currentColor" stroke="none"/><path d="M6.5 5h8"/><circle cx="3.3" cy="9" r="1" fill="currentColor" stroke="none"/><path d="M6.5 9h8"/><circle cx="3.3" cy="13" r="1" fill="currentColor" stroke="none"/><path d="M6.5 13h8"/>',
  repeat: '<path d="M3.2 8.2a5 5 0 0 1 5-5.2h5.8"/><path d="M14 3l-2 2 2 2"/><path d="M14.8 9.8a5 5 0 0 1-5 5.2H4"/><path d="M4 17l2-2-2-2"/>',
  grip: '<circle cx="6.2" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="6.2" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="6.2" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="11.8" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="11.8" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="11.8" cy="13" r="1" fill="currentColor" stroke="none"/>',
  copy: '<rect x="6.5" y="6.5" width="8.5" height="9.5" rx="1.3"/><path d="M11.5 6.5V4.3a1 1 0 0 0-1-1H3.8a1 1 0 0 0-1 1v8.4a1 1 0 0 0 1 1H6.5"/>',
  bold: '<path d="M5 3.2h4.3a2.7 2.7 0 0 1 0 5.4H5Z"/><path d="M5 8.6h4.9a2.9 2.9 0 0 1 0 5.8H5Z"/>',
  italic: '<path d="M10.5 3.5h4M3.5 14.5h4M11 3.5 7 14.5"/>',
  strikethrough: '<path d="M3 9h12"/><path d="M6.2 5.3c.4-1.1 1.6-1.8 3.1-1.8 2 0 3.2 1 3.2 2.4 0 1-.6 1.7-1.7 2.1"/><path d="M11.9 12.6c-.5 1.1-1.7 1.8-3.2 1.8-2 0-3.4-.9-3.6-2.4"/>',
  quote: '<path d="M4 3.5v11"/><path d="M7.5 6.3h6.7M7.5 9h6.7M7.5 11.7h4.3"/>',
  codeBlock: '<path d="M6.7 5 2.7 9l4 4"/><path d="M11.3 5l4 4-4 4"/>',
  checklist: '<rect x="2.8" y="3.6" width="4" height="4" rx="1"/><path d="M3.8 5.6l.7.7L6 4.8"/><path d="M9.2 5.6h6"/><rect x="2.8" y="10.4" width="4" height="4" rx="1"/><path d="M9.2 12.4h6"/>',
  numberedList: '<text x="2" y="6.6" font-size="5.4" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">1</text><path d="M7.4 5.3h7.8"/><text x="2" y="10.6" font-size="5.4" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">2</text><path d="M7.4 9.3h7.8"/><text x="2" y="14.6" font-size="5.4" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">3</text><path d="M7.4 13.3h7.8"/>',
  divider: '<path d="M3 9h12"/>',
};

/** Renders one icon as an inline SVG string, 18x18 by default. Pass a `size`
 * and/or `class` for callers that need different dimensions or styling hooks. */
export function icon(name: keyof typeof ICONS | string, size = 18, cls = ''): string {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
