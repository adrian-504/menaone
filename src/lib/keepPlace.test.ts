// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { findFocus, focusAddress, keepPlace } from './keepPlace';

const list = (ids: number[]) => `<div id="fu-list">${ids.map((id) => `<div class="pq-row" data-row-id="${id}" tabindex="0"><a href="#c">Client</a><button>Client asked for changes</button><button>Followed up</button></div>`).join('')}</div>`;
const draw = (ids: number[]) => { document.body.innerHTML = list(ids); };
const button = (id: number, n: number) => document.querySelectorAll<HTMLElement>(`[data-row-id="${id}"] button`)[n];

describe('keeping your place through a redraw (1.64)', () => {
  beforeEach(() => draw([1, 2, 3]));

  it('says where the focus is: the list, the row, and which control in it', () => {
    button(2, 1).focus();
    expect(focusAddress(document.activeElement)).toEqual({ scope: 'fu-list', attr: 'data-row-id', value: '2', control: 2, rowIndex: 1 });
    document.querySelector<HTMLElement>('[data-row-id="3"]')!.focus();
    expect(focusAddress(document.activeElement)).toMatchObject({ value: '3', control: -1 });
    expect(focusAddress(document.body)).toBeNull();
  });

  it('a redraw keeps the focus on the same control of the same row', () => {
    button(2, 1).focus();
    keepPlace(() => draw([1, 2, 3]));
    expect(document.activeElement).toBe(button(2, 1));
  });

  it('the row moved in the list: the focus follows it', () => {
    button(1, 1).focus();
    keepPlace(() => draw([2, 3, 1]));
    expect(document.activeElement).toBe(button(1, 1));
  });

  it('the row left the list: the focus goes to the row that took its place, and to the last row when it was last', () => {
    button(2, 1).focus();
    keepPlace(() => draw([1, 3]));
    expect(document.activeElement).toBe(button(3, 1));
    keepPlace(() => draw([1]));
    expect(document.activeElement).toBe(button(1, 1));
  });

  it('leaves the focus alone when the redraw did not take it, and does nothing when the list is empty', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="fu-search">');
    const search = document.getElementById('fu-search')!;
    search.focus();
    keepPlace(() => { document.getElementById('fu-list')!.innerHTML = ''; });
    expect(document.activeElement).toBe(search);
    expect(findFocus({ scope: 'fu-list', attr: 'data-row-id', value: '9', control: 0, rowIndex: 0 })).toBeNull();
  });

  it('puts the scroll position back when the redraw moved it', () => {
    let y = 300;
    const calls: number[] = [];
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    window.scrollTo = ((_: number, to: number) => { calls.push(to); y = to; }) as typeof window.scrollTo;
    keepPlace(() => { y = 0; });
    expect(calls).toEqual([300]);
    keepPlace(() => {});
    expect(calls).toEqual([300]);
  });
});
