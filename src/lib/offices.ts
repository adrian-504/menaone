// MENA BIG's offices, shown on My Day as a clock, the weather and whether
// people there are at work. Everything except the weather is worked out
// on the device from the time zone, so it needs no internet.

import type { HolidayCountry } from './holidays';

export interface Office {
  id: string;
  city: string;
  timeZone: string;
  /** Holiday list to use; null where the owner didn't ask for one (UAE). */
  holidays: HolidayCountry | null;
  /** Days off, 0 = Sunday … 6 = Saturday. */
  weekend: number[];
  /** Office coordinates for the weather, 4 decimals. */
  lat: number;
  lon: number;
}

/** West to east, the order people read time zones in. */
export const OFFICES: Office[] = [
  { id: 'bcn', city: 'Barcelona', timeZone: 'Europe/Madrid', holidays: 'ES', weekend: [6, 0], lat: 41.3874, lon: 2.1686 },
  { id: 'bey', city: 'Beirut', timeZone: 'Asia/Beirut', holidays: 'LB', weekend: [6, 0], lat: 33.8938, lon: 35.5018 },
  { id: 'ruh', city: 'Riyadh', timeZone: 'Asia/Riyadh', holidays: 'SA', weekend: [5, 6], lat: 24.7136, lon: 46.6753 },
  { id: 'dxb', city: 'Dubai', timeZone: 'Asia/Dubai', holidays: null, weekend: [6, 0], lat: 25.2048, lon: 55.2708 },
];

/** Working hours assumed for every office, local time. */
export const WORK_START = 9 * 60;
export const WORK_END = 18 * 60;

export type OfficeStatus = 'working' | 'after-hours' | 'weekend' | 'holiday';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The office's local date, weekday, hour and minute at `now`. */
export function localParts(now: Date, timeZone: string): { date: string; weekday: number; minutes: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const hour = Number(get('hour')), minute = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAYS.indexOf(get('weekday')),
    minutes: hour * 60 + minute,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Whether the office is at work right now. A holiday counts only on the office's own local date. */
export function officeStatus(now: Date, office: Office, holidayDates: Set<string>): OfficeStatus {
  const local = localParts(now, office.timeZone);
  if (office.holidays && holidayDates.has(`${office.holidays}|${local.date}`)) return 'holiday';
  if (office.weekend.includes(local.weekday)) return 'weekend';
  return local.minutes >= WORK_START && local.minutes < WORK_END ? 'working' : 'after-hours';
}

export const STATUS_LABEL: Record<OfficeStatus, string> = {
  working: 'Working hours',
  'after-hours': 'After hours',
  weekend: 'Weekend',
  holiday: 'Public holiday',
};
