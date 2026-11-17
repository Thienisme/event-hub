/**
 * Tiện ích lịch: liên kết Google Calendar và nội dung file .ics theo RFC 5545
 * (kết thúc dòng CRLF, gấp dòng dài hơn 75 octet, thoát ký tự đặc biệt TEXT).
 */

import type { EventItem } from '../stores/event';

const CRLF = '\r\n';

/** Instant DateTime -> "YYYYMMDDTHHMMSSZ" (UTC). */
export const formatUTC = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};

/** Thoát ký tự đặc biệt của giá trị TEXT theo RFC 5545. */
const escapeText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Gấp dòng dài hơn 75 octet: chèn CRLF + khoảng trắng (RFC 5545). */
const foldLine = (line: string): string => {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let rest = line;
  let first = true;

  while (rest.length > 0) {
    const max = first ? 75 : 74; // dòng tiếp theo có kèm khoảng trắng đầu dòng
    let cut = rest.length;
    while (cut > 0 && encoder.encode((first ? '' : ' ') + rest.slice(0, cut)).length > max) cut--;
    if (cut === 0) cut = 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    first = false;
  }

  return parts.join(`${CRLF} `);
};

/** Liên kết "Thêm vào lịch" của Google Calendar (mở tab mới). */
export const googleCalendarUrl = (event: EventItem): string => {
  const start = formatUTC(new Date(event.startTime));
  const end = formatUTC(new Date(event.endTime));
  const query = `action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${start}/${end}&details=${encodeURIComponent(event.description ?? '')}&location=${encodeURIComponent(event.location)}`;
  return `https://calendar.google.com/calendar/render?${query}`;
};

/** Dùng nội dung iCalendar RFC 5545 của sự kiện. */
export const buildIcsContent = (event: EventItem): string => {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const now = new Date();

  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(foldLine(line));
  };

  push('BEGIN:VCALENDAR');
  push('VERSION:2.0');
  push('PRODID:-//Event Hub//EventHub VN 1.0//');
  push('CALSCALE:GREGORIAN');
  push('METHOD:PUBLISH');
  push('BEGIN:VEVENT');
  push(`UID:${event.id}@eventhub`);
  push(`DTSTAMP:${formatUTC(now)}`);
  push(`DTSTART:${formatUTC(start)}`);
  push(`DTEND:${formatUTC(end)}`);
  if (event.title) push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) push(`LOCATION:${escapeText(event.location)}`);
  push(`URL:${window.location.href}`);
  push('END:VEVENT');
  push('END:VCALENDAR');

  return lines.join(CRLF);
};

/** Tải nội dung iCalendar thành file .ics qua Blob + thẻ a. */
export const downloadIcs = (content: string, title: string): void => {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // Bỏ dấu tiếng Việt trước khi lọc ký tự, nếu không "Hội thảo" thành "Hi tho".
  const safeTitle = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'lich-su-kien';

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeTitle}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Thu hồi sau một nhịp: thu hồi ngay có thể làm Safari huỷ lượt tải.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
