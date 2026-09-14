// No official types published for turndown-plugin-gfm — minimal ambient
// declaration covering the one export this codebase uses.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export function gfm(service: TurndownService): void;
}
