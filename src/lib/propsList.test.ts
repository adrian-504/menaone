// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountPropsList, propsEdit, propsEditAll, propsListHtml, type PropField } from './propsList';

// A stand-in page: one record, a change handler that saves and redraws, like the real pages.
function page() {
  const rec = { notice: '60', remarks: '' };
  const saves: string[] = [];
  const save = (key: string, value: string) => { (rec as any)[key] = value; saves.push(`${key}=${value}`); render(); };
  // The pages wire controls with inline onchange; jsdom runs those in its own global, so here the same handler is attached on mount.
  const wire = (key: string) => (dd: HTMLElement) => dd.querySelector('input, textarea')!.addEventListener('change', (e) => save(key, (e.target as HTMLInputElement).value));
  document.body.innerHTML = '<dl id="list"></dl><h1 id="elsewhere">Title</h1>';
  const fields = (): PropField[] => [
    { key: 'notice', label: 'Notice', display: rec.notice ? `${rec.notice} days` : '', control: () => `<input id="f-notice" value="${rec.notice}">`, mount: wire('notice') },
    { key: 'remarks', label: 'Remarks', display: rec.remarks, control: () => `<textarea id="f-remarks">${rec.remarks}</textarea>`, mount: wire('remarks') },
    { key: 'link', label: 'Proposal', display: '<a href="#">SL# 1</a>' },
  ];
  const render = () => { document.getElementById('list')!.innerHTML = propsListHtml('list', fields(), render); mountPropsList('list'); };
  render();
  const dd = (key: string) => document.querySelector<HTMLElement>(`dd[data-key="${key}"]`);
  return { rec, saves, dd };
}

describe('propsList: read first, edit on demand', () => {
  it('shows values as text, hides empty optional ones, and has no inputs', () => {
    const { dd } = page();
    expect(document.querySelectorAll('input, textarea').length).toBe(0);
    expect(dd('notice')!.textContent!.trim()).toBe('60 days');
    expect(dd('remarks')).toBeNull();
    expect(document.querySelector('dd.pl-ro')!.innerHTML).toContain('SL# 1');
  });

  it('a click edits one value; a change saves through the page and returns to text', () => {
    const { dd, saves, rec } = page();
    propsEdit('list', 'notice'); // what a click on the value does
    const input = document.getElementById('f-notice') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    input.value = '45';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saves).toEqual(['notice=45']);
    expect(rec.notice).toBe('45');
    expect(document.querySelectorAll('input').length).toBe(0);
    expect(dd('notice')!.textContent!.trim()).toBe('45 days');
  });

  it('Esc puts the old value back without saving and returns focus to the row', () => {
    const { dd, saves } = page();
    expect(dd('notice')!.getAttribute('onkeydown')).toContain("propsEdit('list','notice')"); // Enter on the row
    propsEdit('list', 'notice');
    const input = document.getElementById('f-notice') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = '99';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(saves).toEqual([]);
    expect(dd('notice')!.textContent!.trim()).toBe('60 days');
    expect(document.activeElement).toBe(dd('notice'));
  });

  it('a click elsewhere returns the row to text', async () => {
    const { dd } = page();
    propsEdit('list', 'notice');
    expect(document.getElementById('f-notice')).not.toBeNull();
    document.getElementById('elsewhere')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById('f-notice')).toBeNull();
    expect(dd('notice')!.classList.contains('pl-val')).toBe(true);
  });

  it('Edit shows every field as the form (empty ones too); Done returns to reading', () => {
    const { saves } = page();
    propsEditAll('list', true);
    expect(document.querySelectorAll('#f-notice, #f-remarks').length).toBe(2);
    const remarks = document.getElementById('f-remarks') as HTMLTextAreaElement;
    remarks.value = 'Prefers email';
    remarks.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saves).toEqual(['remarks=Prefers email']);
    expect(document.querySelectorAll('#f-notice, #f-remarks').length).toBe(2); // still the form until Done
    propsEditAll('list', false);
    expect(document.querySelectorAll('input, textarea').length).toBe(0);
    expect(document.querySelector('dd[data-key="remarks"]')!.textContent!.trim()).toBe('Prefers email');
  });
});
