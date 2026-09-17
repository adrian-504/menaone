// Public holidays for the countries MENA BIG has offices in and wanted on My
// Day: Saudi Arabia, Lebanon and Spain (Barcelona). Not the UAE (owner's
// choice). Worked out from rules, no data feed:
//   - fixed dates;
//   - Easter, Western and Orthodox, for Spain and Lebanon;
//   - Islamic holidays from the Umm al-Qura calendar built into the system.
// Islamic dates are marked `expected`: the official day is announced close to
// the date and can move by a day. Lebanon's list changes most from year to
// year, so it should be checked each January.

export type HolidayCountry = 'SA' | 'LB' | 'ES';

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  country: HolidayCountry;
  /** Moon-sighted, so the official day may differ. */
  expected: boolean;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Western Easter Sunday (Anonymous Gregorian algorithm). */
export function westernEaster(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** Orthodox Easter Sunday, as a Gregorian date (valid 1900–2099). */
export function orthodoxEaster(year: number): string {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  return addDaysIso(iso(year, month, day), 13);
}

const hijriParts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });

/** Gregorian dates in `year` that fall on Hijri month/day. */
export function hijriDatesInYear(year: number, month: number, day: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, 0, 1); new Date(t).getUTCFullYear() === year; t += 86_400_000) {
    const parts = hijriParts.formatToParts(new Date(t));
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    const d = Number(parts.find((p) => p.type === 'day')?.value);
    if (m === month && d === day) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function holidaysFor(year: number): Holiday[] {
  const list: Holiday[] = [];
  const add = (country: HolidayCountry, date: string, name: string, expected = false) => list.push({ date, name, country, expected });
  const fixed = (country: HolidayCountry, m: number, d: number, name: string) => add(country, iso(year, m, d), name);
  const islamic = (country: HolidayCountry, m: number, d: number, name: string) => hijriDatesInYear(year, m, d).forEach((date) => add(country, date, name, true));

  // Saudi Arabia
  fixed('SA', 2, 22, 'Founding Day');
  fixed('SA', 9, 23, 'Saudi National Day');
  islamic('SA', 10, 1, 'Eid al-Fitr');
  islamic('SA', 12, 9, 'Arafat Day');
  islamic('SA', 12, 10, 'Eid al-Adha');

  // Spain: national, Catalonia, and Barcelona city holidays
  const easter = westernEaster(year);
  fixed('ES', 1, 1, "New Year's Day");
  fixed('ES', 1, 6, 'Epiphany');
  add('ES', addDaysIso(easter, -2), 'Good Friday');
  add('ES', addDaysIso(easter, 1), 'Easter Monday (Catalonia)');
  fixed('ES', 5, 1, 'Labour Day');
  add('ES', addDaysIso(easter, 50), 'Whit Monday (Barcelona)');
  fixed('ES', 6, 24, 'Sant Joan (Catalonia)');
  fixed('ES', 8, 15, 'Assumption Day');
  fixed('ES', 9, 11, 'La Diada (Catalonia)');
  fixed('ES', 9, 24, 'La Mercè (Barcelona)');
  fixed('ES', 10, 12, 'Spanish National Day');
  fixed('ES', 11, 1, "All Saints' Day");
  fixed('ES', 12, 6, 'Constitution Day');
  fixed('ES', 12, 8, 'Immaculate Conception');
  fixed('ES', 12, 25, 'Christmas Day');
  fixed('ES', 12, 26, "Sant Esteve (Catalonia)");

  // Lebanon
  fixed('LB', 1, 1, "New Year's Day");
  fixed('LB', 1, 6, 'Armenian Christmas');
  fixed('LB', 2, 9, "St Maroun's Day");
  fixed('LB', 3, 25, 'Feast of the Annunciation');
  add('LB', addDaysIso(easter, -2), 'Good Friday (Western)');
  add('LB', addDaysIso(orthodoxEaster(year), -2), 'Good Friday (Orthodox)');
  fixed('LB', 5, 1, 'Labour Day');
  fixed('LB', 5, 25, 'Resistance and Liberation Day');
  fixed('LB', 8, 15, 'Assumption Day');
  fixed('LB', 11, 22, 'Independence Day');
  fixed('LB', 12, 25, 'Christmas Day');
  islamic('LB', 1, 1, 'Islamic New Year');
  islamic('LB', 1, 10, 'Ashura');
  islamic('LB', 3, 12, "Prophet's Birthday");
  islamic('LB', 10, 1, 'Eid al-Fitr');
  islamic('LB', 12, 10, 'Eid al-Adha');

  // Two holidays on one day in one country read as one.
  const seen = new Set<string>();
  return list
    .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country))
    .filter((h) => {
      const key = `${h.country}|${h.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Holidays from `fromIso` through the next `days` days (inclusive), across a year boundary if needed. */
export function upcomingHolidays(fromIso: string, days: number): Holiday[] {
  const toIso = addDaysIso(fromIso, days);
  const years = new Set([Number(fromIso.slice(0, 4)), Number(toIso.slice(0, 4))]);
  return [...years].flatMap((y) => holidaysFor(y)).filter((h) => h.date >= fromIso && h.date <= toIso);
}
