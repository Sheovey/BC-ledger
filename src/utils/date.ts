import type { DateRange, RangeKind } from '@/types';

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → `YYYY-MM-DD`（按本地时区，不走 toISOString） */
export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Date → `YYYY-MM-DDTHH:mm` */
export function toDateTimeStr(date: Date): string {
  return `${toDateStr(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 解析 `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm` 为本地 Date */
export function parseDateStr(value: string): Date {
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart ?? '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function nowStr(): string {
  return toDateTimeStr(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function addMonths(dateStr: string, months: number): string {
  const d = parseDateStr(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toDateStr(d);
}

export function daysInMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

/** 周一为一周起点（符合国内记账习惯） */
export function startOfWeek(dateStr: string): string {
  const d = parseDateStr(dateStr);
  const day = d.getDay(); // 0=周日
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** 账单月起点（支持自定义起始日，如每月 5 日为一个账期） */
export function periodStart(dateStr: string, monthStartDay: number): string {
  const d = parseDateStr(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth();
  if (monthStartDay <= 1) return `${y}-${pad2(m + 1)}-01`;
  if (d.getDate() >= monthStartDay) return `${y}-${pad2(m + 1)}-${pad2(monthStartDay)}`;
  const prev = new Date(y, m - 1, 1);
  return `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}-${pad2(monthStartDay)}`;
}

export function periodEnd(dateStr: string, monthStartDay: number): string {
  const start = periodStart(dateStr, monthStartDay);
  if (monthStartDay <= 1) {
    const d = parseDateStr(start);
    return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  return addDays(addMonths(start, 1), -1);
}

function weekdayCn(dateStr: string): string {
  return WEEKDAY_CN[parseDateStr(dateStr).getDay()];
}

function md(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 生成时间范围；anchor 为锚点日期（默认今天） */
export function resolveRange(
  kind: RangeKind,
  anchor: string = todayStr(),
  monthStartDay = 1,
): DateRange {
  switch (kind) {
    case 'day':
      return { kind, start: anchor, end: anchor, label: `${md(anchor)} ${weekdayCn(anchor)}` };
    case 'week': {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      return { kind, start, end, label: `${md(start)} - ${md(end)}` };
    }
    case 'month': {
      const start = periodStart(anchor, monthStartDay);
      const end = periodEnd(anchor, monthStartDay);
      return { kind, start, end, label: `${md(start)} - ${md(end)}` };
    }
    case 'year': {
      const y = anchor.slice(0, 4);
      return { kind, start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}年` };
    }
    case 'custom':
    default:
      return { kind: 'custom', start: anchor, end: anchor, label: `${md(anchor)}` };
  }
}

/** `YYYY-MM` 加减月份 */
export function shiftMonth(month: string, delta: number): string {
  return monthKey(addMonths(`${month}-01`, delta));
}

/** `YYYY-MM` → `25.11`（两位数年，够短才放得进分段控件） */
export function formatMonthShort(month: string): string {
  const [y, m] = month.split('-');
  return `${y.slice(2)}.${m}`;
}

/**
 * 用「账期名」构造区间，from / to 为 `YYYY-MM`。
 *
 * 陷阱：不能写成 `periodStart(`${from}-01`)`。起始日 > 1 时，`2026-09-01`
 * 落在 8 月那个账期里，会返回 `2026-08-05`，整个区间前移一个月。
 * 必须用 `${from}-${起始日}` 直接锚定，才是「9 月账期」的起点。
 *
 * label 在起始日 ≠ 1 时带「账期」后缀，避免与自然月撞语义。
 */
export function resolveMonthRange(
  fromMonth: string,
  toMonth: string,
  monthStartDay = 1,
): DateRange {
  const startDay = Math.min(Math.max(monthStartDay, 1), 28);
  const [from, to] = fromMonth <= toMonth ? [fromMonth, toMonth] : [toMonth, fromMonth];
  const start = `${from}-${pad2(startDay)}`;
  const end = periodEnd(`${to}-${pad2(startDay)}`, startDay);
  const span = `${formatMonthShort(from)}-${formatMonthShort(to)}`;
  return {
    kind: 'custom',
    start,
    end,
    label: monthStartDay <= 1 ? span : `${span} 账期`,
  };
}

/** 把解析后的区间说成人话：账期名 ≠ 自然月时，让人一眼看到实际包含哪几天 */
export function monthRangeSpanText(range: DateRange): string {
  return `${range.start} 至 ${range.end}`;
}

/** 按时间范围平移（图表左右箭头） */
export function shiftRange(range: DateRange, direction: -1 | 1, monthStartDay = 1): DateRange {  const anchorBase = range.start;
  let anchor = anchorBase;
  switch (range.kind) {
    case 'day':
      anchor = addDays(anchorBase, direction);
      break;
    case 'week':
      anchor = addDays(anchorBase, direction * 7);
      break;
    case 'month':
      anchor = addMonths(anchorBase, direction);
      break;
    case 'year':
      anchor = `${Number(anchorBase.slice(0, 4)) + direction}-01-01`;
      break;
    default:
      anchor = anchorBase;
  }
  return resolveRange(range.kind, anchor, monthStartDay);
}

/** 判断时间字符串是否落在范围内（含首尾，天粒度） */
export function withinRange(dateTime: string, range: DateRange): boolean {
  const day = dateTime.slice(0, 10);
  return day >= range.start && day <= range.end;
}

/** 展示用：10月23日 15:06 */
export function formatDateTime(value: string): string {
  const d = parseDateStr(value);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 展示用：日分组标题 */
export function formatDayGroup(value: string): { day: string; weekday: string; monthLabel: string } {
  const d = parseDateStr(value);
  return {
    day: `${pad2(d.getDate())}日`,
    weekday: weekdayCn(value),
    monthLabel: `${d.getFullYear()}年${d.getMonth() + 1}月`,
  };
}

export function isSameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** 枚举范围内每一天，用于明细图 */
export function eachDay(start: string, end: string, limit = 400): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < limit) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}
