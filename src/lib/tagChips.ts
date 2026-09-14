// Shared tag-chip editor — used by both Notes and Tasks so the two features
// don't grow divergent tag-editing UIs. Renders removable pills + a text
// input that commits a new tag on Enter/comma, with backspace-on-empty
// removing the last chip (standard chip-input idiom).
import { escHtml } from './utils';

interface TagChipOptions {
  placeholder?: string;
  suggestions?: string[];
}

export function renderTagChips(
  container: HTMLElement,
  tags: string[],
  onChange: (tags: string[]) => void,
  opts: TagChipOptions = {},
): void {
  paint(container, tags, onChange, opts, false);
}

function paint(
  container: HTMLElement,
  tags: string[],
  onChange: (tags: string[]) => void,
  opts: TagChipOptions,
  focusInput: boolean,
): void {
  const listId = `${container.id || 'tagchips'}-suggestions`;
  container.innerHTML = `
    ${tags.map((t, i) => `<span class="tag-chip">${escHtml(t)}<button type="button" class="tag-chip-remove" data-i="${i}" title="Remove">&times;</button></span>`).join('')}
    <input type="text" class="tag-chip-input-field" placeholder="${escHtml(opts.placeholder || 'Add tag…')}" list="${listId}" autocomplete="off">
    ${opts.suggestions?.length ? `<datalist id="${listId}">${opts.suggestions.map((s) => `<option value="${escHtml(s)}">`).join('')}</datalist>` : ''}
  `;

  const commit = (next: string[]) => {
    onChange(next);
    paint(container, next, onChange, opts, true);
  };

  container.querySelectorAll('.tag-chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number((btn as HTMLElement).dataset.i);
      commit(tags.filter((_, idx) => idx !== i));
    });
  });

  const input = container.querySelector('.tag-chip-input-field') as HTMLInputElement | null;
  if (!input) return;
  if (focusInput) input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !tags.includes(val)) commit([...tags, val]);
      else input.value = '';
    } else if (e.key === 'Backspace' && input.value === '' && tags.length > 0) {
      commit(tags.slice(0, -1));
    }
  });
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (val && !tags.includes(val)) commit([...tags, val]);
  });
}
