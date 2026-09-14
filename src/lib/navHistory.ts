// Back/forward history of places in the app, kept independent of the DOM so
// it can be tested on its own. The router (src/core/router.ts) owns one.

export type RecordKind = 'company' | 'contact' | 'proposal' | 'agreement' | 'opportunity' | 'project' | 'meeting' | 'note' | 'task';

/** Somewhere you can be: a module (tab), optionally with one record open in it. */
export interface Place {
  tab: string;
  kind?: RecordKind;
  key?: number | string;
}

export function placeKey(p: Place): string {
  return p.kind != null && p.key != null ? `${p.tab}/${p.kind}/${p.key}` : p.tab;
}

export function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  return !!a && !!b && placeKey(a) === placeKey(b);
}

export class NavHistory {
  private entries: Place[] = [];
  private index = -1;

  constructor(private readonly limit = 100) {}

  get current(): Place | undefined {
    return this.entries[this.index];
  }

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** Records arriving somewhere new. Visiting the current place again is a
   * no-op; visiting anywhere else drops the forward history, like a browser. */
  visit(place: Place): boolean {
    if (samePlace(this.current, place)) return false;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(place);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  back(): Place | undefined {
    if (!this.canGoBack) return undefined;
    this.index -= 1;
    return this.current;
  }

  forward(): Place | undefined {
    if (!this.canGoForward) return undefined;
    this.index += 1;
    return this.current;
  }

  /** Where a back/forward step actually landed can differ from the entry
   * (e.g. the record was deleted since) — correct the entry in place. */
  replaceCurrent(place: Place): void {
    if (this.index < 0) { this.visit(place); return; }
    this.entries[this.index] = place;
    // Collapse an adjacent duplicate this correction may have produced.
    if (samePlace(this.entries[this.index - 1], place)) {
      this.entries.splice(this.index, 1);
      this.index -= 1;
    }
  }
}
