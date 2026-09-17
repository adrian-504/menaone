// Settings for the commercial side: the team directory, business entities
// with exchange rates, the OneDrive Proposals folder, and a tidy-up of the
// free-text owner values older proposals carry.

import { S } from '../lib/state';
import { escHtml, expose, showConfirm } from '../lib/utils';
import { icon } from '../lib/icons';
import { toast } from '../lib/ui';
import { persistProposals, persistAgreements } from '../lib/persist';
import { refreshAll } from '../lib/registry';
import { saveTeamMember, deleteTeamMember, saveBusinessEntity, setFxRate, setProposalsRoot, getCommercialSetup } from '../lib/db';
import { LEAD_SOURCES } from '../lib/constants';
import { REPORTING_CURRENCY } from '../lib/commercial';
import { renderIcons } from '../core/chrome';
import type { TeamMember, BusinessEntity } from '../lib/types';

export function renderCommercialSettings(): void {
  renderTeam();
  renderEntities();
  renderProposalSettings();
}
expose('renderCommercialSettings', renderCommercialSettings);

// ── Team ──

/** Names typed on older records that aren't in the team yet. */
function unmatchedNames(): { name: string; count: number }[] {
  const known = S.team.map((t) => t.name.toLowerCase());
  const matches = (n: string) => known.some((k) => k === n.toLowerCase() || k.startsWith(`${n.toLowerCase()} `));
  const sources = new Set(LEAD_SOURCES.map((x) => x.toLowerCase()));
  const counts = new Map<string, number>();
  const add = (raw: string | null | undefined) => {
    const n = (raw || '').trim();
    if (!n || n.toLowerCase() === 'other' || sources.has(n.toLowerCase()) || matches(n)) return;
    counts.set(n, (counts.get(n) || 0) + 1);
  };
  S.proposals.filter((p) => p.ownerId == null).forEach((p) => add(p.owner));
  S.agreements.filter((a) => a.preparedById == null).forEach((a) => add(a.preparedBy));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function renderTeam(): void {
  const el = document.getElementById('team-directory');
  if (!el) return;
  const rows = S.team.map((t) => `<div class="team-row${t.active ? '' : ' is-unavailable'}">
    <input class="td-input team-name" value="${escHtml(t.name)}" aria-label="Name" onchange="teamFieldChanged(${t.id}, 'name', this.value)">
    <input class="td-input" value="${escHtml(t.jobTitle || '')}" placeholder="Role" aria-label="Role" onchange="teamFieldChanged(${t.id}, 'jobTitle', this.value)">
    <input class="td-input" type="email" value="${escHtml(t.email || '')}" placeholder="Email" aria-label="Email" onchange="teamFieldChanged(${t.id}, 'email', this.value)">
    <label class="check-label" title="Offered as a reviewer on proposals"><input type="checkbox" ${t.isReviewer ? 'checked' : ''} onchange="teamFieldChanged(${t.id}, 'isReviewer', this.checked)"> Reviewer</label>
    <label class="check-label" title="Inactive people stay on old records but aren't offered for new ones"><input type="checkbox" ${t.active ? 'checked' : ''} onchange="teamFieldChanged(${t.id}, 'active', this.checked)"> Active</label>
    <button class="rec-icon-btn" onclick="removeTeamMember(${t.id})" title="Remove" aria-label="Remove ${escHtml(t.name)}">${icon('trash', 13)}</button>
  </div>`).join('');
  const suggestions = unmatchedNames();
  el.innerHTML = `<div class="team-list">${rows || '<div class="feed-empty">No one added yet.</div>'}</div>
    <form class="team-add" onsubmit="event.preventDefault();addTeamMember(this.elements.teamName.value)">
      <input class="finp" name="teamName" placeholder="Full name" aria-label="New team member name">
      <button class="btn-secondary" type="submit">${icon('plus', 13)} Add person</button>
    </form>
    ${suggestions.length ? `<div class="settings-subsection"><div class="settings-subsection-title">Names on older records</div>
      <p class="settings-card-desc">Owners and "prepared by" names typed before the team directory existed. Add the people — use their full name — then link their records under Proposals below.</p>
      <div class="chip-row">${suggestions.map((sg) => `<button class="prb-chip" onclick="addTeamMember('${escHtml(sg.name.replace(/'/g, "\\'"))}')">${icon('plus', 11)}${escHtml(sg.name)} <span class="t-muted">${sg.count}</span></button>`).join('')}</div></div>` : ''}`;
  renderIcons(el);
}

async function saveMember(member: TeamMember): Promise<void> {
  try {
    const saved = await saveTeamMember(member);
    const i = S.team.findIndex((t) => t.id === saved.id);
    if (i > -1) S.team[i] = saved; else S.team.push(saved);
    (window as any).fillTeamNames?.();
  } catch (err) {
    toast('Could not save', { tone: 'error', detail: String(err) });
  }
  renderCommercialSettings();
}

export async function addTeamMember(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  await saveMember({ id: 0, name: n, email: null, jobTitle: null, department: null, isReviewer: false, active: true, notes: null });
  toast(`${n} added to the team`, { tone: 'success' });
}
expose('addTeamMember', addTeamMember);

export async function teamFieldChanged(id: number, key: keyof TeamMember, value: string | boolean): Promise<void> {
  const t = S.team.find((x) => x.id === id);
  if (!t) return;
  const next = { ...t, [key]: typeof value === 'string' ? value.trim() || (key === 'name' ? t.name : null) : value } as TeamMember;
  await saveMember(next);
  // Records show a member's current name.
  if (key === 'name' && next.name !== t.name) {
    S.proposals.filter((p) => p.ownerId === id).forEach((p) => { p.owner = next.name; });
    S.agreements.filter((a) => a.preparedById === id).forEach((a) => { a.preparedBy = next.name; });
    persistProposals();
    persistAgreements();
  }
}
expose('teamFieldChanged', teamFieldChanged);

export async function removeTeamMember(id: number): Promise<void> {
  const t = S.team.find((x) => x.id === id);
  if (!t) return;
  const owned = S.proposals.filter((p) => p.ownerId === id).length;
  const reviewing = S.proposals.filter((p) => p.reviewerId === id).length;
  const msg = owned || reviewing
    ? `${t.name} owns ${owned} and reviews ${reviewing} proposal${owned + reviewing === 1 ? '' : 's'}. Their name stays on those records as text. To keep them offered on old records, mark them inactive instead.`
    : `Remove ${t.name} from the team?`;
  if (!(await showConfirm(msg, { title: 'Remove from team?', confirmLabel: 'Remove' }))) return;
  try {
    await deleteTeamMember(id);
    S.team = S.team.filter((x) => x.id !== id);
    S.proposals.forEach((p) => { if (p.ownerId === id) p.ownerId = null; if (p.reviewerId === id) p.reviewerId = null; });
    S.agreements.forEach((a) => { if (a.preparedById === id) a.preparedById = null; });
    renderCommercialSettings();
  } catch (err) {
    toast('Could not remove', { tone: 'error', detail: String(err) });
  }
}
expose('removeTeamMember', removeTeamMember);

// ── Entities and rates ──

function renderEntities(): void {
  const el = document.getElementById('entity-settings');
  if (!el) return;
  const rows = S.businessEntities.map((e) => `<div class="entity-row">
    <input class="td-input entity-name" value="${escHtml(e.name)}" aria-label="Entity name" onchange="entityFieldChanged(${e.id}, 'name', this.value)">
    <input class="td-input entity-code" value="${escHtml(e.code)}" aria-label="Code" onchange="entityFieldChanged(${e.id}, 'code', this.value)">
    <input class="td-input entity-cur" value="${escHtml(e.currency)}" maxlength="3" aria-label="Currency" onchange="entityFieldChanged(${e.id}, 'currency', this.value)">
    <label class="entity-vat"><input class="td-input" type="number" min="0" max="100" step="0.5" value="${e.vatRate ?? ''}" placeholder="—" aria-label="VAT rate" onchange="entityFieldChanged(${e.id}, 'vatRate', this.value)"><span>% VAT</span></label>
    <label class="check-label"><input type="checkbox" ${e.active ? 'checked' : ''} onchange="entityFieldChanged(${e.id}, 'active', this.checked)"> In use</label>
  </div>`).join('');
  const others = [...new Set(S.businessEntities.map((e) => e.currency))].filter((c) => c !== REPORTING_CURRENCY);
  const rates = others.map((c) => `<label class="fx-row"><span>1 ${escHtml(c)} =</span><input class="td-input" type="number" min="0" step="0.0001" value="${S.fxRates[c] ?? ''}" placeholder="Not set" onchange="fxRateChanged('${escHtml(c)}', this.value)"><span>${REPORTING_CURRENCY}</span></label>`).join('');
  el.innerHTML = `<div class="entity-list">${rows}</div>
    ${others.length ? `<div class="settings-subsection"><div class="settings-subsection-title">Exchange rates</div><p class="settings-card-desc">Used only for converted totals in reports. Amounts on proposals and agreements are never converted.</p>${rates}</div>` : ''}`;
}

export async function entityFieldChanged(id: number, key: keyof BusinessEntity, value: string | boolean): Promise<void> {
  const e = S.businessEntities.find((x) => x.id === id);
  if (!e) return;
  const next = { ...e } as any;
  if (key === 'vatRate') next.vatRate = value === '' ? null : Number(value);
  else if (key === 'currency') next.currency = String(value).trim().toUpperCase();
  else next[key] = typeof value === 'string' ? value.trim() : value;
  try {
    const saved = await saveBusinessEntity(next);
    const i = S.businessEntities.findIndex((x) => x.id === saved.id);
    if (i > -1) S.businessEntities[i] = saved;
  } catch (err) {
    toast('Could not save', { tone: 'error', detail: String(err) });
  }
  renderEntities();
  refreshAll();
}
expose('entityFieldChanged', entityFieldChanged);

export async function fxRateChanged(currency: string, value: string): Promise<void> {
  try {
    S.fxRates = await setFxRate(currency, value.trim() ? Number(value) : null);
    refreshAll();
  } catch (err) {
    toast('Could not save the rate', { tone: 'error', detail: String(err) });
  }
}
expose('fxRateChanged', fxRateChanged);

// ── Proposals folder and owner tidy-up ──

function ownerValues(): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  S.proposals.filter((p) => p.ownerId == null && (p.owner || '').trim()).forEach((p) => {
    const v = p.owner!.trim();
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function renderProposalSettings(): void {
  const el = document.getElementById('proposal-settings');
  if (!el) return;
  const owners = ownerValues();
  const teamOpts = S.team.filter((t) => t.active).map((t) => `<option value="team:${t.id}">${escHtml(t.name)}</option>`).join('');
  const sourceOpts = LEAD_SOURCES.map((s) => `<option value="source:${escHtml(s)}">Lead source: ${escHtml(s)}</option>`).join('');
  const guessSource = (v: string) => LEAD_SOURCES.find((s) => s.toLowerCase() === v.toLowerCase());
  el.innerHTML = `<div class="settings-status">
      <span class="status-dot settings-status-dot" style="background:${S.proposalsRoot ? 'var(--green)' : 'var(--muted)'}"></span>
      <div class="settings-status-text">
        <div class="settings-status-title">${S.proposalsRoot ? 'Proposals folder' : 'No Proposals folder found'}</div>
        <div class="settings-status-sub">${S.proposalsRoot ? `<code class="path-code">${escHtml(S.proposalsRoot)}</code>` : 'Choose the OneDrive folder that holds one subfolder per client.'}</div>
      </div>
      <button class="btn-secondary" onclick="chooseProposalsRoot()">Choose…</button>
    </div>
    <div class="settings-subsection">
      <div class="settings-subsection-title">Owner values on older proposals</div>
      ${owners.length ? `<p class="settings-card-desc">The old "Lead owner / source" box held both people and sources. Say what each value is — every proposal with it is updated. Values you leave alone stay as they are.</p>
      <div class="owner-cleanup">${owners.map((o) => `<div class="settings-list-row">
        <div><span class="fw-600">${escHtml(o.value)}</span> <span class="t-meta t-muted">${o.count} proposal${o.count === 1 ? '' : 's'}</span></div>
        <select class="td-select" onchange="resolveOwnerValue('${escHtml(o.value.replace(/'/g, "\\'"))}', this.value)" aria-label="What ${escHtml(o.value)} is">
          <option value="">Leave as is</option>
          ${teamOpts ? `<optgroup label="A team member">${teamOpts}</optgroup>` : ''}
          <optgroup label="Where the lead came from">${guessSource(o.value) ? `<option value="source:${escHtml(guessSource(o.value)!)}">Lead source: ${escHtml(guessSource(o.value)!)} (suggested)</option>` : ''}${sourceOpts}</optgroup>
        </select>
      </div>`).join('')}</div>` : '<p class="settings-card-desc">Every proposal owner is linked to a team member.</p>'}
    </div>`;
}

export async function resolveOwnerValue(value: string, choice: string): Promise<void> {
  if (!choice) return;
  const affected = S.proposals.filter((p) => p.ownerId == null && (p.owner || '').trim() === value);
  if (choice.startsWith('team:')) {
    const member = S.team.find((t) => t.id === Number(choice.slice(5)));
    if (!member) return;
    if (!(await showConfirm(`Set ${member.name} as the owner of ${affected.length} proposal${affected.length === 1 ? '' : 's'} marked "${value}"?`, { confirmLabel: 'Update' }))) { renderProposalSettings(); return; }
    affected.forEach((p) => { p.ownerId = member.id; p.owner = member.name; });
  } else if (choice.startsWith('source:')) {
    const source = choice.slice(7);
    if (!(await showConfirm(`Record "${source}" as the lead source of ${affected.length} proposal${affected.length === 1 ? '' : 's'} and clear "${value}" from their owner?`, { confirmLabel: 'Update' }))) { renderProposalSettings(); return; }
    affected.forEach((p) => { if (!p.leadSource) p.leadSource = source; p.owner = null; });
  }
  persistProposals();
  toast(`${affected.length} proposal${affected.length === 1 ? '' : 's'} updated`, { tone: 'success' });
  renderCommercialSettings();
  refreshAll();
}
expose('resolveOwnerValue', resolveOwnerValue);

export async function chooseProposalsRoot(): Promise<void> {
  let picked: string | null = null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: true, multiple: false, defaultPath: S.proposalsRoot || undefined, title: 'Choose the Proposals folder' });
    picked = typeof result === 'string' ? result : null;
  } catch (err) {
    toast('Could not open the folder picker', { tone: 'error', detail: String(err) });
    return;
  }
  if (!picked) return;
  try {
    const setup = await setProposalsRoot(picked);
    S.proposalsRoot = setup.proposalsRoot;
    renderProposalSettings();
    toast('Proposals folder saved', { tone: 'success' });
  } catch (err) {
    toast('That folder can’t be used', { tone: 'error', detail: String(err) });
  }
}
expose('chooseProposalsRoot', chooseProposalsRoot);

export async function reloadCommercialSettings(): Promise<void> {
  (window as any).applyCommercialSetup?.(await getCommercialSetup());
  renderCommercialSettings();
}
