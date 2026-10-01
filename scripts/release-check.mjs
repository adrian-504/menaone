#!/usr/bin/env node
// Release check (owner, 30-Sep-2026): a build stops unless package.json and
// src-tauri/tauri.conf.json carry the same version and CHANGELOG.md has an entry
// for it ("## 1.50 — 2026-09-30"). Versions are 1.N, N counting installs; the
// files hold them as 1.N.0 (semver, which Tauri needs). Run before every build
// (package.json "build").

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** "1.50.0" → "1.50". */
export const shortVersion = (v) => String(v || '').trim().replace(/^(\d+\.\d+)\.0$/, '$1');

/** The problems with a release, in plain words; empty when it is fine. */
export function checkRelease({ packageVersion, confVersion, changelog }) {
  const errors = [];
  if (!packageVersion) errors.push('package.json has no version.');
  if (packageVersion && confVersion !== packageVersion) {
    errors.push(`Versions differ: package.json ${packageVersion}, tauri.conf.json ${confVersion ?? 'none'}.`);
  }
  const v = shortVersion(packageVersion);
  const heading = new RegExp(`^## ${v.replace(/\./g, '\\.')} — \\d{4}-\\d{2}-\\d{2}\\s*$`, 'm');
  if (v && !heading.test(changelog || '')) errors.push(`CHANGELOG.md has no entry "## ${v} — YYYY-MM-DD".`);
  return errors;
}

/** Only scripts/lib/chrome.mjs may launch Chrome or make a temp folder: a script that makes its own Chrome profile
 * leaves 80–180 MB behind on every run (1-Oct-2026: 27 GB in the system temp folder). `files` is [path, text] for
 * every file under scripts/. Returns the problems, in plain words. */
export function checkScripts(files) {
  const errors = [];
  for (const [path, text] of files) {
    if (path.endsWith('lib/chrome.mjs') || path.endsWith('release-check.mjs')) continue;
    for (const word of ['user-data-dir', 'mkdtemp']) {
      if (text.includes(word)) errors.push(`${path} uses "${word}": launch Chrome through scripts/lib/chrome.mjs, which keeps its profile in .cache and removes it.`);
    }
  }
  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (p) => readFileSync(resolve(root, p), 'utf8');
  const errors = checkRelease({
    packageVersion: JSON.parse(read('package.json')).version,
    confVersion: JSON.parse(read('src-tauri/tauri.conf.json')).version,
    changelog: read('CHANGELOG.md'),
  });
  const walk = (dir) => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  errors.push(...checkScripts(walk('scripts').filter((p) => /\.(mjs|js|ts|sh|py)$/.test(p)).map((p) => [p, read(p)])));
  if (errors.length) {
    console.error(`Release check failed:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Release check: ${shortVersion(JSON.parse(read('package.json')).version)} ok`);
}
