import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from './db';
import { today } from './utils';

/** UTF-8 BOM, matching the original app's CSV exports (so Excel opens them correctly). */
const BOM = '﻿';

/** Prompt the user for a save location (native "Save As" dialog) and write the
 * given text content there via the Rust backend (no fs permission needed on
 * the JS side — the dialog only returns a path, the actual write happens in
 * a trusted Rust command). Returns the chosen path, or null if cancelled. */
export async function saveTextFileAs(defaultName: string, contents: string, extensions: string[] = ['csv']): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: extensions.join('/').toUpperCase(), extensions }],
  });
  if (!path) return null;
  await writeTextFile(path, contents);
  return path;
}

export async function saveCsv(filenamePrefix: string, csvBody: string): Promise<string | null> {
  return saveTextFileAs(`${filenamePrefix}_${today()}.csv`, BOM + csvBody, ['csv']);
}

export async function saveJson(filenamePrefix: string, jsonBody: string): Promise<string | null> {
  return saveTextFileAs(`${filenamePrefix}_${today()}.json`, jsonBody, ['json']);
}

/** Prompt the user to pick a .json file (native "Open" dialog) and return its
 * text content, or null if cancelled. */
export async function pickAndReadJsonFile(): Promise<string | null> {
  const path = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path || Array.isArray(path)) return null;
  return readTextFile(path);
}

/** CSV field escaping: wrap in quotes and double any embedded quotes whenever
 * the field contains a comma, quote or newline — standard RFC 4180 behaviour,
 * matching what the original app's inline `csvCell()`-style logic did. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}
