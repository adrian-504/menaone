// Live-preview Markdown editor built on CodeMirror 6. The document buffer
// (`view.state.doc.toString()`) IS the literal Markdown that gets saved —
// there is no serialization step and no parallel HTML representation. "Live
// preview" (headings sized, **bold** rendered bold, checkboxes clickable,
// etc.) is achieved entirely through CodeMirror's decoration system, which
// restyles/replaces text ranges for *display* only: this is the same
// technique Obsidian's own Live Preview mode is built on. Syntax markers
// (`**`, `#`, `` ` ``) are hidden via a zero-width Decoration.replace UNLESS
// the cursor is on that line, at which point they reappear as plain editable
// text — the standard Typora/Obsidian "reveal on focus" convention.
import { EditorState, Prec, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  EditorView, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate,
  WidgetType, keymap, drawSelection, placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNodeRef } from '@lezer/common';

export interface NoteEditorOptions {
  doc: string;
  onChange: (doc: string) => void;
  resolveWikilink: (title: string) => number | null;
  onWikilinkClick: (noteId: number) => void;
  onImageFile: (file: File) => void;
  resolveAttachmentUrl: (id: string, img: HTMLImageElement) => void;
  /** Fired after every doc/selection change — the host (notes.ts) uses this to
   * drive its own slash-command / [[wikilink]] autocomplete menus, which stay
   * outside this module since it already owns their trigger definitions and
   * candidate lists. */
  onCursorActivity?: (view: EditorView) => void;
  /** Intercepts a keydown *before* CodeMirror's own keymap processing.
   * CodeMirror's keymap system is itself implemented as a `Prec.default`
   * `EditorView.domEventHandlers({keydown...})` (see @codemirror/view's
   * `handleKeyEvents`) — so a plain, unwrapped `EditorView.domEventHandlers`
   * extension sits at the *same* precedence tier and can lose the tie to it
   * (e.g. to markdown()'s own list-continuation Enter binding, or
   * defaultKeymap's ArrowDown → cursorDown). Wrapping this extension in
   * `Prec.highest` (done at the call site below) guarantees it always runs
   * first. Return true (and call preventDefault yourself) to stop CodeMirror
   * from also handling the key; false lets it fall through. */
  onKeyDown?: (e: KeyboardEvent, view: EditorView) => boolean;
  placeholder?: string;
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(other: CheckboxWidget): boolean { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-md-checkbox';
    box.onmousedown = (e) => e.preventDefault(); // keep editor focus/selection intact
    box.onclick = () => {
      // this.checked is the state *before* the click (what was parsed from
      // the document) — toggling means writing the opposite character.
      const ch = this.checked ? ' ' : 'x';
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: ch } });
    };
    return box;
  }
  ignoreEvent(): boolean { return false; }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly resolve: (id: string, img: HTMLImageElement) => void) { super(); }
  eq(other: ImageWidget): boolean { return other.src === this.src; }
  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-md-image';
    img.alt = this.alt;
    const m = /^attachment:\/\/(\d+)$/.exec(this.src);
    if (m) this.resolve(m[1], img);
    else img.src = this.src;
    return img;
  }
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Text-visible-only "marker" ranges (the `**`, `#`, `` ` `` etc.) collapse to
 * nothing unless the cursor's current line matches — everything else (the
 * actual content between markers) always renders styled and stays selectable/
 * editable text throughout. */
function buildDecorations(view: EditorView, resolveWikilink: (t: string) => number | null, resolveAttachment: (id: string, img: HTMLImageElement) => void): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const marks: { from: number; to: number; deco: Decoration }[] = [];

  const addMarker = (from: number, to: number) => {
    if (from >= to) return;
    const onCursorLine = view.state.doc.lineAt(from).number === cursorLine;
    marks.push({ from, to, deco: onCursorLine ? Decoration.mark({ class: 'cm-md-marker-visible' }) : Decoration.replace({}) });
  };
  const addMark = (from: number, to: number, cls: string) => {
    if (from >= to) return;
    marks.push({ from, to, deco: Decoration.mark({ class: cls }) });
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node: SyntaxNodeRef) => {
        switch (node.name) {
          case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
          case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
            const level = node.name.slice(-1);
            addMark(node.from, node.to, `cm-md-h${level}`);
            const mark = node.node.getChild('HeaderMark');
            if (mark) addMarker(mark.from, mark.to + 1); // include the space after #
            break;
          }
          case 'StrongEmphasis':
            addMark(node.from, node.to, 'cm-md-strong');
            node.node.getChildren('EmphasisMark').forEach((m) => addMarker(m.from, m.to));
            break;
          case 'Emphasis':
            addMark(node.from, node.to, 'cm-md-em');
            node.node.getChildren('EmphasisMark').forEach((m) => addMarker(m.from, m.to));
            break;
          case 'Strikethrough':
            addMark(node.from, node.to, 'cm-md-strike');
            node.node.getChildren('StrikethroughMark').forEach((m) => addMarker(m.from, m.to));
            break;
          case 'InlineCode':
            addMark(node.from, node.to, 'cm-md-code-inline');
            node.node.getChildren('CodeMark').forEach((m) => addMarker(m.from, m.to));
            break;
          case 'FencedCode':
            addMark(node.from, node.to, 'cm-md-code-block');
            break;
          case 'Blockquote':
            addMark(node.from, node.to, 'cm-md-quote');
            node.node.getChildren('QuoteMark').forEach((m) => addMarker(m.from, m.to + 1));
            break;
          case 'ListMark':
            // A checklist item reads as just its checkbox, so its "-" hides
            // like other syntax (and reappears on the line being edited).
            if (node.node.nextSibling?.name === 'Task') addMarker(node.from, node.to + 1);
            else addMark(node.from, node.to, 'cm-md-list-marker');
            break;
          case 'Task': {
            // Unlike text-styling markers (bold/heading/etc), a checkbox has
            // no raw-text editing interaction worth revealing — it always
            // renders as a real clickable widget, cursor-line or not, so
            // clicking it to toggle doesn't make it vanish out from under you.
            const tm = node.node.getChild('TaskMarker');
            if (tm) {
              const checked = view.state.doc.sliceString(tm.from, tm.to).toLowerCase().includes('x');
              marks.push({ from: tm.from, to: tm.to, deco: Decoration.replace({ widget: new CheckboxWidget(checked, tm.from + 1) }) });
            }
            break;
          }
          case 'Link': {
            const urlNode = node.node.getChild('URL');
            const url = urlNode ? view.state.doc.sliceString(urlNode.from, urlNode.to) : '';
            addMark(node.from, node.to, 'cm-md-link');
            node.node.getChildren('LinkMark').forEach((m) => addMarker(m.from, m.to));
            if (urlNode) addMarker(urlNode.from - 1, urlNode.to + 1); // "(" url ")"
            marks.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-md-link', attributes: { 'data-url': url } }) });
            break;
          }
          case 'Image': {
            const urlNode = node.node.getChild('URL');
            const url = urlNode ? view.state.doc.sliceString(urlNode.from, urlNode.to) : '';
            const onCursorLine = view.state.doc.lineAt(node.from).number === cursorLine;
            if (!onCursorLine && url) {
              marks.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new ImageWidget(url, '', resolveAttachment) }) });
            }
            break;
          }
          case 'HorizontalRule':
            addMark(node.from, node.to, 'cm-md-hr');
            break;
        }
      },
    });

    // [[wikilink]] pass — not part of the CommonMark grammar, plain regex scan.
    const text = view.state.doc.sliceString(from, to);
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      const noteId = resolveWikilink(m[1].trim());
      marks.push({ from: start, to: end, deco: Decoration.mark({ class: noteId ? 'cm-md-wikilink' : 'cm-md-wikilink cm-md-wikilink-broken', attributes: { 'data-note-id': noteId != null ? String(noteId) : '' } }) });
    }
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, deco } of marks) builder.add(from, to, deco);
  return builder.finish();
}

const livePreviewPlugin = (resolveWikilink: (t: string) => number | null, resolveAttachment: (id: string, img: HTMLImageElement) => void) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDecorations(view, resolveWikilink, resolveAttachment); }
      update(update: ViewUpdate): void {
        // Rebuilt unconditionally (not just on docChanged/viewportChanged/
        // selectionSet): Lezer's incremental parser can finish parsing a
        // range *after* the initial synchronous build, which surfaces as a
        // language state-field change rather than any of those three flags —
        // skipping the rebuild then left late-parsed lines undecorated.
        // Notes are small documents; recomputing on every update is cheap.
        this.decorations = buildDecorations(update.view, resolveWikilink, resolveAttachment);
      }
    },
    { decorations: (v) => v.decorations },
  );

function clickHandler(onWikilinkClick: (id: number) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      const target = e.target as HTMLElement;
      const wikilink = target.closest?.('.cm-md-wikilink');
      if (wikilink) {
        const id = wikilink.getAttribute('data-note-id');
        if (id) { e.preventDefault(); onWikilinkClick(Number(id)); return true; }
      }
      const link = target.closest?.('.cm-md-link');
      const url = link?.getAttribute('data-url');
      if (url && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, '_blank'));
        return true;
      }
      void view;
      return false;
    },
  });
}

function keydownHandler(onKeyDown?: (e: KeyboardEvent, view: EditorView) => boolean): Extension {
  return EditorView.domEventHandlers({
    keydown(e, view) {
      if (onKeyDown?.(e, view)) { e.preventDefault(); return true; }
      return false;
    },
  });
}

function pasteDropHandler(onImageFile: (file: File) => void): Extension {
  return EditorView.domEventHandlers({
    paste(e) {
      const items = e.clipboardData?.items;
      if (!items) return false;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); onImageFile(file); return true; }
        }
      }
      return false;
    },
    drop(e) {
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) { e.preventDefault(); onImageFile(file); return true; }
      return false;
    },
  });
}

function wrapSelectionCommand(marker: string) {
  return (view: EditorView): boolean => {
    const { from, to } = view.state.selection.main;
    const text = view.state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: `${marker}${text}${marker}` },
      selection: { anchor: from + marker.length, head: to + marker.length },
    });
    return true;
  };
}

export function createNoteEditor(container: HTMLElement, opts: NoteEditorOptions): EditorView {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) opts.onChange(update.state.doc.toString());
    if (update.docChanged || update.selectionSet) opts.onCursorActivity?.(update.view);
  });

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      history(),
      drawSelection(),
      placeholder(opts.placeholder || 'Start writing…'),
      markdown({ base: markdownLanguage, extensions: [GFM], addKeymap: true }),
      livePreviewPlugin(opts.resolveWikilink, opts.resolveAttachmentUrl),
      clickHandler(opts.onWikilinkClick),
      pasteDropHandler(opts.onImageFile),
      Prec.highest(keydownHandler(opts.onKeyDown)),
      keymap.of([
        { key: 'Mod-b', run: wrapSelectionCommand('**') },
        { key: 'Mod-i', run: wrapSelectionCommand('*') },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      updateListener,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true' }),
    ],
  });

  return new EditorView({ state, parent: container });
}

/** Inserts `prefix` at the start of the current line (for `# `, `- `, `> `,
 * `- [ ] `, etc.) — used by the toolbar and slash-command menu. */
export function insertLinePrefix(view: EditorView, prefix: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({ changes: { from: line.from, insert: prefix }, selection: { anchor: line.from + prefix.length + (view.state.selection.main.head - line.from) } });
  view.focus();
}

export function insertCodeBlock(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.sliceString(from, to);
  const insert = `\`\`\`\n${text}\n\`\`\``;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + 4 + text.length } });
  view.focus();
}

export function insertDivider(view: EditorView): void {
  const pos = view.state.selection.main.head;
  const insert = '\n\n---\n\n';
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
  view.focus();
}

export function setEditorDoc(view: EditorView, doc: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
}

export function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  view.focus();
}

export function wrapSelection(view: EditorView, marker: string): void {
  wrapSelectionCommand(marker)(view);
  view.focus();
}

export function insertLink(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.sliceString(from, to) || 'link text';
  const insert = `[${text}](url)`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + text.length + 3, head: from + text.length + 6 } });
  view.focus();
}
