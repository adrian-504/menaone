// The Generate dialog's design choice. The current design (built from the service
// templates in Proposals New Logo) is the default; the 2026 master is offered second
// and never preselected (owner, 22-Sep-2026).

export interface DesignOption { value: string; label: string; selected: boolean }

export function designOptions(
  library: { count: number } | null,
  hasMaster: boolean,
  templates: { id: number; name: string }[],
  preferredId: number | null,
): DesignOption[] {
  const out: DesignOption[] = [];
  if (library) out.push({ value: 'library', label: `Current design — built from your service templates (${library.count} in Proposals New Logo)`, selected: true });
  if (hasMaster) out.push({ value: 'master', label: '2026 design — MENA BIG Proposal Master', selected: false });
  for (const t of templates) out.push({ value: String(t.id), label: t.name, selected: !library && t.id === preferredId });
  return out;
}
