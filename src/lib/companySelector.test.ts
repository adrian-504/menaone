// @vitest-environment jsdom
// The company picker must keep its list open while the list itself is
// scrolled (mouse wheel or trackpad), close when the page scrolls, list every
// matching company, and pick with the keyboard.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./persist', () => ({ persistCreateCompany: vi.fn() }));

import { S } from './state';
import { attachCompanySelector } from './companySelector';
import type { Company } from './types';

const company = (id: number, name: string) => ({ id, name, industries: [] }) as unknown as Company;
const pop = () => document.querySelector('.company-selector-popover') as HTMLElement;

beforeEach(() => {
  // A fresh input each time; the picker's own list element stays in the body, as in the app.
  document.getElementById('co')?.remove();
  document.body.insertAdjacentHTML('afterbegin', '<input id="co">');
  S.companies = Array.from({ length: 30 }, (_, i) => company(i + 1, `Test Co ${String(i + 1).padStart(2, '0')}`));
});

function openPicker(value = ''): HTMLInputElement {
  const input = document.getElementById('co') as HTMLInputElement;
  const onSelect = vi.fn();
  attachCompanySelector(input, { onSelect });
  input.value = value;
  input.dispatchEvent(new Event('input'));
  return input;
}

describe('company picker', () => {
  it('lists every matching company, not just the first few', () => {
    openPicker('test co');
    expect(pop().querySelectorAll('.company-selector-row[data-i]').length).toBe(30);
  });

  it('stays open while its own list scrolls, and closes when the page scrolls', () => {
    openPicker();
    expect(pop().classList.contains('open')).toBe(true);
    pop().dispatchEvent(new Event('scroll'));
    expect(pop().classList.contains('open')).toBe(true);
    document.dispatchEvent(new Event('scroll'));
    expect(pop().classList.contains('open')).toBe(false);
  });

  it('arrow keys and Enter pick a company; attaching twice keeps one set of listeners', () => {
    const input = openPicker('Test Co 0');
    attachCompanySelector(input);
    input.dispatchEvent(new Event('input'));
    Element.prototype.scrollIntoView = vi.fn();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(input.value).toBe('Test Co 02');
    expect(pop().classList.contains('open')).toBe(false);
  });
});
