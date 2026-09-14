import { saveTextFileDialog } from './db';
import { today } from './utils';

/** UTF-8 BOM, matching the original app's CSV exports (so Excel opens them correctly). */
const BOM = '\uFEFF';

/** Asks for a save location (system "Save As" dialog, shown by the Rust
 * side) and writes the text there. Returns the chosen path, or null if cancelled. */
export async function saveTextFileAs(defaultName: string, contents: string, extensions: string[] = ['csv']): Promise<string | null> {
  return saveTextFileDialog(defaultName, contents, extensions);
}

export async function saveCsv(filenamePrefix: string, csvBody: string): Promise<string | null> {
  return saveTextFileAs(`${filenamePrefix}_${today()}.csv`, BOM + csvBody, ['csv']);
}

export async function saveJson(filenamePrefix: string, jsonBody: string): Promise<string | null> {
  return saveTextFileAs(`${filenamePrefix}_${today()}.json`, jsonBody, ['json']);
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
