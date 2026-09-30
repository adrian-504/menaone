// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore -- Node's fs, in a test only.
import { existsSync, readFileSync } from 'node:fs';
import { OPTIONAL_MODULES, applySidebarModules, itemVisible, moduleShown, setModuleShown } from './sidebarModules';
import { GOTO } from '../core/appKeys';

const sidebar = () => {
  document.body.innerHTML = `<div id="sidebar">
    <div class="sb-group" data-group="sales"><button class="sb-item" data-tab="opportunities"></button><button class="sb-item" data-tab="agreements"></button><button class="sb-item" data-tab="pricing"></button></div>
    <div class="sb-group" data-group="insights"><button class="sb-item" data-tab="dashboard"></button><button class="sb-item" data-tab="reports"></button><button class="sb-item" data-tab="analytics"></button></div>
  </div>`;
};
const hidden = (tab: string) => (document.querySelector(`.sb-item[data-tab="${tab}"]`) as HTMLElement).hidden;
const groupHidden = (g: string) => (document.querySelector(`.sb-group[data-group="${g}"]`) as HTMLElement).hidden;

describe('sidebar modules on and off', () => {
  beforeEach(() => { localStorage.clear(); sidebar(); });

  it('the optional modules start off; core ones are always on', () => {
    for (const m of OPTIONAL_MODULES) expect(moduleShown(m.tab), m.tab).toBe(false);
    expect(moduleShown('opportunities')).toBe(true);
    expect(moduleShown('myday')).toBe(true);
  });

  it('a switch is remembered', () => {
    setModuleShown('agreements', true);
    expect(moduleShown('agreements')).toBe(true);
    setModuleShown('agreements', false);
    expect(moduleShown('agreements')).toBe(false);
  });

  it('a hidden module shows while it is the page you are on', () => {
    expect(itemVisible('agreements', 'agreements', {})).toBe(true);
    expect(itemVisible('agreements', 'myday', {})).toBe(false);
    applySidebarModules('agreements');
    expect(hidden('agreements')).toBe(false);
    applySidebarModules('myday');
    expect(hidden('agreements')).toBe(true);
    expect(hidden('opportunities')).toBe(false);
  });

  it('a group with nothing visible goes; it comes back with one', () => {
    applySidebarModules(null);
    expect(groupHidden('insights')).toBe(true);
    expect(groupHidden('sales')).toBe(false);
    setModuleShown('reports', true);
    applySidebarModules(null);
    expect(groupHidden('insights')).toBe(false);
    expect(hidden('dashboard')).toBe(true);
  });

  it('⌘1–9 (and the native Go menu) only point at core modules, so hiding never breaks them', () => {
    for (const [tab] of GOTO) expect(OPTIONAL_MODULES.some((m) => m.tab === tab), tab).toBe(false);
  });
});

describe('the app icon', () => {
  // @ts-ignore -- Node's process, in a test only.
  const dir = `${process.cwd()}/src-tauri/icons/`;
  const size = (file: string) => {
    const b = readFileSync(dir + file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  it('has every file the bundle names, at its size', () => {
    for (const [file, px] of [['32x32.png', 32], ['64x64.png', 64], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512], ['app-icon-source.png', 1024], ['Square30x30Logo.png', 30], ['Square310x310Logo.png', 310]] as const) {
      expect(size(file), file).toEqual([px, px]);
    }
    expect(existsSync(dir + 'icon.icns')).toBe(true);
    expect(existsSync(dir + 'icon.ico')).toBe(true);
  });
});
