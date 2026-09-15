// One meaning per colour for lifecycle badges on record pages and lists:
//   green  — done: won, signed, completed, active service
//   red    — ended badly: lost, cancelled
//   amber  — waiting or at risk: with the client, on hold, at risk
//   accent — moving: open, in progress, being prepared
//   muted  — not started, withdrawn, ended
// Pipeline lists keep their per-stage dot colours (constants.ts ST/AGR_ST) so
// stages stay easy to tell apart; this is the meaning a badge carries.

export type Tone = 'green' | 'red' | 'amber' | 'accent' | 'muted';
export type StatusKind = 'proposal' | 'agreement' | 'service' | 'opportunity' | 'project' | 'task' | 'meeting';

const TONES: Record<StatusKind, Record<string, Tone>> = {
  proposal: {
    'Proposal Request Received': 'muted', Drafting: 'accent', 'In Internal Review': 'accent',
    'Sent to Client': 'amber', 'Signed by Client': 'amber', 'Signed by Both Parties': 'green', Lost: 'red', Withdrawn: 'muted',
  },
  agreement: {
    'In Preparation': 'accent', 'Client Review': 'amber', 'Client Signature': 'amber', 'MENA Signature': 'accent',
    Signed: 'green', 'On Hold': 'amber', Canceled: 'red',
  },
  service: { 'Not started': 'muted', 'Kickoff scheduled': 'accent', Active: 'green', Ended: 'muted' },
  opportunity: { Open: 'accent', Won: 'green', Lost: 'red', 'On Hold': 'amber' },
  project: {
    Idea: 'muted', Planning: 'accent', 'Not Started': 'muted', 'In Progress': 'accent', 'At Risk': 'amber',
    'On Hold': 'amber', Completed: 'green', Cancelled: 'red',
  },
  task: { Pending: 'muted', 'In Progress': 'accent', Done: 'green' },
  meeting: { Scheduled: 'accent', Held: 'green', Cancelled: 'red' },
};

export function statusTone(kind: StatusKind, status: string | null | undefined): Tone {
  return (status && TONES[kind][status]) || 'muted';
}

/** A lifecycle badge for a record header or list cell. */
export function statusBadge(kind: StatusKind, status: string | null | undefined, label = status || 'No status'): string {
  const text = String(label).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<span class="rec-badge tone-${statusTone(kind, status)}">${text}</span>`;
}
