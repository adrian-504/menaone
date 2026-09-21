import { describe, expect, it } from 'vitest';
import { commitmentKey, parseCommitmentLines, proposalWaitingOn, stampWaiting, waitingFromCommitments } from './commitments';

// Monday 21 September 2026.
const today = new Date(2026, 8, 21);
const contacts = [
  { id: 1, name: 'Omar Haddad' },
  { id: 2, name: 'Lina Saleh' },
  { id: 3, name: 'Omar Khalil' },
  { id: 4, name: 'Jane Doe' },
];
const ctx = { today, contacts };

describe('parseCommitmentLines', () => {
  it('reads >> as ours and << as theirs, and ignores other lines', () => {
    const out = parseCommitmentLines('Agenda point\n>> Send the revised quote\n<< Jane to share the headcount\n- normal bullet', ctx);
    expect(out.map((c) => [c.direction, c.text])).toEqual([['ours', 'Send the revised quote'], ['theirs', 'Jane to share the headcount']]);
  });

  it('accepts list markers and checkboxes; a ticked line is already kept', () => {
    const out = parseCommitmentLines('- >> One\n* << Two\n- [ ] >> Three\n  - [x] >> Four\n+ [X] << Five', ctx);
    expect(out.map((c) => [c.direction, c.text, c.kept])).toEqual([
      ['ours', 'One', false], ['theirs', 'Two', false], ['ours', 'Three', false], ['ours', 'Four', true], ['theirs', 'Five', true],
    ]);
  });

  it('needs the marker at the start of the line', () => {
    expect(parseCommitmentLines('We said >> maybe\n>>\n<<   ', ctx)).toEqual([]);
  });

  it('reads the due date the way tasks do and takes it out of the text', () => {
    const [a, b, c, d] = parseCommitmentLines('>> Send the quote by Thu\n>> Call back tomorrow\n<< Jane to sign by 30 Sep\n>> Book the room by end of month', ctx);
    expect([a.text, a.dueDate]).toEqual(['Send the quote', '2026-09-24']);
    expect([b.text, b.dueDate]).toEqual(['Call back', '2026-09-22']);
    expect([c.text, c.dueDate]).toEqual(['Jane to sign', '2026-09-30']);
    expect([d.text, d.dueDate]).toEqual(['Book the room', '2026-09-30']);
  });

  it('keeps words a task would keep: tags and company tokens stay in the text', () => {
    expect(parseCommitmentLines('>> Send #2 invoice to @Acme', ctx)[0].text).toBe('Send #2 invoice to @Acme');
  });

  it('matches who promised it, for theirs, only when exactly one contact fits', () => {
    const [jane, lina, omar, none, ours] = parseCommitmentLines(
      '<< Jane Doe to send the data\n<< lina will confirm the start date\n<< Omar to share the headcount\n<< Someone to call\n>> Jane to review', ctx);
    expect(jane.contactId).toBe(4);
    expect(lina.contactId).toBe(2);
    expect(omar.contactId).toBeNull(); // two Omars — never guess
    expect(none.contactId).toBeNull();
    expect(ours.contactId).toBeNull(); // only theirs names who promised it
  });

  it('gives each line a key that ignores case, spacing and the date', () => {
    const [a] = parseCommitmentLines('>>  Send the   Revised quote by Thu', ctx);
    const [b] = parseCommitmentLines('- [ ] >> send the revised quote', ctx);
    expect(a.sourceKey).toBe('send the revised quote');
    expect(b.sourceKey).toBe(a.sourceKey);
    expect(commitmentKey('  Send  The quote ')).toBe('send the quote');
  });

  it('reads the same line once', () => {
    expect(parseCommitmentLines('>> Send the quote\n>> send the quote', ctx)).toHaveLength(1);
  });
});

describe('proposalWaitingOn', () => {
  it('sent means the client; being prepared or awaiting our signature means us; finished means nobody', () => {
    expect(proposalWaitingOn('Sent to Client')).toBe('them');
    for (const s of ['Proposal Request Received', 'Drafting', 'In Internal Review', 'Signed by Client']) expect(proposalWaitingOn(s)).toBe('us');
    for (const s of ['Signed by Both Parties', 'Lost', 'Withdrawn', null]) expect(proposalWaitingOn(s)).toBeNull();
    expect(proposalWaitingOn('Sent to Client', true)).toBeNull();
  });
});

describe('waitingFromCommitments', () => {
  const c = (id: number, direction: 'ours' | 'theirs', status: 'open' | 'kept' | 'dropped', createdAt: string) =>
    ({ id, direction, status, createdAt, text: `c${id}` });
  it('the oldest open promise from the client suggests waiting on them', () => {
    const s = waitingFromCommitments([c(1, 'theirs', 'kept', '2026-09-01'), c(2, 'theirs', 'open', '2026-09-10T08:00:00Z'), c(3, 'theirs', 'open', '2026-09-05T08:00:00Z'), c(4, 'ours', 'open', '2026-09-01')]);
    expect(s).toEqual({ waitingOn: 'them', since: '2026-09-05', commitmentId: 3 });
  });
  it('nothing open from them, no suggestion', () => {
    expect(waitingFromCommitments([c(1, 'ours', 'open', '2026-09-01'), c(2, 'theirs', 'dropped', '2026-09-01')])).toBeNull();
  });
});

describe('stampWaiting', () => {
  it('stamps today when the side changes, keeps the date when it stays', () => {
    expect(stampWaiting({ waitingOn: null, waitingSince: null }, 'them', '2026-09-21')).toEqual({ waitingOn: 'them', waitingSince: '2026-09-21' });
    expect(stampWaiting({ waitingOn: 'them', waitingSince: '2026-09-01' }, 'them', '2026-09-21')).toEqual({ waitingOn: 'them', waitingSince: '2026-09-01' });
    expect(stampWaiting({ waitingOn: 'them', waitingSince: '2026-09-01' }, 'us', '2026-09-21')).toEqual({ waitingOn: 'us', waitingSince: '2026-09-21' });
    expect(stampWaiting({ waitingOn: 'us', waitingSince: '2026-09-01' }, null, '2026-09-21')).toEqual({ waitingOn: null, waitingSince: null });
  });
});
