import { describe, expect, it } from 'vitest';
import { OFFICES, localParts, officeStatus } from './offices';
import { holidaysFor, hijriDatesInYear, orthodoxEaster, upcomingHolidays, westernEaster } from './holidays';

const office = (id: string) => OFFICES.find((o) => o.id === id)!;
const none = new Set<string>();

describe('office clocks', () => {
  it('follows each city, including summer time in Barcelona and Beirut', () => {
    const summer = new Date('2026-09-17T09:00:00Z');
    expect(localParts(summer, 'Europe/Madrid').time).toBe('11:00');
    expect(localParts(summer, 'Asia/Beirut').time).toBe('12:00');
    expect(localParts(summer, 'Asia/Riyadh').time).toBe('12:00');
    expect(localParts(summer, 'Asia/Dubai').time).toBe('13:00');
    const winter = new Date('2026-01-15T09:00:00Z');
    expect(localParts(winter, 'Europe/Madrid').time).toBe('10:00');
    expect(localParts(winter, 'Asia/Riyadh').time).toBe('12:00');
  });

  it('knows the Saudi weekend is Friday–Saturday and the others Saturday–Sunday', () => {
    const friday = new Date('2026-09-18T09:00:00Z'); // Friday, working hours everywhere
    expect(officeStatus(friday, office('ruh'), none)).toBe('weekend');
    expect(officeStatus(friday, office('bcn'), none)).toBe('working');
    expect(officeStatus(friday, office('dxb'), none)).toBe('working');
    const sunday = new Date('2026-09-20T09:00:00Z');
    expect(officeStatus(sunday, office('ruh'), none)).toBe('working');
    expect(officeStatus(sunday, office('bey'), none)).toBe('weekend');
  });

  it('tells working hours from after hours in local time', () => {
    const early = new Date('2026-09-17T06:30:00Z'); // 08:30 Barcelona, 10:30 Dubai
    expect(officeStatus(early, office('bcn'), none)).toBe('after-hours');
    expect(officeStatus(early, office('dxb'), none)).toBe('working');
  });

  it('marks a holiday on the office\'s own date, and never for Dubai', () => {
    const nationalDay = new Date('2026-09-23T08:00:00Z');
    const dates = new Set(holidaysFor(2026).map((h) => `${h.country}|${h.date}`));
    expect(officeStatus(nationalDay, office('ruh'), dates)).toBe('holiday');
    expect(officeStatus(nationalDay, office('bcn'), dates)).toBe('working');
    expect(officeStatus(new Date('2026-12-02T08:00:00Z'), office('dxb'), dates)).not.toBe('holiday');
  });
});

describe('public holidays', () => {
  it('computes Easter both ways', () => {
    expect(westernEaster(2026)).toBe('2026-04-05');
    expect(westernEaster(2027)).toBe('2027-03-28');
    expect(orthodoxEaster(2026)).toBe('2026-04-12');
    expect(orthodoxEaster(2027)).toBe('2027-05-02');
  });

  it('finds Islamic dates with the Umm al-Qura calendar', () => {
    // 1 Shawwal 1447 (Eid al-Fitr) falls in March 2026.
    const eid = hijriDatesInYear(2026, 10, 1);
    expect(eid).toHaveLength(1);
    expect(eid[0].startsWith('2026-03-')).toBe(true);
  });

  it('lists Saudi, Lebanese and Spanish holidays but not the UAE', () => {
    const list = holidaysFor(2026);
    const find = (country: string, name: string) => list.find((h) => h.country === country && h.name === name);
    expect(find('SA', 'Saudi National Day')?.date).toBe('2026-09-23');
    expect(find('ES', 'La Mercè (Barcelona)')?.date).toBe('2026-09-24');
    expect(find('ES', 'Good Friday')?.date).toBe('2026-04-03');
    expect(find('LB', 'Independence Day')?.date).toBe('2026-11-22');
    expect(find('SA', 'Eid al-Fitr')?.expected).toBe(true);
    expect(find('SA', 'Saudi National Day')?.expected).toBe(false);
    expect(new Set(list.map((h) => h.country))).toEqual(new Set(['SA', 'LB', 'ES']));
  });

  it('shows the week ahead, across New Year', () => {
    expect(upcomingHolidays('2026-09-17', 7).map((h) => h.name)).toEqual(['Saudi National Day', 'La Mercè (Barcelona)']);
    const nye = upcomingHolidays('2026-12-30', 7);
    expect(nye.some((h) => h.date === '2027-01-01')).toBe(true);
    expect(nye.some((h) => h.date === '2027-01-06')).toBe(true);
  });
});
