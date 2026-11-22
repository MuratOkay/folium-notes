/**
 * Time helpers. Folium stores timestamps as *local* ISO-8601 with an explicit
 * UTC offset and without milliseconds, e.g. `2026-11-22T14:14:05+03:00`.
 */

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const pad4 = (n: number): string => String(n).padStart(4, '0');

/** Format a Date as local ISO-8601 with offset, second precision, no milliseconds. */
export function formatLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad4(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** Current local ISO timestamp (second precision, with offset). */
export function nowLocalIso(): string {
  return formatLocalIso(new Date());
}

/** `YYYY-MM-DD` for a local date. */
export function dayKey(date: Date): string {
  return `${pad4(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `HH-mm-ss` (file-name safe time). */
export function timeKey(date: Date): string {
  return `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
}

/** `YYYY-MM-DD HH:mm` for display purposes. */
export function formatDisplay(date: Date): string {
  return `${dayKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:([+-])(\d{2}):?(\d{2})|Z)?)?$/;

/**
 * Parse a date coming from front matter, a file name or an import.
 * Accepts `YYYY-MM-DD`, ISO with offset, ISO without offset (local), `Z`,
 * `YYYY-MM-DD HH:mm:ss` (Obsidian), and epoch milliseconds as a number/string.
 */
export function parseDateLoose(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromMs = new Date(value);
    return Number.isNaN(fromMs.getTime()) ? undefined : fromMs;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d{11,}$/.test(text)) return parseDateLoose(Number(text));
  const match = ISO_RE.exec(text);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  if (h === undefined) {
    return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  }
  let offsetMinutes = 0;
  if (sign && oh && om) {
    offsetMinutes = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  }
  const utcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
    0,
  );
  return new Date(utcMs - offsetMinutes * 60_000);
}

/** Parse `YYYY-MM-DD` as a *local* calendar day. */
export function parseDayKey(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Monday-based start of week. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const dow = (day.getDay() + 6) % 7;
  return addDays(day, -dow);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Human relative day label used by the Notes view ("Today", "Yesterday"). */
export function relativeDayLabel(date: Date, now: Date = new Date()): string {
  const a = startOfDay(date).getTime();
  const b = startOfDay(now).getTime();
  const diff = Math.round((b - a) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  return dayKey(date);
}

export function monthLabel(date: Date): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}
