// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collapseEmptySections } from './sectionLayout';

function section(id: string): HTMLElement {
  const el = document.createElement('section');
  el.id = id;
  el.innerHTML = `<div class="rec-section-hd"><h2>${id}</h2><div class="rec-section-actions"><button>+ New</button></div></div>`;
  return el;
}

describe('collapseEmptySections', () => {
  it('empty sections collapse to a line and sink below the full ones, which keep their order', () => {
    const host = document.createElement('div');
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(section);
    const files = section('files');
    host.append(a, b, c, d, files);
    collapseEmptySections(host, [{ el: a, empty: true }, { el: b, empty: false }, { el: c, empty: true }, { el: d, empty: false }], files);
    expect([...host.children].map((x) => x.id)).toEqual(['b', 'd', 'a', 'c', 'files']);
    expect(a.classList.contains('is-empty')).toBe(true);
    expect(a.querySelector('.rec-empty-hint')?.textContent).toBe('None yet');
    expect(b.querySelector('.rec-empty-hint')).toBeNull();
  });

  it('clicking the line opens the section; filling it removes the hint', () => {
    const host = document.createElement('div');
    const a = section('a');
    host.append(a);
    collapseEmptySections(host, [{ el: a, empty: true }]);
    (a.querySelector('.rec-empty-hint') as HTMLElement).click();
    expect(a.classList.contains('is-empty')).toBe(false);
    collapseEmptySections(host, [{ el: a, empty: false }]);
    expect(a.querySelector('.rec-empty-hint')).toBeNull();
  });
});
