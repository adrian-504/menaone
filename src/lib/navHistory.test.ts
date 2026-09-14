import { describe, it, expect } from 'vitest';
import { NavHistory, placeKey } from './navHistory';

const companies = { tab: 'companies' };
const globex = { tab: 'companies', kind: 'company' as const, key: 3 };
const project = { tab: 'projects', kind: 'project' as const, key: 12 };

describe('navigation history', () => {
  it('goes back and forward through the places actually visited', () => {
    const h = new NavHistory();
    h.visit(project);
    h.visit(globex);
    h.visit(companies);
    expect(placeKey(h.back()!)).toBe('companies/company/3');
    expect(placeKey(h.back()!)).toBe('projects/project/12');
    expect(h.canGoBack).toBe(false);
    expect(placeKey(h.forward()!)).toBe('companies/company/3');
  });

  it('ignores repeat visits and drops forward history on a new visit', () => {
    const h = new NavHistory();
    h.visit(companies);
    expect(h.visit({ tab: 'companies' })).toBe(false);
    h.visit(globex);
    h.back();
    h.visit(project);
    expect(h.canGoForward).toBe(false);
    expect(placeKey(h.back()!)).toBe('companies');
  });

  it('corrects an entry that could not be restored and caps its length', () => {
    const h = new NavHistory(3);
    h.visit(companies);
    h.visit(globex);
    h.visit(project);
    h.back();
    h.replaceCurrent(companies); // Globex was deleted: landed on the list instead
    expect(placeKey(h.current!)).toBe('companies');
    expect(h.canGoBack).toBe(false);
    for (let i = 0; i < 10; i++) h.visit({ tab: `t${i}` });
    let steps = 0;
    while (h.back()) steps++;
    expect(steps).toBe(2);
  });
});
