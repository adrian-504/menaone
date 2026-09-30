// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('./persist', () => ({ persistCreateCompany: vi.fn() }));

import { S } from './state';
import { attachCompanySelector } from './companySelector';
import type { Company } from './types';
import { notifyNavigated } from './registry';

const openList = () => document.querySelector('.company-selector-popover.open');

describe('the company suggestion list', () => {
  const setup = () => {
    S.companies = [{ id: 1, name: 'Acme Holdings', industries: [] }, { id: 2, name: 'Acme Trading', industries: [] }] as unknown as Company[];
    document.getElementById('c')?.remove();
    document.body.insertAdjacentHTML('afterbegin', '<input id="c">');
    const input = document.getElementById('c') as HTMLInputElement;
    attachCompanySelector(input);
    input.focus();
    input.value = 'Acme';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  };
  it('closes on a pick and does not reopen from its own input event', () => {
    setup();
    expect(openList()).not.toBeNull();
    const row = document.querySelector('.company-selector-row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(openList()).toBeNull();
  });
  it('closes when you leave the page', () => {
    setup();
    expect(openList()).not.toBeNull();
    notifyNavigated();
    expect(openList()).toBeNull();
  });
  it('closes on a click elsewhere', () => {
    setup();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(openList()).toBeNull();
  });
});
