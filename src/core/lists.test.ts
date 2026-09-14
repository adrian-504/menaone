// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { S } from '../lib/state';
import { activeCampaignRows, activeCampaignCsv, splitName, cleanFilters, sameFilters, companyNamesInList, contactsInCompanyList } from './lists';
import type { Company, Contact, SavedList } from '../lib/types';

const company = (id: number, name: string, over: Partial<Company> = {}): Company => ({
  id, name, legalName: null, industries: [], website: null, country: null, city: null, companyType: null, status: null, owner: null,
  description: null, archived: false, createdAt: null, updatedAt: null, ...over,
});
const contact = (id: number, over: Partial<Contact>): Contact => ({
  id, clientName: null, companyId: null, name: null, role: null, email: null, phone: null, whatsapp: null, service: null, lists: [], ...over,
});
const list = (over: Partial<SavedList>): SavedList => ({ id: 1, name: 'List', entity: 'company', filters: null, companyIds: [], ...over });

describe('lists', () => {
  beforeEach(() => {
    S.companies = [company(1, 'Test Logistics', { industries: ['Logistics'], owner: 'Owner A', country: 'Saudi Arabia' }), company(2, 'Test Foods')];
    S.contacts = [
      contact(1, { name: 'Omar Ali Test', clientName: 'Test Logistics', companyId: 1, email: 'omar@logistics.test', role: 'HR Director', service: 'PRO, Payroll', lists: ['Newsletter'] }),
      contact(2, { name: 'Omar A.', clientName: 'Test Logistics', companyId: 1, email: 'OMAR@logistics.test', lists: ['Events, 2026'] }),
      contact(3, { name: 'Lina', clientName: 'Test Foods', companyId: 2, email: '' }),
      contact(4, { name: 'Sami Test', clientName: 'Test Foods', companyId: 2, email: 'sami@foods.test' }),
    ];
    S.savedLists = [list({ id: 7, name: 'Q4 campaign', companyIds: [1] })];
  });

  it('splits names into first and last', () => {
    expect(splitName('Omar Ali Test')).toEqual({ first: 'Omar Ali', last: 'Test' });
    expect(splitName('Lina')).toEqual({ first: 'Lina', last: '' });
    expect(splitName('  ')).toEqual({ first: '', last: '' });
  });

  it('finds the contacts at a company list', () => {
    expect(companyNamesInList(S.savedLists[0])).toEqual(['Test Logistics']);
    expect(contactsInCompanyList(S.savedLists[0]).map((c) => c.id)).toEqual([1, 2]);
  });

  it('builds one ActiveCampaign row per email with every tag', () => {
    const rows = activeCampaignRows(S.contacts, ['Q4 campaign']);
    expect(rows.map((r) => r.email)).toEqual(['omar@logistics.test', 'sami@foods.test']);
    const omar = rows[0];
    expect(omar).toMatchObject({ firstName: 'Omar Ali', lastName: 'Test', jobTitle: 'HR Director', organization: 'Test Logistics', industry: 'Logistics', owner: 'Owner A', country: 'Saudi Arabia' });
    expect(omar.tags).toEqual(['Newsletter', 'Q4 campaign', 'PRO', 'Payroll', 'Events 2026']);
    const csv = activeCampaignCsv(rows).split('\n');
    expect(csv[0]).toBe('Email,First Name,Last Name,Phone,Job Title,Organization,Industry,Account Owner,Country,Relationship,Tags');
    expect(csv[1]).toBe('"omar@logistics.test","Omar Ali","Test","","HR Director","Test Logistics","Logistics","Owner A","Saudi Arabia","","Newsletter, Q4 campaign, PRO, Payroll, Events 2026"');
  });

  it('compares smart list filters by what they filter on', () => {
    expect(cleanFilters({ search: '', status: 'client', industry: '' })).toEqual({ status: 'client' });
    expect(sameFilters({ status: 'client', owner: '' }, { status: 'client' })).toBe(true);
    expect(sameFilters({ status: 'client' }, null)).toBe(false);
  });
});
