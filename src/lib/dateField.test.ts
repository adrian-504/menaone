// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { upgradeDateField } from './dateField';

const field = (value = '') => {
  document.body.innerHTML = `<input type="date" value="${value}" onchange="">`;
  const el = document.querySelector('input')!;
  upgradeDateField(el);
  return el;
};
const shown = (el: HTMLInputElement) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(el);
const type = (el: HTMLInputElement, text: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  Object.defineProperty(el, '__typed', { value: true, configurable: true });
};

describe('one date control', () => {
  it('shows the date the app way; .value stays ISO for everything that reads it', () => {
    const el = field('2026-10-02');
    expect(el.type).toBe('text');
    expect(shown(el)).toBe('2 Oct 2026');
    expect(el.value).toBe('2026-10-02');
    el.value = '2026-12-24';
    expect(shown(el)).toBe('24 Dec 2026');
  });

  it('typed text is kept on Enter (and tells the page), bad text goes back', () => {
    // A start date that "tomorrow" can never be, whatever day the test runs.
    const el = field('2020-01-02');
    const changed = vi.fn();
    el.addEventListener('change', () => changed(el.value));
    type(el, 'tomorrow');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(el.value).not.toBe('2020-01-02');
    expect(changed).toHaveBeenCalledTimes(1);
    type(el, 'banana');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(el.classList.contains('shake')).toBe(true);
    type(el, '2 Oct 2025');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(el.value).toBe('2025-10-03');
    expect(changed).toHaveBeenLastCalledWith('2025-10-03');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    expect(el.value).toBe('2025-09-26');
    expect(shown(el)).toBe('26 Sept 2025');
  });

  it('an empty field starts at today on ↑', () => {
    const el = field('');
    expect(el.value).toBe('');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(el.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
