// A record page's header actions, one pattern everywhere (owner, 30-Sep-2026):
// [grey tools] [the blue next step] […]. At most one blue button.

import { escHtml } from './utils';
import { icon } from './icons';
import type { Step } from './proposalSteps';

export function recordHeaderHtml(tools: (Step | null | undefined)[], step: Step | null, moreRun: string): string {
  return [
    ...tools.filter((t): t is Step => !!t).map((t) => `<button class="btn-secondary" onclick="${escHtml(t.run)}">${escHtml(t.label)}</button>`),
    step ? `<button class="btn-primary" onclick="${escHtml(step.run)}" data-tip="${escHtml(step.label)}" aria-label="${escHtml(step.label)}">${escHtml(step.label)}</button>` : '',
    `<button class="loc-nav rec-more" onclick="${escHtml(moreRun)}" data-tip="More" aria-label="More">${icon('more', 16)}</button>`,
  ].join('');
}
