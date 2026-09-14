import { describe, it, expect, beforeEach } from 'vitest';
import { S } from './state';
import { emailDomain, suggestMeetingCompanies, automaticMeetingLink, suggestWebsites, meetingPeople, suggestedContacts, guessCompany } from './clientMatch';
import type { Company, Contact, Meeting } from './types';

const company = (id: number, name: string, website: string | null = null): Company => ({
  id, name, legalName: null, industries: [], website, country: null, city: null, companyType: null, status: null, owner: null, description: null, archived: false, createdAt: null, updatedAt: null,
});
const contact = (id: number, companyId: number, email: string): Contact => ({ id, clientName: null, companyId, name: `Person ${id}`, role: null, email, phone: null, whatsapp: null, service: null, lists: [] });
const meeting = (emails: string[], title = 'Catch-up'): Meeting => ({ id: 9, title, attendeeEmails: emails, organizerEmail: 'ahmad@menabig.test', companyName: null, companyId: null, attendees: [] } as unknown as Meeting);

describe('client matching by email', () => {
  beforeEach(() => {
    S.companies = [company(1, 'Contoso Water'), company(2, 'Northwind', 'https://www.northwind.test'), company(3, 'Blue Harbor')];
    S.contacts = [contact(1, 1, 'ana@contoso.test'), contact(2, 1, 'luis@contoso.test'), contact(3, 3, 'owner@gmail.com')];
    S.opportunities = [];
    S.team = [{ id: 1, name: 'Ahmad', email: 'ahmad@menabig.test', jobTitle: null, department: null, isReviewer: false, active: true, notes: null }];
    S.companyDomains = {};
    S.dismissedMeetingLinks = [];
    S.ownDomains = [];
    S.ms365Status = null;
  });

  it('reads domains', () => {
    expect(emailDomain(' Ana@Contoso.TEST ')).toBe('contoso.test');
    expect(emailDomain('not an email')).toBeNull();
  });

  it('links on a known contact, suggests on a domain, ignores personal and own domains', () => {
    const known = suggestMeetingCompanies(meeting(['ana@contoso.test']));
    expect(known[0].company.name).toBe('Contoso Water');
    expect(known[0].confidence).toBe('high');
    expect(automaticMeetingLink(meeting(['ana@contoso.test']))?.company.id).toBe(1);

    const domainOnly = suggestMeetingCompanies(meeting(['new.person@contoso.test']));
    expect(domainOnly[0].confidence).toBe('medium');
    expect(domainOnly[0].newPeople.map((p) => p.email)).toEqual(['new.person@contoso.test']);
    expect(automaticMeetingLink(meeting(['new.person@contoso.test']))).toBeNull();

    expect(suggestMeetingCompanies(meeting(['someone@northwind.test']))[0].company.name).toBe('Northwind');
    expect(suggestMeetingCompanies(meeting(['friend@gmail.com']))).toHaveLength(0);
    expect(suggestMeetingCompanies(meeting([], 'Blue Harbor quarterly review'))[0].company.name).toBe('Blue Harbor');
  });

  it('suggests websites from contact domains only where one is missing', () => {
    const list = suggestWebsites();
    expect(list.map((s) => [s.company.name, s.domain])).toEqual([['Contoso Water', 'contoso.test']]);
  });
});

describe('people from meetings', () => {
  beforeEach(() => {
    S.companies = [company(1, 'Contoso Water'), company(4, 'Woodgrove MENA')];
    S.contacts = [contact(1, 1, 'ana@contoso.test')];
    S.opportunities = [];
    S.team = [{ id: 1, name: 'Ahmad', email: 'ahmad@menabig.test', jobTitle: null, department: null, isReviewer: false, active: true, notes: null }];
    S.companyDomains = {};
    S.ownDomains = [];
    S.ms365Status = null;
  });

  it('sorts attendees into colleagues, contacts and new people with a company guess', () => {
    const m = { ...meeting(['ahmad@menabig.test', 'ana@contoso.test', 'sam.rivera@contoso.test', 'kim@woodgrovemena.test', 'friend@gmail.com']),
      attendees: ['Ahmad', 'Ana', 'Sam Rivera', 'Kim Lee', 'Friend'] } as Meeting;
    const people = meetingPeople(m);
    const by = (e: string) => people.find((p) => p.email === e)!;
    expect(by('ahmad@menabig.test').status).toBe('internal');
    expect(by('ana@contoso.test').status).toBe('contact');
    expect(by('sam.rivera@contoso.test')).toMatchObject({ status: 'new', name: 'Sam Rivera', guess: { name: 'Contoso Water', source: 'domain' } });
    expect(by('kim@woodgrovemena.test').guess).toMatchObject({ name: 'Woodgrove MENA', source: 'name' });
    expect(by('friend@gmail.com')).toMatchObject({ status: 'new', guess: null });
  });

  it('derives a new company name from the meeting title when nothing matches', () => {
    S.companies = [];
    expect(guessCompany('woodgrovemena.com', { title: 'Woodgrove X MENA - Status Meeting', companyId: null, companyName: null }, new Map())).toEqual({ company: null, name: 'Woodgrove MENA', source: 'derived' });
    expect(guessCompany('blue-harbor.com.sa', null, new Map()).name).toBe('Blue Harbor');
  });

  it('collects new people across meetings, skipping dismissed ones', () => {
    const a = { ...meeting(['kim@woodgrovemena.test']), id: 1, meetingDate: '2026-09-09' } as Meeting;
    const b = { ...meeting(['kim@woodgrovemena.test', 'x@other.test']), id: 2, meetingDate: '2026-09-16' } as Meeting;
    const list = suggestedContacts([a, b], ['x@other.test']);
    expect(list.map((p) => [p.email, p.meetings, p.lastMeetingId])).toEqual([['kim@woodgrovemena.test', 2, 2]]);
  });
});
