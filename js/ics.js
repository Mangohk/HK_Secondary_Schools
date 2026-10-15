/**
 * Phase 1: single-event iCalendar (.ics) for 升中項目 cards.
 * Pure builders + Blob download; no network / Firebase.
 */

const ICS_TZ = "Asia/Hong_Kong";
const DESC_MAX = 1800;

/** Escape TEXT property values per RFC 5545. */
export function icsEscapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Fold content lines at 75 octets (UTF-8 byte-aware). */
export function icsFoldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Avoid splitting a multi-byte UTF-8 sequence.
    while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === start) end = Math.min(start + limit, bytes.length);
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
    limit = 74; // continuation lines: leading space counts toward 75
  }
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join("\r\n");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** YYYYMMDD from a calendar date string YYYY-MM-DD. */
function ymdCompact(ymd) {
  return String(ymd).slice(0, 10).replace(/-/g, "");
}

/** Add calendar days to YYYY-MM-DD (UTC noon arithmetic; date-only safe). */
export function addCalendarDays(ymd, days) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Parts of an Instant in Asia/Hong_Kong. */
function hongKongParts(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ICS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function formatLocalDateTime(instant) {
  const p = hongKongParts(instant);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

function formatUtcStamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const mm = pad2(date.getUTCMinutes());
  const ss = pad2(date.getUTCSeconds());
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function decodeText(raw) {
  if (raw == null) return "";
  let text = String(raw);
  for (let pass = 0; pass < 2; pass += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(text)) break;
    let changed = false;
    const next = text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      try {
        const decoded = decodeURIComponent(run);
        if (decoded === run) return run;
        changed = true;
        return decoded;
      } catch {
        return run;
      }
    });
    if (!changed) break;
    text = next;
  }
  return text.normalize("NFC");
}

function ensureHttpUrl(url) {
  if (!url) return "";
  const decoded = decodeText(url).trim();
  if (!decoded) return "";
  if (/^https?:\/\//i.test(decoded)) return decoded;
  return `https://${decoded}`;
}

/**
 * Build DESCRIPTION from type / status / schools / keyPoints / keyDateStart / notes.
 */
export function buildEventDescription(ev) {
  const lines = [];
  const type = decodeText(ev.type).trim();
  const status = decodeText(ev.status).trim();
  if (type) lines.push(`類型：${type}`);
  if (status) lines.push(`狀態：${status}`);
  const schools = Array.isArray(ev.schools)
    ? ev.schools.map((s) => decodeText(s).trim()).filter(Boolean)
    : [];
  if (schools.length) lines.push(`學校：${schools.join("、")}`);
  else lines.push("學校：教育局／全港");

  const keyPoints = decodeText(ev.keyPoints).trim();
  const keyDate = ev.keyDateStart ? String(ev.keyDateStart).slice(0, 10) : "";
  if (keyPoints && keyDate) lines.push(`關鍵：${keyPoints}（${keyDate}）`);
  else if (keyPoints) lines.push(`關鍵：${keyPoints}`);
  else if (keyDate) lines.push(`關鍵日期：${keyDate}`);

  const notes = decodeText(ev.notes).trim();
  if (notes) lines.push(`備註：${notes}`);

  let text = lines.join("\n");
  if (text.length > DESC_MAX) {
    text = `${text.slice(0, DESC_MAX - 1)}…`;
  }
  return text;
}

/**
 * @returns {{ uid: string, filename: string, content: string } | null}
 * null when dateStart is missing (button should stay disabled).
 */
export function buildEventIcs(ev, { now = new Date() } = {}) {
  if (!ev?.id || !ev.dateStart) return null;

  const id = String(ev.id);
  const uid = `hkss-${id}@mangohk`;
  const summary = decodeText(ev.title).trim() || id;
  const description = buildEventDescription(ev);
  const url = ensureHttpUrl(ev.sourceUrl);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mangohk//HK Secondary Schools//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${ICS_TZ}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:HKT",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtcStamp(now)}`,
  ];

  if (ev.isDateTime) {
    const start = new Date(ev.dateStart);
    if (Number.isNaN(start.getTime())) return null;
    // Missing / identical dateEnd → same instant as dateStart (TR: treat as single day).
    let end = ev.dateEnd ? new Date(ev.dateEnd) : start;
    if (Number.isNaN(end.getTime())) end = start;
    lines.push(`DTSTART;TZID=${ICS_TZ}:${formatLocalDateTime(start)}`);
    lines.push(`DTEND;TZID=${ICS_TZ}:${formatLocalDateTime(end)}`);
  } else {
    const startYmd = String(ev.dateStart).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return null;
    let endYmd =
      ev.dateEnd && String(ev.dateEnd).slice(0, 10) !== startYmd
        ? String(ev.dateEnd).slice(0, 10)
        : startYmd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) endYmd = startYmd;
    // All-day DTEND is exclusive (day after last inclusive day).
    const exclusiveEnd = addCalendarDays(endYmd, 1);
    lines.push(`DTSTART;VALUE=DATE:${ymdCompact(startYmd)}`);
    lines.push(`DTEND;VALUE=DATE:${ymdCompact(exclusiveEnd)}`);
  }

  lines.push(`SUMMARY:${icsEscapeText(summary)}`);
  if (description) lines.push(`DESCRIPTION:${icsEscapeText(description)}`);
  if (url) lines.push(`URL:${url}`);
  // Derived 登記 rows (id `{parent}-key`) remind one day before the opening.
  if (ev.derivedFrom) {
    lines.push("BEGIN:VALARM");
    lines.push("TRIGGER:-P1D");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${icsEscapeText("登記提醒")}`);
    lines.push("END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  const content = `${lines.map(icsFoldLine).join("\r\n")}\r\n`;
  return { uid, filename: `${id}.ics`, content };
}

/** Trigger a browser download of one .ics Blob. */
export function downloadEventIcs(ev) {
  const built = buildEventIcs(ev);
  if (!built) return false;
  const blob = new Blob([built.content], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = built.filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}
