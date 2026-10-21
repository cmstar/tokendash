const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function trimTrailingZero(value: string): string {
  if (!value.includes('.')) return value;
  const [whole, fraction] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 999_950_000) return trimTrailingZero((tokens / 1_000_000_000).toFixed(1)) + 'B';
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M';
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K';
  if (tokens > 0) return String(tokens);
  return '0';
}

export function formatCost(cost: number): string {
  const value = Math.abs(cost);
  if (value < 0.05) return '$0';
  if (value < 10) return '$' + cost.toFixed(2);
  if (value < 100) return '$' + cost.toFixed(1);
  return '$' + cost.toFixed(0);
}

export function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}

/** Mirrors the macOS shortModelName: claude-sonnet-4-6 → "Sonnet 4", GLM-5.1 unchanged. */
export function shortModelName(id: string): string {
  const lower = id.toLowerCase();
  let type: string;
  if (lower.includes('opus')) type = 'Opus';
  else if (lower.includes('sonnet')) type = 'Sonnet';
  else if (lower.includes('haiku')) type = 'Haiku';
  else return id;
  const match = id.match(/\d+(\.\d+)?/);
  return match ? `${type} ${match[0]}` : type;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date key, matching the web dashboard and the macOS build. */
export function todayString(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function todayLabel(now = new Date()): string {
  return `${MONTHS[now.getMonth()]} ${now.getDate()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function parseDateKey(key: string): Date | null {
  const parts = key.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function weekdayShort(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return date ? WEEKDAYS[date.getDay()] : '';
}

export function shortDate(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return date ? `${MONTHS[date.getMonth()]} ${date.getDate()}` : dateKey;
}

export function dayOfMonth(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return date ? String(date.getDate()) : '';
}

/** Countdown text for a quota window reset, e.g. "in 3h 20m" or "on Nov 3". */
export function formatResetCountdown(iso: string, now = new Date()): string | null {
  const resetsAt = new Date(iso);
  if (Number.isNaN(resetsAt.getTime())) return null;
  const secs = (resetsAt.getTime() - now.getTime()) / 1000;
  if (secs <= 0) return 'soon';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `in ${days}d`;
  return `on ${MONTHS[resetsAt.getMonth()]} ${resetsAt.getDate()}`;
}