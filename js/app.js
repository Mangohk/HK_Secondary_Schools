import { downloadEventIcs } from "./ics.js?v=schoolscope-10";

const TYPE_ORDER = ["官立", "資助", "直資", "私立"];

/** Official 18-district display order (Hong Kong Island → Kowloon → New Territories). */
const DISTRICT_ORDER = [
  "中西區",
  "灣仔區",
  "東區",
  "南區",
  "油尖旺區",
  "深水埗區",
  "九龍城區",
  "黃大仙區",
  "觀塘區",
  "葵青區",
  "荃灣區",
  "屯門區",
  "元朗區",
  "北區",
  "大埔區",
  "沙田區",
  "西貢區",
  "離島區",
];

const DISTANCE_LIST_LIMIT = 40;
const LIST_PAGE_SIZE = 24;
/** Watchlist cards show this many 升中 rows before 「顯示全部」. */
const FAVORITES_EVENTS_PREVIEW = 4;

/** Haversine great-circle distance in metres */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(meters) {
  const join = (value, unit) => `${value}\u00A0${unit}`;
  if (meters < 1000) {
    return join(Math.round(meters), "米");
  }
  if (meters < 10000) {
    return join((meters / 1000).toFixed(2), "公里");
  }
  return join((meters / 1000).toFixed(1), "公里");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizePhoneHref(phone) {
  return phone.replace(/\s+/g, "");
}

function ensureUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

/**
 * Decode percent-encoded runs (up to twice). `+` is left alone.
 * A bad run stays as written instead of throwing away the rest of the string.
 */
function decodePercentRuns(raw) {
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

/** Visible 升中 copy: `%e4%b8%ad` and similar must not remain on screen. */
function decodeVisiblePercent(raw) {
  return decodePercentRuns(raw);
}

/** One `%HH` byte, or the same byte wrapped once as `%25HH`. */
function readPercentByte(text, index) {
  const match = /^%((?:25)*)([0-9A-Fa-f]{2})/i.exec(text.slice(index));
  if (!match) return null;
  const layers = match[1].length / 2;
  if (layers > 1) return null;
  return { byte: Number.parseInt(match[2], 16), next: index + match[0].length };
}

/**
 * Href decode: replace encoded non-ASCII (including one extra `%25` layer)
 * so the attribute does not show `%e4%b8%ad`. `%20` and `%2F` stay encoded.
 */
function decodeHrefPercent(raw) {
  if (raw == null) return "";
  const text = String(raw);
  let out = "";
  for (let i = 0; i < text.length;) {
    const lead = readPercentByte(text, i);
    let need = 0;
    if (lead && lead.byte >= 0xc2 && lead.byte <= 0xdf) need = 2;
    else if (lead && lead.byte >= 0xe0 && lead.byte <= 0xef) need = 3;
    else if (lead && lead.byte >= 0xf0 && lead.byte <= 0xf4) need = 4;
    if (!need) {
      out += text[i];
      i += 1;
      continue;
    }
    const bytes = [lead.byte];
    let j = lead.next;
    let ok = true;
    for (let k = 1; k < need; k += 1) {
      const next = readPercentByte(text, j);
      if (!next || next.byte < 0x80 || next.byte > 0xbf) {
        ok = false;
        break;
      }
      bytes.push(next.byte);
      j = next.next;
    }
    if (!ok) {
      out += text[i];
      i += 1;
      continue;
    }
    try {
      const char = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
      if (!/[^\u0000-\u007f]/.test(char)) throw new Error("ascii");
      out += char;
      i = j;
    } catch {
      out += text[i];
      i += 1;
    }
  }
  return out.normalize("NFC");
}

/** Outbound 升中 link label. Not always 「來源」. */
function eventSourceLabel(ev, url) {
  const path = String(url || "").split(/[?#]/)[0];
  if (/\.pdf$/i.test(path)) return "PDF";
  if (ev?.type === "報名／申請") return "報名";
  if (ev?.type === "註冊") return "註冊";
  return "學校公告";
}

/**
 * Decode one application/x-www-form-urlencoded component.
 * `+` is a space. Percent-encoding is applied up to twice so a double-encoded
 * 升中 link (for example `%25E6%25B2%2599`) still becomes the original text.
 * Malformed sequences are left as-is instead of throwing.
 */
function decodeUrlParam(raw) {
  if (raw == null) return "";
  let text = String(raw).replace(/\+/g, " ");
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(text)) break;
    try {
      const next = decodeURIComponent(text);
      if (next === text) break;
      text = next;
    } catch {
      break;
    }
  }
  return text.normalize("NFC").trim();
}

function readQueryPairs(queryString) {
  const q = String(queryString || "").replace(/^\?/, "");
  if (!q) return [];
  const pairs = [];
  for (const part of q.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? "" : part.slice(eq + 1);
    pairs.push([decodeUrlParam(rawKey).toLowerCase(), decodeUrlParam(rawVal)]);
  }
  return pairs;
}

function canonicalTab(value) {
  const text = decodeUrlParam(value).toLowerCase();
  if (!text) return null;
  if (text === "events" || text === "event" || text === "升中" || text === "升中項目") return "events";
  if (text === "map" || text === "地圖" || text === "地圖與距離") return "map";
  if (
    text === "favorites" ||
    text === "favourite" ||
    text === "favourites" ||
    text === "favorite" ||
    text === "關注" ||
    text === "我的關注" ||
    text === "關注學校"
  ) {
    return "favorites";
  }
  if (text === "list" || text === "schools" || text === "school" || text === "學校" || text === "學校資料") return "list";
  return null;
}

function canonicalStatus(value) {
  const text = decodeUrlParam(value).replace(/\(/g, "（").replace(/\)/g, "）");
  if (!text) return null;
  if (text === "all" || text === "全部") return "all";
  if (text === "官方確認" || text === "暫定（坊間）" || text === "已過") return text;
  return null;
}

function canonicalBand(value) {
  const text = decodeUrlParam(value).replace(/^民間\s*/i, "").trim();
  if (!text) return null;
  if (text === "all" || text === "全部") return "all";
  if (text === "未知" || text === "未知／不適用" || text === "未知/不適用") return "未知";
  const band = text.match(/^band\s*([123])$/i);
  if (band) return band[1];
  if (text === "1" || text === "2" || text === "3") return text;
  return null;
}

/** Query and hash deep link. Search params win over the hash when both set a key. */
function readDeepLink() {
  const pairs = readQueryPairs(window.location.search);
  const hashRaw = window.location.hash.replace(/^#/, "");
  let hashTab = "";
  if (hashRaw) {
    const q = hashRaw.indexOf("?");
    if (q >= 0) {
      hashTab = decodeUrlParam(hashRaw.slice(0, q));
      pairs.push(...readQueryPairs(hashRaw.slice(q + 1)).map(([k, v]) => [k, v]));
    } else if (hashRaw.includes("=")) {
      pairs.push(...readQueryPairs(hashRaw));
    } else {
      hashTab = decodeUrlParam(hashRaw);
    }
  }
  const map = new Map();
  for (const [key, value] of pairs) {
    if (!map.has(key)) map.set(key, value);
  }
  // Hash-only keys were appended after search, so search still wins via Map.has.
  const school = map.get("school") || map.get("eventschool") || "";
  return {
    tab: canonicalTab(map.get("tab") || map.get("panel") || map.get("view") || hashTab),
    status: canonicalStatus(map.get("status") || map.get("eventstatus")),
    band: canonicalBand(map.get("band") || map.get("eventband")),
    school,
    eventsApplied: false,
  };
}

function districtSortIndex(district) {
  const i = DISTRICT_ORDER.indexOf(district);
  return i === -1 ? DISTRICT_ORDER.length : i;
}

/** Traditional Chinese weekday in fullwidth parentheses, e.g. （一）. Asia/Hong_Kong calendar day. */
const HK_WEEKDAY_SHORT = {
  Sun: "日",
  Mon: "一",
  Tue: "二",
  Wed: "三",
  Thu: "四",
  Fri: "五",
  Sat: "六",
};

const HK_TZ = "Asia/Hong_Kong";

/**
 * Calendar + clock parts in Asia/Hong_Kong.
 * Date-only values are read at noon HKT so a UTC midnight does not shift the day.
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, weekday: string } | null}
 */
function hkWallParts(value, isDateTime) {
  if (value == null || value === "") return null;
  const instant = isDateTime
    ? new Date(value)
    : new Date(`${String(value).slice(0, 10)}T12:00:00+08:00`);
  if (Number.isNaN(instant.getTime())) return null;
  if (!isDateTime && !/^\d{4}-\d{2}-\d{2}$/.test(String(value).slice(0, 10))) return null;

  // Date and clock are read separately. A combined format can report midnight
  // as 24:00 on the previous civil day; the date-only format does not.
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: HK_TZ,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: HK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const pick = (list, type) => list.find((p) => p.type === type)?.value || "";
  const year = Number(pick(dateParts, "year"));
  const month = Number(pick(dateParts, "month"));
  const day = Number(pick(dateParts, "day"));
  let hour = Number(pick(timeParts, "hour"));
  const minute = Number(pick(timeParts, "minute"));
  if (!year || !month || !day || !Number.isFinite(minute)) return null;
  if (!Number.isFinite(hour) || hour === 24) hour = 0;
  hour = ((hour % 24) + 24) % 24;
  return { year, month, day, hour, minute, weekday: pick(dateParts, "weekday") };
}

function hkYmdKey(parts) {
  return parts.year * 10000 + parts.month * 100 + parts.day;
}

/**
 * Current school year plus the next one, inclusive.
 * Hong Kong school years run 1 Sep–31 Aug. `now` is read in Asia/Hong_Kong.
 * @returns {{ start: number, end: number }}
 */
function hkSchoolYearWindow(now) {
  const today = hkWallParts(now.toISOString(), true);
  const year = today ? today.year : now.getFullYear();
  const month = today ? today.month : now.getMonth() + 1;
  const startYear = month >= 9 ? year : year - 1;
  return { start: startYear * 10000 + 901, end: (startYear + 2) * 10000 + 831 };
}

function hkOutsideSchoolWindow(parts, window) {
  const key = hkYmdKey(parts);
  return key < window.start || key > window.end;
}

/** `5/12（六）` or, when a year is required, `5/12/26（六）`. */
function formatHkDayMonth(parts, withYear) {
  const wd = HK_WEEKDAY_SHORT[parts.weekday];
  const paren = wd ? `（${wd}）` : "";
  const core = withYear
    ? `${parts.day}/${parts.month}/${String(parts.year % 100).padStart(2, "0")}`
    : `${parts.day}/${parts.month}`;
  return `${core}${paren}`;
}

/** 24-hour `HH:mm`, always two digits. */
function formatHkClock(parts) {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/**
 * Shared on-screen date label. Every visible system date goes through here.
 *
 * Day/month, no zero-padding, weekday in fullwidth parentheses (`5/12（六）`,
 * `18/11（三）`). A clock is `09:00` (24-hour) with one space before it:
 * `18/11（三） 09:00`. Same-day time ranges put the clocks on the next line.
 * Longer ranges use an en dash. Order is never month/day and never locale order.
 *
 * The two-digit year (`5/12/26`) is omitted when the date sits in the current
 * or next Hong Kong school year (1 Sep–31 Aug from `now`). It is shown on every
 * date in the label when a date is outside that window, or when a range crosses
 * a calendar year — both ends, so `3/12/26（四） – 28/2/27（日）` is unambiguous.
 *
 * @param {string|null|undefined} start
 * @param {string|null|undefined} end
 * @param {boolean} isDateTime
 * @param {{ now?: Date, withTime?: boolean }} [options]
 *   `withTime` defaults to `isDateTime`. Pass false for a day label with no clock.
 */
export function formatHongKongDateRange(start, end, isDateTime, options = {}) {
  const now =
    options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
  const startParts = hkWallParts(start, isDateTime);
  if (!startParts) return "日期待定";

  const showTime = options.withTime ?? Boolean(isDateTime);
  let endParts = end ? hkWallParts(end, isDateTime) : null;
  if (endParts && hkYmdKey(startParts) === hkYmdKey(endParts) && !showTime) endParts = null;

  const window = hkSchoolYearWindow(now);
  const crossYear = Boolean(endParts && startParts.year !== endParts.year);
  const withYear =
    crossYear ||
    hkOutsideSchoolWindow(startParts, window) ||
    (endParts ? hkOutsideSchoolWindow(endParts, window) : false);

  const startLabel = formatHkDayMonth(startParts, withYear);
  if (!showTime) {
    if (!endParts) return startLabel;
    return `${startLabel} – ${formatHkDayMonth(endParts, withYear)}`;
  }

  const startTime = formatHkClock(startParts);
  if (!endParts) return `${startLabel} ${startTime}`;
  const endTime = formatHkClock(endParts);
  if (hkYmdKey(startParts) === hkYmdKey(endParts)) return `${startLabel}\n${startTime}–${endTime}`;
  return `${startLabel} ${startTime}\n– ${formatHkDayMonth(endParts, withYear)} ${endTime}`;
}

/** Start used for ordering. Date-only values are noon in Hong Kong. */
function eventStartMs(ev) {
  if (!ev?.dateStart) return Number.POSITIVE_INFINITY;
  if (ev.isDateTime) {
    const t = new Date(ev.dateStart).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  }
  const ymd = String(ev.dateStart).slice(0, 10);
  const t = new Date(`${ymd}T12:00:00+08:00`).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * When the event is over. Date-only ranges include the whole end day in Hong Kong.
 * Returns null when there is no usable date.
 */
function eventEndMs(ev) {
  const raw = ev?.dateEnd || ev?.dateStart;
  if (!raw) return null;
  if (ev.isDateTime) {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const ymd = String(raw).slice(0, 10);
  const t = new Date(`${ymd}T23:59:59+08:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Past when marked 已過, or when the end (Hong Kong) is already over. */
function isEventPast(ev, now = new Date()) {
  if (ev?.status === "已過") return true;
  const end = eventEndMs(ev);
  if (end == null) return false;
  return end < now.getTime();
}

/**
 * Upcoming nearest-first (earliest start at the top).
 * Past events follow, nearest past first. `now` is only used to split the two groups.
 */
function compareEventsNearest(a, b, now = new Date()) {
  const pastA = isEventPast(a, now) ? 1 : 0;
  const pastB = isEventPast(b, now) ? 1 : 0;
  if (pastA !== pastB) return pastA - pastB;
  if (!pastA) {
    const diff = eventStartMs(a) - eventStartMs(b);
    if (diff) return diff;
  } else {
    const endA = eventEndMs(a);
    const endB = eventEndMs(b);
    const aMs = endA == null ? Number.NEGATIVE_INFINITY : endA;
    const bMs = endB == null ? Number.NEGATIVE_INFINITY : endB;
    const diff = bMs - aMs;
    if (diff) return diff;
  }
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

const TICKET_OPEN_KIND = "ticket-open";

/** YYYY-MM-DD in Asia/Hong_Kong. Date-only values are already that calendar day. */
function hkCalendarDay(value, isDateTime) {
  if (value == null || value === "") return "";
  if (!isDateTime) {
    const ymd = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

/** Countdown only while the start day is today through 30 Hong Kong days ahead. */
const COUNTDOWN_WINDOW_DAYS = 30;

/**
 * Whole Hong Kong calendar days from today to a start value.
 * Date-only strings are that calendar day. Instants use Asia/Hong_Kong date parts.
 * Negative when the start day is already behind today. Null when unusable.
 * @returns {number | null}
 */
export function hkRemainingCalendarDays(value, isDateTime, now = new Date()) {
  const target = hkCalendarDay(value, Boolean(isDateTime));
  const today = hkCalendarDay(now.toISOString(), true);
  if (!target || !today) return null;
  const [ty, tm, td] = target.split("-").map(Number);
  const [ny, nm, nd] = today.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(ny, nm - 1, nd)) / 86400000);
}

/**
 * Countdown copy beside a 升中 card's start day, or "" when it should not show.
 * Activity cards count to `dateStart`. 登記 virtual cards store `keyDateStart`
 * on `dateStart`, so they count to the registration day, never the end day.
 * Past cards (status 已過, or the Hong Kong end already over) stay blank.
 * 0 → 今日, 1 → 聽日, 2–30 → 仲有 N 日. 登記 cards prefix 「登記 · 」.
 */
export function eventCountdownLabel(ev, now = new Date()) {
  if (!ev?.dateStart || isEventPast(ev, now)) return "";
  const days = hkRemainingCalendarDays(ev.dateStart, ev.isDateTime, now);
  if (days == null || days < 0 || days > COUNTDOWN_WINDOW_DAYS) return "";
  const core = days === 0 ? "今日" : days === 1 ? "聽日" : `仲有 ${days} 日`;
  return ev.derivedFrom || ev.type === "登記" ? `登記 · ${core}` : core;
}

/** First date line, with the countdown bound to that line. Later lines (clocks) follow. */
function fillEventWhenMain(main, label, countdown) {
  main.replaceChildren();
  const [first, ...rest] = String(label || "").split("\n");
  const line = document.createElement("span");
  line.className = "event-when-line";
  const date = document.createElement("span");
  date.className = "event-when-date";
  date.textContent = first;
  line.append(date);
  if (countdown) {
    const mark = document.createElement("span");
    mark.className = "event-countdown";
    mark.textContent = countdown;
    line.append(mark);
  }
  main.append(line);
  if (rest.length) {
    const more = document.createElement("span");
    more.className = "event-when-rest";
    more.textContent = rest.join("\n");
    main.append(more);
  }
}

function ticketSchoolLabel(ev) {
  const schools = Array.isArray(ev?.schools)
    ? ev.schools.map((name) => decodeVisiblePercent(name).trim()).filter(Boolean)
    : [];
  if (!schools.length) return "教育局／全港";
  return schools.join("、");
}

function ticketActivityLabel(ev) {
  const title = decodeVisiblePercent(ev?.title || "").trim();
  const schools = Array.isArray(ev?.schools)
    ? ev.schools.map((name) => decodeVisiblePercent(name).trim()).filter(Boolean)
    : [];
  for (const school of schools) {
    if (school && title.startsWith(school)) {
      const rest = title.slice(school.length).trim();
      if (rest) return rest;
    }
  }
  return title;
}

/** 「【登記】{school} · {activity}」 */
export function ticketCardTitle(ev) {
  const activity = ticketActivityLabel(ev);
  const school = ticketSchoolLabel(ev);
  return activity ? `【登記】${school} · ${activity}` : `【登記】${school}`;
}

/**
 * In-memory 登記 row. Nothing is written back to events.json.
 * Derived only when keyDateKind is ticket-open, keyDateStart is set,
 * and that Hong Kong day differs from dateStart's Hong Kong day.
 * Missing keyDateKind is treated as other (no card).
 * @returns {object | null}
 */
export function deriveTicketEvent(parent) {
  if (!parent?.id || parent.derivedFrom) return null;
  if (parent.keyDateKind !== TICKET_OPEN_KIND) return null;
  if (!parent.keyDateStart) return null;
  const keyDay = hkCalendarDay(parent.keyDateStart, parent.keyDateIsDateTime);
  const startDay = hkCalendarDay(parent.dateStart, parent.isDateTime);
  if (!keyDay || !startDay || keyDay === startDay) return null;
  const isDateTime = Boolean(parent.keyDateIsDateTime);
  return {
    id: `${parent.id}-key`,
    derivedFrom: parent.id,
    type: "登記",
    status: parent.status,
    schools: Array.isArray(parent.schools) ? parent.schools.slice() : [],
    dateStart: parent.keyDateStart,
    dateEnd: null,
    isDateTime,
    title: ticketCardTitle(parent),
    sourceUrl: parent.sourceUrl || "",
  };
}

/** Activity day for the 「活動日：5/12（六）›」 jump. Day/month, no clock. */
export function formatActivityDayLabel(parent, now = new Date()) {
  if (!parent?.dateStart) return "";
  const label = formatHongKongDateRange(parent.dateStart, null, Boolean(parent.isDateTime), {
    now,
    withTime: false,
  });
  return label === "日期待定" ? "" : label;
}

/**
 * Key-date stamp shared by the parent 登記 line and the ticket card.
 * Timed: `18/11（三） 09:00`. All-day: `20/10（二）`.
 */
function formatParentTicketWhen(parent, now = new Date()) {
  const value = parent?.keyDateStart;
  if (!value) return "";
  const full = formatHongKongDateRange(value, null, Boolean(parent.keyDateIsDateTime), { now });
  if (!full || full === "日期待定") return "";
  return full;
}

/** Key-date day without a clock, e.g. `18/11（三）`. */
export function formatTicketOpenDay(parent, now = new Date()) {
  const value = parent?.keyDateStart;
  if (!value) return "";
  const label = formatHongKongDateRange(value, null, Boolean(parent.keyDateIsDateTime), {
    now,
    withTime: false,
  });
  return !label || label === "日期待定" ? "" : label;
}

/** `18/11（三） 09:00` when the key date has a clock; otherwise the day only. */
export function formatTicketOpenStamp(parent, now = new Date()) {
  return formatParentTicketWhen(parent, now);
}

/**
 * Parent-card line. Upcoming: 「🎟 登記：18/11（三） 09:00」.
 * Once the key date has passed: 「登記已於 18/11（三）開始」.
 * @returns {{ past: boolean, text: string } | null}
 */
export function ticketLineText(parent, now = new Date()) {
  const ticket = deriveTicketEvent(parent);
  if (!ticket) return null;
  const day = formatTicketOpenDay(parent, now);
  if (!day) return null;
  if (isEventPast(ticket, now)) return { past: true, text: `登記已於 ${day}開始` };
  const stamp = formatTicketOpenStamp(parent, now);
  return { past: false, text: `🎟 登記：${stamp}` };
}

/**
 * Watchlist rows: parents stay (including past, greyed by the card).
 * Past ticket rows are omitted from both the count and the list.
 * Upcoming tickets sort with parents by next start.
 */
export function mergeWatchlistEvents(parents, tickets, now = new Date()) {
  const upcomingTickets = (tickets || []).filter((ev) => !isEventPast(ev, now));
  return (parents || [])
    .concat(upcomingTickets)
    .sort((a, b) => compareEventsNearest(a, b, now));
}

export class App {
  constructor() {
    this.schools = [];
    this.eventsPayload = null;
    this.filterType = "all";
    this.filterBand = "all";
    this.filterDistrict = "all";
    this.eventStatus = "all";
    this.eventSchool = "all";
    /** 升中-only. On shows schools=[]; off hides every empty-schools event. */
    this.showTerritoryEvents = true;
    /**
     * Session-only shared UX: show only favourited schools across list / events / map.
     * Not synced to cloud (same as search `query`).
     */
    this.filterFavoritesOnly = false;
    /** Favourites keyed by exact nameZh (synced when signed in). */
    this.favorites = [];
    this.schoolByName = new Map();
    /**
     * Built once per page load after schools and events are both available.
     * Keyed by schools.json nameZh. Territory-wide events (empty schools) are omitted.
     * @type {Map<string, object[]> | null}
     */
    this.schoolEventsByName = null;
    /** Count of events with schools: []. */
    this.territoryEventCount = 0;
    /** Watchlist cards left open across re-renders (exact nameZh). */
    this.favoritesEventsOpen = new Set();
    /** Watchlist cards that have revealed events past the preview. */
    this.favoritesEventsShowAll = new Set();
    this.query = "";
    this.pageSize = LIST_PAGE_SIZE;
    this.visibleCount = LIST_PAGE_SIZE;
    this.deepLink = null;
    this.failedLogoDomains = new Set();
    this.map = null;
    this.markers = new Map();
    this.markerMeta = new Map();
    this.markerLayer = null;
    this.userMarker = null;
    this.selectedLatLng = null;
    this.mapReady = false;
    /** @type {{ uid: string, displayName?: string, email?: string } | null} */
    this.authUser = null;
    /** @type {((opts?: { immediate?: boolean }) => void) | null} */
    this._onSyncedChange = null;
    this._prefsApplying = false;

    this.els = {
      tabList: document.getElementById("tab-list"),
      tabEvents: document.getElementById("tab-events"),
      tabMap: document.getElementById("tab-map"),
      tabFavorites: document.getElementById("tab-favorites"),
      panelList: document.getElementById("panel-list"),
      panelEvents: document.getElementById("panel-events"),
      panelMap: document.getElementById("panel-map"),
      panelFavorites: document.getElementById("panel-favorites"),
      search: document.getElementById("search"),
      filters: document.querySelector(".filters"),
      bandFilters: document.querySelector(".band-filters"),
      favoritesFilter: document.getElementById("favorites-filter"),
      eventsFavoritesFilter: document.getElementById("events-favorites-filter"),
      favoritesManageLink: document.getElementById("favorites-manage-link"),
      eventsFavoritesManageLink: document.getElementById("events-favorites-manage-link"),
      favoritesList: document.getElementById("favorites-list"),
      favoritesEmpty: document.getElementById("favorites-empty"),
      favoritesMeta: document.getElementById("favorites-meta"),
      districtSelect: document.getElementById("district-select"),
      resultCount: document.getElementById("result-count"),
      schoolList: document.getElementById("school-list"),
      listWindowStatus: document.getElementById("list-window-status"),
      listWindowFooter: document.getElementById("list-window-footer"),
      loadMore: document.getElementById("load-more"),
      listWindowDone: document.getElementById("list-window-done"),
      listEmpty: document.getElementById("list-empty"),
      eventsList: document.getElementById("events-list"),
      eventsEmpty: document.getElementById("events-empty"),
      eventsTitle: document.getElementById("events-title"),
      eventsMeta: document.getElementById("events-meta"),
      eventsFilters: document.querySelector(".events-filters"),
      eventsBandFilters: document.querySelector(".events-band-filters"),
      eventsDistrictSelect: document.getElementById("events-district-select"),
      eventsSchoolSelect: document.getElementById("events-school-select"),
      eventsSchoolEmptyHint: document.getElementById("events-school-empty-hint"),
      eventsTerritoryToggle: document.getElementById("events-territory-toggle"),
      map: document.getElementById("map"),
      mapHint: document.getElementById("map-hint"),
      mapFilterBar: document.getElementById("map-filter-bar"),
      mapFilterChips: document.getElementById("map-filter-chips"),
      mapEmpty: document.getElementById("map-empty"),
      selectedPoint: document.getElementById("selected-point"),
      selectedPointPrimary: document.getElementById("selected-point-primary"),
      selectedPointCoords: document.getElementById("selected-point-coords"),
      distanceList: document.getElementById("distance-list"),
      distanceEmpty: document.getElementById("distance-empty"),
      clearPoint: document.getElementById("clear-point"),
      cardTemplate: document.getElementById("school-card-template"),
    };
  }

  setPrefsHooks({ onSyncedChange } = {}) {
    this._onSyncedChange = typeof onSyncedChange === "function" ? onSyncedChange : null;
  }

  setAuthUser(user) {
    this.authUser = user;
    this.syncFavoritesManageMeta();
  }

  /** Synced prefs snapshot — never includes search `query`. */
  getSyncedPrefs() {
    return {
      filterDistrict: this.filterDistrict || "all",
      filterType: this.filterType || "all",
      filterBand: this.filterBand || "all",
      showTerritoryEvents: this.showTerritoryEvents !== false,
      favorites: this.favorites.slice(),
    };
  }

  /**
   * Apply cloud prefs over local (TR). Unknown favourite names are dropped.
   * Does not touch session-only `query` or `filterFavoritesOnly`.
   */
  applySyncedPrefs(prefs) {
    if (!prefs || typeof prefs !== "object") return;
    this._prefsApplying = true;
    try {
      const district =
        typeof prefs.filterDistrict === "string" && prefs.filterDistrict
          ? prefs.filterDistrict
          : "all";
      this.filterDistrict = district === "all" || DISTRICT_ORDER.includes(district)
        ? district
        : "all";
      this.filterType = ["all", "官立", "資助", "直資", "私立"].includes(prefs.filterType)
        ? prefs.filterType
        : "all";
      this.filterBand = ["all", "1", "2", "3", "未知"].includes(prefs.filterBand)
        ? prefs.filterBand
        : "all";
      this.showTerritoryEvents = prefs.showTerritoryEvents !== false;
      const favs = Array.isArray(prefs.favorites) ? prefs.favorites : [];
      const cleaned = [];
      const seen = new Set();
      for (const name of favs) {
        if (typeof name !== "string" || !name || seen.has(name)) continue;
        if (this.schoolByName.size && !this.schoolByName.has(name)) continue;
        seen.add(name);
        cleaned.push(name);
      }
      this.favorites = cleaned;

      this.syncDistrictSelect();
      this.syncEventsDistrictSelect();
      this.syncChipGroup(this.els.filters, "type", this.filterType);
      this.syncBandChips();
      this.syncTerritoryToggle();
      this.syncFavoritesFilterChip();
      this.onListFiltersChanged();
      this.renderFavoritesManage();
    } finally {
      this._prefsApplying = false;
    }
  }

  notifySyncedPrefsChanged({ immediate = false } = {}) {
    if (this._prefsApplying) return;
    this._onSyncedChange?.({ immediate });
  }

  isFavorite(nameZh) {
    return this.favorites.includes(nameZh);
  }

  toggleFavorite(nameZh) {
    if (!nameZh) return;
    const idx = this.favorites.indexOf(nameZh);
    if (idx >= 0) {
      this.favorites.splice(idx, 1);
      this.favoritesEventsOpen.delete(nameZh);
      this.favoritesEventsShowAll.delete(nameZh);
    } else {
      this.favorites.push(nameZh);
    }
    if (!this.favorites.length) this.filterFavoritesOnly = false;
    this.syncFavoritesFilterChip();
    this.renderFavoritesManage();
    this.onListFiltersChanged({ prefsImmediate: true });
  }

  removeFavorite(nameZh) {
    if (!nameZh) return;
    const idx = this.favorites.indexOf(nameZh);
    if (idx < 0) return;
    this.favorites.splice(idx, 1);
    this.favoritesEventsOpen.delete(nameZh);
    this.favoritesEventsShowAll.delete(nameZh);
    if (!this.favorites.length) this.filterFavoritesOnly = false;
    this.syncFavoritesFilterChip();
    this.renderFavoritesManage();
    this.onListFiltersChanged({ prefsImmediate: true });
  }

  setFavoritesOnly(on) {
    this.filterFavoritesOnly = Boolean(on) && this.favorites.length > 0;
    this.syncFavoritesFilterChip();
    this.onListFiltersChanged();
  }

  syncFavoritesFilterChip() {
    const n = this.favorites.length;
    const label = n > 0 ? `只看關注（${n}）` : "只看關注";
    const active = this.filterFavoritesOnly;
    const disabled = n === 0 && !active;
    for (const btn of [this.els.favoritesFilter, this.els.eventsFavoritesFilter]) {
      if (!btn) continue;
      btn.textContent = label;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.disabled = disabled;
    }
  }

  syncFavoritesManageMeta() {
    const el = this.els.favoritesMeta;
    if (!el) return;
    if (this.authUser?.uid) {
      el.textContent = `已登入：關注清單會同步到帳戶（目前 ${this.favorites.length} 所）。`;
    } else {
      el.textContent =
        `未登入時關注只保留喺呢次瀏覽（目前 ${this.favorites.length} 所）；登入後會同步到帳戶。`;
    }
  }

  renderFavoritesManage() {
    this.syncFavoritesManageMeta();
    const listEl = this.els.favoritesList;
    const emptyEl = this.els.favoritesEmpty;
    if (!listEl || !emptyEl) return;

    const names = this.favorites.slice();
    const isEmpty = names.length === 0;
    emptyEl.hidden = !isEmpty;
    listEl.hidden = isEmpty;
    listEl.replaceChildren();
    if (isEmpty) return;

    for (const nameZh of names) {
      const school = this.schoolByName.get(nameZh);
      const item = document.createElement("li");
      item.className = "favorites-item";

      const main = document.createElement("div");
      main.className = "favorites-item-main";

      const title = document.createElement("h3");
      title.className = "favorites-item-name";
      title.textContent = nameZh;
      main.append(title);

      if (school?.nameEn) {
        const en = document.createElement("p");
        en.className = "favorites-item-name-en";
        en.textContent = school.nameEn;
        main.append(en);
      }

      const badges = document.createElement("div");
      badges.className = "favorites-item-badges";
      if (school?.district) {
        const d = document.createElement("span");
        d.className = "badge";
        d.textContent = school.district;
        badges.append(d);
      }
      if (school?.type) {
        const t = document.createElement("span");
        t.className = `badge type-${school.type}`;
        t.textContent = school.type;
        badges.append(t);
      }
      if (school) {
        const band = school.band || "未知";
        const b = document.createElement("span");
        b.className = `badge band-pill band-${band}`;
        b.title = "民間參考組別，非官方評級";
        b.textContent = this.bandLabel(band);
        badges.append(b);
      } else {
        const missing = document.createElement("span");
        missing.className = "badge";
        missing.textContent = "名單暫無對應";
        badges.append(missing);
      }
      main.append(badges);
      item.append(main);

      const actions = document.createElement("div");
      actions.className = "favorites-item-actions";

      if (school?.id) {
        const mapBtn = document.createElement("button");
        mapBtn.type = "button";
        mapBtn.className = "btn btn-secondary";
        mapBtn.textContent = "在地圖查看";
        mapBtn.addEventListener("click", () => this.showSchoolOnMap(school.id));
        actions.append(mapBtn);
      }

      const schoolEvents = this.eventsForSchool(nameZh);
      const eventsKnown = this.schoolEventsByName != null;
      const panelId = `favorites-events-${listEl.childElementCount}`;
      let panel = null;
      if (eventsKnown && schoolEvents.length > 0) {
        const open = this.favoritesEventsOpen.has(nameZh);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn btn-secondary favorites-events-toggle";
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-controls", panelId);
        const count = schoolEvents.length;
        const label = (expanded) => `升中項目（${count}）${expanded ? "▾" : "▸"}`;
        toggle.textContent = label(open);
        panel = this.buildFavoritesEventsPanel(nameZh, schoolEvents, panelId, open);
        toggle.addEventListener("click", () => {
          const next = toggle.getAttribute("aria-expanded") !== "true";
          toggle.setAttribute("aria-expanded", next ? "true" : "false");
          toggle.textContent = label(next);
          panel.hidden = !next;
          if (next) this.favoritesEventsOpen.add(nameZh);
          else this.favoritesEventsOpen.delete(nameZh);
        });
        actions.append(toggle);
      } else if (eventsKnown) {
        const none = document.createElement("p");
        none.className = "favorites-no-events";
        none.textContent = "暫未有已公佈項目";
        actions.append(none);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-secondary btn-remove-fav";
      removeBtn.textContent = "移出關注";
      removeBtn.setAttribute("aria-label", `移出關注 ${nameZh}`);
      removeBtn.addEventListener("click", () => this.removeFavorite(nameZh));
      actions.append(removeBtn);

      item.append(actions);
      if (panel) item.append(panel);
      listEl.append(item);
    }
  }

  /**
   * Build in-memory 登記 rows from keyDateKind. Never written back to events.json.
   */
  attachDerivedTickets() {
    const events = this.eventsPayload?.events;
    const derived = [];
    const byParent = new Map();
    const byId = new Map();
    if (Array.isArray(events)) {
      for (const ev of events) {
        if (ev?.id) byId.set(ev.id, ev);
        const ticket = deriveTicketEvent(ev);
        if (!ticket) continue;
        derived.push(ticket);
        byParent.set(ev.id, ticket);
      }
    }
    this.eventById = byId;
    this.derivedTicketEvents = derived;
    this.ticketByParentId = byParent;
  }

  /**
   * One-time index: schools.json nameZh → events whose schools[] include that name.
   * Events with an empty schools array are territory-wide and stay out of the map.
   * Ticket rows are indexed separately so past ones can be dropped at render time.
   */
  indexSchoolEvents() {
    if (this.schoolEventsByName) return;
    const events = this.eventsPayload?.events;
    if (!Array.isArray(events) || !this.schools?.length) return;

    this.attachDerivedTickets();

    const byName = new Map();
    const ticketsByName = new Map();
    const canonical = new Map();
    for (const school of this.schools) {
      if (!school?.nameZh) continue;
      byName.set(school.nameZh, []);
      ticketsByName.set(school.nameZh, []);
      canonical.set(String(school.nameZh).normalize("NFC"), school.nameZh);
    }

    const pushNamed = (map, ev) => {
      const schools = ev?.schools;
      if (!Array.isArray(schools) || schools.length === 0) return;
      const seen = new Set();
      for (const raw of schools) {
        const key = canonical.get(String(raw).normalize("NFC"));
        if (!key || seen.has(key)) continue;
        seen.add(key);
        map.get(key).push(ev);
      }
    };

    let territory = 0;
    for (const ev of events) {
      const schools = ev?.schools;
      if (!Array.isArray(schools) || schools.length === 0) {
        if (Array.isArray(schools) && schools.length === 0) territory += 1;
        continue;
      }
      pushNamed(byName, ev);
    }
    for (const ev of this.derivedTicketEvents || []) pushNamed(ticketsByName, ev);

    this.schoolEventsByName = byName;
    this.derivedTicketsBySchool = ticketsByName;
    this.territoryEventCount = territory;
  }

  /**
   * School-scoped rows for one watchlist card.
   * Upcoming ticket rows count and sort by next start. Past ticket rows are omitted.
   */
  eventsForSchool(nameZh, now = new Date()) {
    if (!this.schoolEventsByName || !nameZh) return [];
    const list = this.schoolEventsByName.get(nameZh) || [];
    const tickets = this.derivedTicketsBySchool?.get(nameZh) || [];
    if (!list.length && !tickets.length) return [];
    return mergeWatchlistEvents(list, tickets, now);
  }

  /**
   * Expanded 升中 list for one watchlist card.
   * Reuses the 升中 event card. Past rows are greyed. More than four stay behind 「顯示全部」.
   */
  buildFavoritesEventsPanel(nameZh, schoolEvents, panelId, open) {
    const panel = document.createElement("div");
    panel.className = "favorites-events";
    panel.id = panelId;
    panel.hidden = !open;

    const showAll = this.favoritesEventsShowAll.has(nameZh);
    const now = new Date();
    schoolEvents.forEach((ev, i) => {
      const card = this.buildEventCard(ev);
      if (isEventPast(ev, now)) card.classList.add("is-past");
      if (!showAll && i >= FAVORITES_EVENTS_PREVIEW) {
        card.classList.add("favorites-event-extra");
      }
      panel.append(card);
    });

    if (!showAll && schoolEvents.length > FAVORITES_EVENTS_PREVIEW) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "favorites-events-more";
      more.textContent = `顯示全部（${schoolEvents.length}）`;
      more.addEventListener("click", () => {
        this.favoritesEventsShowAll.add(nameZh);
        const extras = [...panel.querySelectorAll(".favorites-event-extra")];
        for (const row of extras) row.classList.remove("favorites-event-extra");
        const anchor = extras[0];
        if (anchor) {
          anchor.tabIndex = -1;
          anchor.focus({ preventScroll: true });
        }
        more.hidden = true;
      });
      panel.append(more);
    }

    if (this.territoryEventCount > 0) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "favorites-territory-link";
      link.textContent = `另有全港日程（${this.territoryEventCount}）›`;
      link.addEventListener("click", () => this.goToTab("events"));
      panel.append(link);
    }

    return panel;
  }

  goToTab(name) {
    if (!name) return;
    // Prefer the shared activator (works even if a tab node was re-rendered).
    if (typeof this._activateTab === "function") {
      this._activateTab(name);
      return;
    }
    const tab =
      document.querySelector(`.tabs [data-tab="${name}"]`) ||
      {
        list: this.els.tabList,
        events: this.els.tabEvents,
        map: this.els.tabMap,
        favorites: this.els.tabFavorites,
      }[name];
    tab?.click();
  }

  init() {
    this.deepLink = readDeepLink();
    this.bindTabs();
    this.bindListControls();
    this.bindEventFilters();
    this.bindFavoritesManage();
    this.applySharedDeepLink();
    this.els.loadMore?.addEventListener("click", () => this.loadMoreSchools());
    this.els.clearPoint.addEventListener("click", () => this.clearSelectedPoint());
    document.getElementById("list-empty-clear")?.addEventListener("click", () => this.clearAllFilters());
    document.getElementById("map-clear-filters")?.addEventListener("click", () => this.clearAllFilters());
    document.getElementById("map-empty-clear")?.addEventListener("click", () => this.clearAllFilters());
    document.getElementById("distance-empty-clear")?.addEventListener("click", () => this.clearAllFilters());
    document.getElementById("events-empty-clear")?.addEventListener("click", () => this.clearEventFilters());

    // Prefer territory-wide global; keep legacy SHATIN_SCHOOLS as fallback.
    const schools = window.HK_SECONDARY_SCHOOLS || window.SHATIN_SCHOOLS;
    if (!Array.isArray(schools) || !schools.length) {
      this.els.schoolList.innerHTML =
        `<p class="sources">載入失敗：找不到內嵌學校資料。請確認已載入 <code>data/schools-data.js</code>。</p>`;
    } else {
      this.schools = schools;
      this.schoolByName = new Map(schools.map((s) => [s.nameZh, s]));
      this.populateDistrictFilter();
      this.renderList();
    }
    this.populateEventDistrictFilter();
    this.syncFavoritesFilterChip();
    this.renderFavoritesManage();

    this.loadEvents();
    this.applyDeepLinkTab();
  }

  bindFavoritesManage() {
    const openManage = () => {
      this.setListFiltersExpanded(false);
      this.setEventsFiltersExpanded(false);
      this.goToTab("favorites");
    };
    this.els.favoritesManageLink?.addEventListener("click", openManage);
    this.els.eventsFavoritesManageLink?.addEventListener("click", openManage);
    document.getElementById("favorites-empty-goto-list")?.addEventListener("click", () => {
      this.goToTab("list");
    });
  }

  applyDeepLinkTab() {
    const link = this.deepLink;
    if (!link) return;
    const tab = link.tab || (link.status || link.band || link.school ? "events" : null);
    if (tab === "events" || tab === "map" || tab === "favorites" || tab === "list") {
      this.goToTab(tab);
    }
  }

  /** Band in the URL is the shared 民間組別, applied before the first school render. */
  applySharedDeepLink() {
    const link = this.deepLink;
    if (!link?.band) return;
    this.filterBand = link.band;
    this.syncBandChips();
  }

  applyEventDeepLink() {
    const link = this.deepLink;
    if (!link || link.eventsApplied) return;
    link.eventsApplied = true;
    if (link.status) {
      this.eventStatus = link.status;
      this.syncChipGroup(this.els.eventsFilters, "eventStatus", this.eventStatus);
    }
    if (link.school) {
      const resolved = this.resolveEventSchool(link.school);
      if (resolved === "__territory__") {
        this.showTerritoryEvents = true;
        this.eventSchool = "all";
        this.syncTerritoryToggle();
      } else if (resolved && resolved !== "all") {
        this.eventSchool = resolved;
      }
    }
  }

  /** Match a decoded 升中 school param to a catalog school (shared filters may still clear it).
   *  全港／教育局 is no longer an exclusive list; it only keeps the toggle on.
   */
  resolveEventSchool(raw) {
    const name = decodeUrlParam(raw);
    if (!name || name === "all" || name === "全部") return "all";
    if (name === "__territory__" || name === "全港／教育局" || name === "全港/教育局") {
      return "__territory__";
    }
    if (this.schoolByName.has(name)) return name;
    for (const school of this.schoolByName.keys()) {
      if (school.normalize("NFC") === name) return school;
    }
    // Fallback: names that appear only on events (legacy / mismatched strings).
    const eventNames = new Set();
    for (const ev of this.eventsPayload?.events || []) {
      for (const school of ev.schools || []) {
        if (school) eventNames.add(school);
      }
    }
    if (eventNames.has(name)) return name;
    for (const school of eventNames) {
      if (school.normalize("NFC") === name) return school;
    }
    return null;
  }

  populateDistrictFilter() {
    const select = this.els.districtSelect;
    if (!select) return;

    const present = new Set(
      this.schools.map((s) => s.district).filter(Boolean)
    );
    const ordered = DISTRICT_ORDER.filter((d) => present.has(d));
    for (const d of present) {
      if (!DISTRICT_ORDER.includes(d)) ordered.push(d);
    }

    const previous = this.filterDistrict;
    select.replaceChildren();

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "全部十八區";
    select.append(allOpt);

    for (const district of ordered) {
      const count = this.schools.filter((s) => s.district === district).length;
      const opt = document.createElement("option");
      opt.value = district;
      opt.textContent = `${district}（${count}）`;
      select.append(opt);
    }

    this.filterDistrict =
      previous === "all" || present.has(previous) ? previous : "all";
    this.syncDistrictSelect();
  }

  /** District the school list and map actually apply. */
  effectiveFilterDistrict() {
    return this.filterDistrict;
  }

  syncDistrictSelect() {
    const select = this.els.districtSelect;
    if (!select) return;
    const shown = this.effectiveFilterDistrict();
    const allowed = new Set([...select.options].map((opt) => opt.value));
    select.value = allowed.has(shown) ? shown : "all";
  }

  /** Shared district. A stray territory value is ignored and does not write filterDistrict. */
  setSharedDistrict(value) {
    const next = value || "all";
    if (next === "__territory__") {
      this.syncDistrictSelect();
      this.syncEventsDistrictSelect();
      return;
    }
    this.filterDistrict = next;
    this.syncDistrictSelect();
    this.syncEventsDistrictSelect();
  }

  eventsJsonUrl() {
    return new URL("data/events.json", window.location.href).href;
  }

  showEventsLoadError() {
    this.eventsPayload = null;
    this.els.eventsMeta.textContent = "載入失敗";
    this.els.eventsList.innerHTML =
      `<p class="events-error" role="alert">無法載入升中項目。請用網頁方式開啟本站，再重新整理。</p>
       <details class="tech-fold">
         <summary>技術說明</summary>
         <p class="events-error-tech">讀取 <code>data/events.json</code> 失敗。請用 GitHub Pages 或本機 HTTP 開啟；直接雙擊 <code>index.html</code>（file://）時，瀏覽器通常無法讀取本地 JSON。</p>
       </details>`;
  }

  async loadEvents() {
    try {
      const response = await fetch(this.eventsJsonUrl(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.events)) {
        throw new Error("invalid events payload");
      }
      this.eventsPayload = payload;
      this.indexSchoolEvents();
      if (this.els.eventsTitle && payload.title) {
        this.els.eventsTitle.textContent = payload.title;
      }
      this.applyEventDeepLink();
      this.populateEventSchoolFilter();
      this.syncEventsDistrictSelect();
      this.renderEvents();
      this.renderFavoritesManage();
    } catch (err) {
      this.showEventsLoadError();
    }
  }

  /**
   * Single-school picker options = schools in the current shared-filter intersection
   * (district / type / band / 只看關注 / search). Sorted by zh-Hant name.
   * Empty intersection → disabled select + hint; stale selection resets to 全部.
   */
  populateEventSchoolFilter() {
    const select = this.els.eventsSchoolSelect;
    if (!select) return;

    const sorted = this.filteredSchools()
      .map((s) => s.nameZh)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const nameSet = new Set(sorted);

    const previous = this.eventSchool;
    select.replaceChildren();

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "全部";
    select.append(allOpt);

    for (const name of sorted) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.append(opt);
    }

    const stillValid = previous === "all" || nameSet.has(previous);
    this.eventSchool = stillValid ? previous : "all";
    select.value = this.eventSchool;

    const empty = sorted.length === 0;
    select.disabled = empty;
    select.setAttribute("aria-disabled", empty ? "true" : "false");
    const hint = this.els.eventsSchoolEmptyHint;
    if (hint) hint.hidden = !empty;
  }

  /** 全部十八區, then each DISTRICT_ORDER district. No territory-only option. */
  populateEventDistrictFilter() {
    const select = this.els.eventsDistrictSelect;
    if (!select) return;

    select.replaceChildren();

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "全部十八區";
    select.append(allOpt);

    for (const district of DISTRICT_ORDER) {
      const opt = document.createElement("option");
      opt.value = district;
      opt.textContent = district;
      select.append(opt);
    }

    this.syncEventsDistrictSelect();
  }

  /** Reflect the shared district. */
  syncEventsDistrictSelect() {
    const select = this.els.eventsDistrictSelect;
    if (!select || !select.options.length) return;
    const district = this.filterDistrict;
    const allowed = new Set([...select.options].map((opt) => opt.value));
    select.value = district !== "__territory__" && allowed.has(district) ? district : "all";
  }

  syncEventSchoolSelect() {
    const select = this.els.eventsSchoolSelect;
    if (!select) return;
    const allowed = new Set([...select.options].map((opt) => opt.value));
    if (!allowed.has(this.eventSchool)) this.eventSchool = "all";
    select.value = this.eventSchool;
  }

  syncTerritoryToggle() {
    const button = this.els.eventsTerritoryToggle;
    if (!button) return;
    const on = Boolean(this.showTerritoryEvents);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.classList.toggle("is-active", on);
  }

  bindTabs() {
    const nav = document.querySelector("nav.tabs") || this.els.tabList?.parentElement;
    const panelIds = {
      list: "panel-list",
      events: "panel-events",
      map: "panel-map",
      favorites: "panel-favorites",
    };

    const activate = (name) => {
      if (!name || !panelIds[name]) return;
      // Live-query panels/tabs so a late DOM / cache mismatch cannot leave
      // every panel hidden while the favorites button appears inert.
      const panels = {
        list: document.getElementById(panelIds.list) || this.els.panelList,
        events: document.getElementById(panelIds.events) || this.els.panelEvents,
        map: document.getElementById(panelIds.map) || this.els.panelMap,
        favorites:
          document.getElementById(panelIds.favorites) || this.els.panelFavorites,
      };
      const targetPanel = panels[name];
      if (!targetPanel) {
        console.warn(`[tabs] missing panel for "${name}"`);
        return;
      }

      // Keep els in sync for the rest of App.
      this.els.panelList = panels.list;
      this.els.panelEvents = panels.events;
      this.els.panelMap = panels.map;
      this.els.panelFavorites = panels.favorites;

      for (const [key, panel] of Object.entries(panels)) {
        if (!panel) continue;
        const on = key === name;
        panel.classList.toggle("is-active", on);
        panel.hidden = !on;
      }

      const tabButtons = nav
        ? [...nav.querySelectorAll("[data-tab]")]
        : [
            this.els.tabList,
            this.els.tabEvents,
            this.els.tabMap,
            this.els.tabFavorites,
          ].filter(Boolean);
      for (const tab of tabButtons) {
        const key = tab.dataset?.tab;
        if (!key || !panelIds[key]) continue;
        const on = key === name;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", String(on));
        if (key === "list") this.els.tabList = tab;
        if (key === "events") this.els.tabEvents = tab;
        if (key === "map") this.els.tabMap = tab;
        if (key === "favorites") this.els.tabFavorites = tab;
      }

      if (name !== "list") this.setListFiltersExpanded(false);
      if (name !== "events") this.setEventsFiltersExpanded(false);
      if (name === "list") requestAnimationFrame(() => this.syncListStickyOffset());
      if (name === "events") requestAnimationFrame(() => this.syncEventsStickyOffset());
      if (name === "favorites") this.renderFavoritesManage();
      if (name === "map") {
        // Wait until the tab panel is laid out (display:none → visible).
        // One rAF is not always enough; ensureMap retries until size > 0.
        requestAnimationFrame(() => this.ensureMap());
      }
    };

    this._activateTab = activate;

    if (nav) {
      nav.addEventListener("click", (event) => {
        const btn = event.target.closest?.("[data-tab]");
        if (!btn || !nav.contains(btn)) return;
        const name = btn.getAttribute("data-tab") || btn.dataset?.tab;
        if (!name || !panelIds[name]) return;
        event.preventDefault();
        activate(name);
      });
    } else {
      // Fallback if nav wrapper is missing.
      this.els.tabList?.addEventListener("click", () => activate("list"));
      this.els.tabEvents?.addEventListener("click", () => activate("events"));
      this.els.tabMap?.addEventListener("click", () => activate("map"));
      this.els.tabFavorites?.addEventListener("click", () => activate("favorites"));
    }
  }

  mapContainerSize() {
    const el = this.els.map;
    if (!el) return { w: 0, h: 0 };
    return { w: el.clientWidth || 0, h: el.clientHeight || 0 };
  }

  bindEventFilters() {
    this.bindCompactEventsFilters();
    if (this.els.eventsBandFilters) {
      this.els.eventsBandFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-band]");
        if (!btn) return;
        this.filterBand = btn.dataset.band;
        this.syncBandChips();
        this.onListFiltersChanged();
        this.setEventsFiltersExpanded(false);
      });
    }
    if (this.els.eventsFilters) {
      this.els.eventsFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-event-status]");
        if (!btn) return;
        this.eventStatus = btn.dataset.eventStatus;
        this.syncChipGroup(this.els.eventsFilters, "eventStatus", this.eventStatus);
        this.renderEvents();
        this.setEventsFiltersExpanded(false);
      });
    }
    if (this.els.eventsDistrictSelect) {
      this.els.eventsDistrictSelect.addEventListener("change", () => {
        this.setSharedDistrict(this.els.eventsDistrictSelect.value || "all");
        this.onListFiltersChanged();
        this.setEventsFiltersExpanded(false);
      });
    }
    if (this.els.eventsSchoolSelect) {
      this.els.eventsSchoolSelect.addEventListener("change", () => {
        const value = this.els.eventsSchoolSelect.value || "all";
        this.eventSchool = value === "__territory__" ? "all" : value;
        this.renderEvents();
        this.setEventsFiltersExpanded(false);
      });
    }
    if (this.els.eventsTerritoryToggle) {
      this.els.eventsTerritoryToggle.addEventListener("click", () => {
        this.showTerritoryEvents = !this.showTerritoryEvents;
        this.syncTerritoryToggle();
        this.renderEvents();
        this.notifySyncedPrefsChanged();
      });
      this.syncTerritoryToggle();
    }
    if (this.els.eventsFavoritesFilter) {
      this.els.eventsFavoritesFilter.addEventListener("click", () => {
        if (!this.favorites.length && !this.filterFavoritesOnly) return;
        this.setFavoritesOnly(!this.filterFavoritesOnly);
        this.setEventsFiltersExpanded(false);
      });
    }
  }

  eventMatchesSchoolFilter(ev) {
    const schools = Array.isArray(ev.schools) ? ev.schools : [];
    if (!schools.length) return true; // designated-school filter exempt
    if (this.eventSchool === "all") return true;
    return schools.includes(this.eventSchool);
  }

  /**
   * Shared district / type / band / favorites-only / query, joined through exact nameZh → school.
   * One linked school must satisfy every active shared condition.
   * Empty schools=[] follow showTerritoryEvents only. District, type, 民間組別,
   * 只看關注, and search do not hide them.
   */
  eventMatchesSharedFilters(ev) {
    const schools = Array.isArray(ev.schools) ? ev.schools : [];
    if (!schools.length) return this.showTerritoryEvents;

    const typeActive = this.filterType !== "all";
    const bandActive = this.filterBand !== "all";
    const queryActive = Boolean(this.query);
    const districtActive = this.filterDistrict !== "all";
    const favActive = this.filterFavoritesOnly && this.favorites.length > 0;
    const favSet = favActive ? new Set(this.favorites) : null;

    if (!districtActive && !typeActive && !bandActive && !queryActive && !favActive) {
      return true;
    }

    return schools.some((name) => {
      const school = this.schoolByName.get(name);
      if (favSet && !favSet.has(name)) return false;
      if (districtActive && school?.district !== this.filterDistrict) return false;
      if (typeActive && school?.type !== this.filterType) return false;
      if (bandActive) {
        const band = school ? (school.band || "未知") : "未知";
        if (band !== this.filterBand) return false;
      }
      if (queryActive && (!school || !this.schoolSearchText(school).includes(this.query))) {
        return false;
      }
      return true;
    });
  }

  clearEventFilters() {
    this.eventStatus = "all";
    this.eventSchool = "all";
    this.showTerritoryEvents = true;
    this.syncChipGroup(this.els.eventsFilters, "eventStatus", "all");
    this.syncTerritoryToggle();
    this.syncEventSchoolSelect();
    this.clearAllFilters();
  }

  /**
   * Same 升中 filters for source rows and derived ticket rows.
   * Shared filters read schools (copied from the parent). Status reads the
   * copied parent status. There is no 登記 filter.
   */
  eventPassesListFilters(ev) {
    const schools = Array.isArray(ev.schools) ? ev.schools : [];
    // Empty schools=[] follow the territory toggle only (status exempt).
    if (!schools.length) return this.showTerritoryEvents;
    if (this.eventStatus !== "all" && ev.status !== this.eventStatus) return false;
    if (!this.eventMatchesSharedFilters(ev)) return false;
    return this.eventMatchesSchoolFilter(ev);
  }

  renderEvents() {
    this.updateEventsFilterSummary();
    if (!this.eventsPayload?.events) return;
    if (!this.derivedTicketEvents) this.attachDerivedTickets();
    const combined = this.eventsPayload.events.concat(this.derivedTicketEvents || []);
    const total = combined.length;
    // Upcoming nearest-first, then past (same split the watchlist uses).
    // Past ticket rows stay in that past group; they are not dropped here.
    const list = combined
      .filter((ev) => this.eventPassesListFilters(ev))
      .sort((a, b) => compareEventsNearest(a, b));

    if (this.els.eventsMeta) {
      const territoryVisible = list.filter((ev) => !ev.schools?.length).length;
      const schoolScoped =
        this.filterDistrict !== "all" ||
        this.filterType !== "all" ||
        this.filterBand !== "all" ||
        (this.filterFavoritesOnly && this.favorites.length > 0) ||
        this.eventSchool !== "all";
      let meta = `顯示 ${list.length} / ${total} 項`;
      if (this.showTerritoryEvents && territoryVisible > 0 && schoolScoped) {
        meta += `（另加 ${territoryVisible} 項教育局／全港）`;
      }
      this.els.eventsMeta.textContent = meta;
    }

    this.els.eventsList.replaceChildren();
    const isEmpty = list.length === 0;
    if (this.els.eventsEmpty) {
      this.els.eventsEmpty.hidden = !isEmpty;
      const body = this.els.eventsEmpty.querySelector(".empty-state-body");
      if (body) {
        const notes = [];
        if (this.filterBand !== "all") {
          notes.push("民間組別只對應相關學校的民間參考，並非項目本身的評級。");
        }
        if (this.filterFavoritesOnly && this.favorites.length > 0) {
          notes.push("「只看關注」只顯示相關學校在關注清單內的項目。");
        }
        if (!this.showTerritoryEvents) {
          notes.push("已關掉「顯示教育局／全港項目」，無相關學校的教育局／全港項目不會顯示。");
        }
        const tail = "呢個條件暫時冇項目。可試其他篩選，或稍後再睇（資料持續更新）。";
        body.textContent = notes.length ? `${notes.join("")}${tail}` : tail;
      }
    }
    if (isEmpty) return;

    for (const ev of list) {
      this.els.eventsList.append(this.buildEventCard(ev, { anchor: true }));
    }
  }

  /** Scroll the 升中 list to the parent. Clear filters when that card is not in the list. */
  revealParentEvent(parentId) {
    if (!parentId) return;
    const find = () => this.els.eventsList?.querySelector(`[data-event-id="${parentId}"]`);
    const focusCard = (el) => {
      this.goToTab("events");
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("is-scroll-target");
        el.tabIndex = -1;
        el.focus({ preventScroll: true });
        window.setTimeout(() => el.classList.remove("is-scroll-target"), 2200);
      });
    };
    const existing = find();
    if (existing) {
      focusCard(existing);
      return;
    }
    this.clearEventFilters();
    const revealed = find();
    if (revealed) focusCard(revealed);
  }

  /** Shared 升中 event card (升中 tab and watchlist panel). */
  buildEventCard(ev, { anchor = false } = {}) {
    if (ev?.derivedFrom) return this.buildTicketCard(ev, { anchor });
    const card = document.createElement("article");
    card.className = "event-card";
    card.dataset.eventId = ev.id || "";
    if (anchor && ev.id) card.id = `event-${ev.id}`;

    const when = document.createElement("div");
    when.className = "event-when";
    const main = document.createElement("div");
    main.className = "event-when-main";
    fillEventWhenMain(
      main,
      formatHongKongDateRange(ev.dateStart, ev.dateEnd, ev.isDateTime),
      eventCountdownLabel(ev)
    );
    when.append(main);
    if (ev.keyPoints) {
      const key = document.createElement("small");
      key.textContent = `關鍵：${decodeVisiblePercent(ev.keyPoints)}`;
      when.append(key);
    }

    const body = document.createElement("div");
    body.className = "event-body";
    const title = document.createElement("h3");
    title.textContent = decodeVisiblePercent(ev.title);
    body.append(title);

    const badges = document.createElement("div");
    badges.className = "badges";
    const typeBadge = document.createElement("span");
    typeBadge.className = `badge type-${ev.type}`;
    typeBadge.textContent = decodeVisiblePercent(ev.type);
    badges.append(typeBadge);
    const statusBadge = document.createElement("span");
    statusBadge.className = `badge status-${ev.status}`;
    statusBadge.textContent = decodeVisiblePercent(ev.status);
    badges.append(statusBadge);
    if (!ev.schools?.length) {
      const territory = document.createElement("span");
      territory.className = "badge badge-territory";
      const shortLabel = document.createElement("span");
      shortLabel.className = "badge-territory-short";
      shortLabel.textContent = "全港";
      const wideLabel = document.createElement("span");
      wideLabel.className = "badge-territory-wide";
      wideLabel.textContent = "教育局／全港";
      territory.append(shortLabel, wideLabel);
      badges.append(territory);
    } else {
      for (const school of ev.schools) {
        const s = document.createElement("span");
        s.className = "badge";
        s.textContent = decodeVisiblePercent(school);
        badges.append(s);
      }
    }
    body.append(badges);

    const ticketLine = ticketLineText(ev);
    if (ticketLine) {
      const line = document.createElement("p");
      line.className = ticketLine.past ? "event-ticket-line is-past" : "event-ticket-line";
      line.textContent = ticketLine.text;
      body.append(line);
    }

    if (ev.notes) {
      const notes = document.createElement("p");
      notes.textContent = decodeVisiblePercent(ev.notes);
      body.append(notes);
    }

    const links = document.createElement("p");
    links.className = "event-links";
    if (ev.sourceUrl) {
      const href = ensureUrl(decodeHrefPercent(ev.sourceUrl));
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = eventSourceLabel(ev, ev.sourceUrl);
      links.append(anchor);
    }

    if (ev.dateStart) {
      if (links.childNodes.length) {
        const sep = document.createElement("span");
        sep.className = "event-link-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = " · ";
        links.append(sep);
      }
      const icsBtn = document.createElement("button");
      icsBtn.type = "button";
      icsBtn.className = "event-ics-link";
      icsBtn.textContent = "下載日曆";
      icsBtn.setAttribute(
        "aria-label",
        `下載「${decodeVisiblePercent(ev.title) || ev.id}」日曆檔`
      );
      icsBtn.addEventListener("click", () => {
        downloadEventIcs(ev);
      });
      links.append(icsBtn);
    }

    if (links.childNodes.length) body.append(links);

    if (!ev.dateStart) {
      const hint = document.createElement("p");
      hint.className = "event-ics-missing";
      hint.textContent = "缺開始日期，無法下載日曆";
      body.append(hint);
    }

    card.append(when, body);
    return card;
  }

  /**
   * Derived 登記 card. Main line is the ticket time. The only action is
   * 「下載登記提醒」. 「活動日 ›」 scrolls to the parent card.
   */
  buildTicketCard(ev, { anchor = false } = {}) {
    const card = document.createElement("article");
    card.className = "event-card is-ticket";
    card.dataset.eventId = ev.id || "";
    card.dataset.derivedFrom = ev.derivedFrom || "";
    if (anchor && ev.id) card.id = `event-${ev.id}`;

    const when = document.createElement("div");
    when.className = "event-when";
    const main = document.createElement("div");
    main.className = "event-when-main";
    fillEventWhenMain(
      main,
      formatHongKongDateRange(ev.dateStart, ev.dateEnd, ev.isDateTime),
      eventCountdownLabel(ev)
    );
    when.append(main);

    const parent = this.eventById?.get(ev.derivedFrom);
    const activityDay = parent ? formatActivityDayLabel(parent) : "";
    if (parent && activityDay) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "event-activity-jump";
      jump.textContent = `活動日：${activityDay}›`;
      jump.setAttribute("aria-label", `前往活動日 ${activityDay} 的項目`);
      jump.addEventListener("click", () => this.revealParentEvent(parent.id));
      when.append(jump);
    }

    const body = document.createElement("div");
    body.className = "event-body";
    const title = document.createElement("h3");
    title.textContent = ev.title || "";
    body.append(title);

    const badges = document.createElement("div");
    badges.className = "badges";
    const badge = document.createElement("span");
    badge.className = "badge badge-ticket";
    badge.textContent = "登記";
    badges.append(badge);
    body.append(badges);

    if (ev.dateStart) {
      const links = document.createElement("p");
      links.className = "event-links";
      const icsBtn = document.createElement("button");
      icsBtn.type = "button";
      icsBtn.className = "event-ics-link";
      icsBtn.textContent = "下載登記提醒";
      icsBtn.setAttribute("aria-label", `下載「${ev.title || ev.id}」登記提醒`);
      icsBtn.addEventListener("click", () => {
        downloadEventIcs(ev);
      });
      links.append(icsBtn);
      body.append(links);
    }

    card.append(when, body);
    return card;
  }

  onListFiltersChanged({ prefsImmediate = false } = {}) {
    this.visibleCount = this.pageSize;
    this.renderList();
    this.renderMapChrome();
    if (this.mapReady) {
      const sized = this.mapContainerSize();
      const onScreen = sized.w >= 32 && sized.h >= 32;
      // fitBounds while the map tab is display:none produces a bad zoom, and
      // MarkerCluster will not draw children until the next real moveend.
      this._refitWhenShown = !onScreen;
      this.addSchoolMarkers({ refit: onScreen });
      if (this.selectedLatLng) {
        this.renderDistances();
      }
    }
    this.syncEventsDistrictSelect();
    this.populateEventSchoolFilter();
    this.renderEvents();
    // Cloud write for synced filters only (query is excluded from snapshot).
    this.notifySyncedPrefsChanged({ immediate: prefsImmediate });
  }

  syncChipGroup(container, datasetKey, value) {
    if (!container) return;
    container.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset[datasetKey] === value);
    });
  }

  /** School list and 升中 share filterBand. Both chip rows stay in step. */
  syncBandChips() {
    this.syncChipGroup(this.els.bandFilters, "band", this.filterBand);
    this.syncChipGroup(this.els.eventsBandFilters, "band", this.filterBand);
  }

  /** Reset shared filters. Map reads the same state via onListFiltersChanged. */
  clearAllFilters() {
    this.showTerritoryEvents = true;
    this.filterDistrict = "all";
    this.filterType = "all";
    this.filterBand = "all";
    this.filterFavoritesOnly = false;
    this.query = "";
    this.syncDistrictSelect();
    this.syncEventsDistrictSelect();
    this.syncEventSchoolSelect();
    if (this.els.search) this.els.search.value = "";
    this.syncChipGroup(this.els.filters, "type", "all");
    this.syncBandChips();
    this.syncFavoritesFilterChip();
    this.syncTerritoryToggle();
    this.onListFiltersChanged();
  }

  removeListFilter(key) {
    if (key === "district") {
      this.setSharedDistrict("all");
    } else if (key === "type") {
      this.filterType = "all";
      this.syncChipGroup(this.els.filters, "type", "all");
    } else if (key === "band") {
      this.filterBand = "all";
      this.syncBandChips();
    } else if (key === "query") {
      this.query = "";
      if (this.els.search) this.els.search.value = "";
    } else if (key === "favorites") {
      this.filterFavoritesOnly = false;
      this.syncFavoritesFilterChip();
    } else {
      return;
    }
    this.onListFiltersChanged();
  }

  activeFilterPhrase(items) {
    return items.map((item) => item.label).join("、");
  }

  activeListFilters() {
    const items = [];
    const district = this.effectiveFilterDistrict();
    if (district !== "all") {
      items.push({ key: "district", label: `分區：${district}` });
    }
    if (this.filterType !== "all") {
      items.push({ key: "type", label: `類型：${this.filterType}` });
    }
    if (this.filterBand !== "all") {
      const bandText = this.filterBand === "未知"
        ? "未知／不適用"
        : this.bandLabel(this.filterBand);
      items.push({ key: "band", label: `民間組別：${bandText}` });
    }
    if (this.query) {
      items.push({ key: "query", label: `搜尋：${this.query}` });
    }
    if (this.filterFavoritesOnly && this.favorites.length > 0) {
      items.push({ key: "favorites", label: `只看關注（${this.favorites.length}）` });
    }
    return items;
  }

  renderMapChrome() {
    const chips = this.activeListFilters();
    const bar = this.els.mapFilterBar;
    const host = this.els.mapFilterChips;
    if (bar && host) {
      host.replaceChildren();
      bar.hidden = chips.length === 0;
      for (const item of chips) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip map-active-chip";
        btn.dataset.filterKey = item.key;
        btn.textContent = item.label;
        btn.setAttribute("aria-label", `移除篩選：${item.label}`);
        btn.addEventListener("click", () => this.removeListFilter(item.key));
        host.append(btn);
      }
    }

    const none = this.schools.length > 0 && this.filteredSchools().length === 0;
    if (this.els.mapEmpty) {
      this.els.mapEmpty.hidden = !none;
      const body = this.els.mapEmpty.querySelector(".empty-state-body");
      if (body) {
        const phrase = this.activeFilterPhrase(chips);
        body.textContent = phrase
          ? `目前篩選：${phrase}。地圖上沒有學校，清除篩選後可再點選位置量度直線距離。`
          : "地圖上目前沒有學校。清除篩選後可查看全部學校，再點選位置量度直線距離。";
      }
    }
    if (this.els.mapHint) {
      const hideHint = none || Boolean(this.selectedLatLng);
      this.els.mapHint.classList.toggle("is-hidden", hideHint);
    }
  }

  bindListControls() {
    this.bindCompactListFilters();

    this.els.search.addEventListener("input", (e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.onListFiltersChanged();
    });

    this.els.filters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-type]");
      if (!btn) return;
      this.filterType = btn.dataset.type;
      this.syncChipGroup(this.els.filters, "type", this.filterType);
      this.onListFiltersChanged();
      this.setListFiltersExpanded(false);
    });

    if (this.els.bandFilters) {
      this.els.bandFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-band]");
        if (!btn) return;
        this.filterBand = btn.dataset.band;
        this.syncBandChips();
        this.onListFiltersChanged();
        this.setListFiltersExpanded(false);
      });
    }

    if (this.els.districtSelect) {
      this.els.districtSelect.addEventListener("change", () => {
        this.setSharedDistrict(this.els.districtSelect.value || "all");
        this.onListFiltersChanged();
        this.setListFiltersExpanded(false);
      });
    }

    if (this.els.favoritesFilter) {
      this.els.favoritesFilter.addEventListener("click", () => {
        if (!this.favorites.length && !this.filterFavoritesOnly) return;
        this.setFavoritesOnly(!this.filterFavoritesOnly);
        this.setListFiltersExpanded(false);
      });
    }
  }

  schoolSearchText(school) {
    const band = school.band || "未知";
    return [
      school.nameZh,
      school.nameEn,
      school.district || "",
      school.addressZh,
      school.addressEn,
      school.type,
      school.religion,
      school.gender,
      school.bandNote || "",
      this.bandLabel(band),
      band === "1" || band === "2" || band === "3" ? `Band ${band}` : "",
      school.phone,
    ]
      .join(" ")
      .toLowerCase();
  }

  /** School-list sticky bar: collapsed by default on every screen size. */
  bindCompactListFilters() {
    const toolbar = document.getElementById("list-toolbar");
    const toggle = document.getElementById("list-filter-toggle");
    const backdrop = document.getElementById("list-filter-backdrop");
    this.els.listToolbar = toolbar;
    this.els.listFilterToggle = toggle;
    this.els.listFilterBackdrop = backdrop;
    this.els.listFilterSummary = document.getElementById("list-filter-summary");
    this.els.listFilterSummaryText = document.getElementById("list-filter-summary-text");
    this.els.listFilterPanel = document.getElementById("list-filter-panel");

    toggle?.addEventListener("click", () => {
      const open = Boolean(toolbar?.classList.contains("is-expanded"));
      this.setListFiltersExpanded(!open);
    });
    backdrop?.addEventListener("click", () => this.setListFiltersExpanded(false));
    document.getElementById("list-filter-clear")?.addEventListener("click", () => {
      this.clearCompactFilters();
      this.setListFiltersExpanded(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!toolbar?.classList.contains("is-expanded")) return;
      this.setListFiltersExpanded(false);
    });

    if (typeof ResizeObserver !== "undefined" && toolbar) {
      this._listToolbarObserver = new ResizeObserver(() => this.syncListStickyOffset());
      this._listToolbarObserver.observe(toolbar);
    }
    window.addEventListener("resize", () => this.syncListStickyOffset());
    this.setListFiltersExpanded(false);
    this.syncListStickyOffset();
  }

  syncListStickyOffset() {
    const toolbar = this.els.listToolbar;
    if (!toolbar) return;
    const height = Math.ceil(toolbar.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty("--list-sticky-offset", `${height}px`);
    }
    if (!toolbar.classList.contains("is-expanded")) return;
    const bottom = Math.max(0, Math.round(toolbar.getBoundingClientRect().bottom));
    const backdrop = this.els.listFilterBackdrop;
    if (backdrop && !backdrop.hidden) backdrop.style.top = `${bottom}px`;
    const panel = this.els.listFilterPanel;
    if (panel) {
      const available = window.innerHeight - bottom - 8;
      panel.style.maxHeight = `${Math.max(140, Math.floor(available))}px`;
    }
  }

  setListFiltersExpanded(expanded) {
    const toolbar = this.els.listToolbar;
    const toggle = this.els.listFilterToggle;
    const backdrop = this.els.listFilterBackdrop;
    if (!toolbar || !toggle) return;
    const open = Boolean(expanded);
    const wasOpen = toolbar.classList.contains("is-expanded");
    toolbar.classList.toggle("is-expanded", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const label = toggle.querySelector(".toolbar-filter-toggle-label");
    if (label) label.textContent = open ? "收起" : "篩選";
    this.syncListFilterToggleLabel(open);
    const panel = this.els.listFilterPanel;
    if (backdrop) {
      backdrop.hidden = !open;
      backdrop.classList.toggle("is-open", open);
    }
    if (open) {
      const bottom = Math.max(0, Math.round(toolbar.getBoundingClientRect().bottom));
      if (backdrop) backdrop.style.top = `${bottom}px`;
      if (panel) {
        const available = window.innerHeight - bottom - 8;
        panel.style.maxHeight = `${Math.max(140, Math.floor(available))}px`;
      }
    } else {
      if (backdrop) backdrop.style.top = "";
      if (panel) panel.style.maxHeight = "";
    }
    document.documentElement.classList.toggle("list-filters-open", open);
    if (wasOpen && !open) {
      const active = document.activeElement;
      if (panel?.contains(active) || active === backdrop || active === document.body) {
        toggle.focus({ preventScroll: true });
      }
    }
  }

  compactFilterParts() {
    const parts = [];
    const district = this.effectiveFilterDistrict();
    if (district !== "all") parts.push(district);
    if (this.filterType !== "all") parts.push(this.filterType);
    if (this.filterBand !== "all") {
      parts.push(this.filterBand === "未知" ? "未知／不適用" : this.bandLabel(this.filterBand));
    }
    if (this.filterFavoritesOnly && this.favorites.length > 0) {
      parts.push(`只看關注（${this.favorites.length}）`);
    }
    return parts;
  }

  syncListFilterToggleLabel(open) {
    const toggle = this.els.listFilterToggle;
    if (!toggle) return;
    if (open) {
      toggle.setAttribute("aria-label", "收起篩選");
      return;
    }
    const parts = this.compactFilterParts();
    toggle.setAttribute(
      "aria-label",
      parts.length ? `展開篩選，目前：${parts.join("、")}` : "展開篩選"
    );
  }

  updateListFilterSummary() {
    const summary = this.els.listFilterSummary;
    const text = this.els.listFilterSummaryText;
    const parts = this.compactFilterParts();
    const active = parts.length > 0;
    this.els.listToolbar?.classList.toggle("has-active-filters", active);
    this.els.listFilterToggle?.classList.toggle("has-active", active);
    const open = Boolean(this.els.listToolbar?.classList.contains("is-expanded"));
    this.syncListFilterToggleLabel(open);
    if (!summary || !text) return;
    if (!active) {
      summary.hidden = true;
      text.textContent = "";
      return;
    }
    text.textContent = parts.join(" · ");
    summary.hidden = false;
  }

  /** Clear district, type, band, and favorites-only. Search stays in the compact row. */
  clearCompactFilters() {
    this.setSharedDistrict("all");
    this.filterType = "all";
    this.filterBand = "all";
    this.filterFavoritesOnly = false;
    this.syncEventSchoolSelect();
    this.syncChipGroup(this.els.filters, "type", "all");
    this.syncBandChips();
    this.syncFavoritesFilterChip();
    this.onListFiltersChanged();
  }

  /** 升中 sticky bar: collapsed by default on every screen size. */
  bindCompactEventsFilters() {
    const stack = document.getElementById("events-filter-stack");
    const toggle = document.getElementById("events-filter-toggle");
    const backdrop = document.getElementById("events-filter-backdrop");
    this.els.eventsFilterStack = stack;
    this.els.eventsFilterToggle = toggle;
    this.els.eventsFilterBackdrop = backdrop;
    this.els.eventsFilterSummary = document.getElementById("events-filter-summary");
    this.els.eventsFilterSummaryText = document.getElementById("events-filter-summary-text");
    this.els.eventsFilterPanel = document.getElementById("events-filter-panel");

    toggle?.addEventListener("click", () => {
      const open = Boolean(stack?.classList.contains("is-expanded"));
      this.setEventsFiltersExpanded(!open);
    });
    backdrop?.addEventListener("click", () => this.setEventsFiltersExpanded(false));
    document.getElementById("events-filter-clear")?.addEventListener("click", () => {
      this.clearEventsCompactFilters();
      this.setEventsFiltersExpanded(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!stack?.classList.contains("is-expanded")) return;
      this.setEventsFiltersExpanded(false);
    });

    if (typeof ResizeObserver !== "undefined" && stack) {
      this._eventsToolbarObserver = new ResizeObserver(() => this.syncEventsStickyOffset());
      this._eventsToolbarObserver.observe(stack);
    }
    window.addEventListener("resize", () => this.syncEventsStickyOffset());
    this.setEventsFiltersExpanded(false);
    this.syncEventsStickyOffset();
  }

  syncEventsStickyOffset() {
    const stack = this.els.eventsFilterStack;
    if (!stack) return;
    const height = Math.ceil(stack.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty("--events-sticky-offset", `${height}px`);
    }
    if (!stack.classList.contains("is-expanded")) return;
    const bottom = Math.max(0, Math.round(stack.getBoundingClientRect().bottom));
    const backdrop = this.els.eventsFilterBackdrop;
    if (backdrop && !backdrop.hidden) backdrop.style.top = `${bottom}px`;
    const panel = this.els.eventsFilterPanel;
    if (panel) {
      const available = window.innerHeight - bottom - 8;
      panel.style.maxHeight = `${Math.max(140, Math.floor(available))}px`;
    }
  }

  setEventsFiltersExpanded(expanded) {
    const stack = this.els.eventsFilterStack;
    const toggle = this.els.eventsFilterToggle;
    const backdrop = this.els.eventsFilterBackdrop;
    if (!stack || !toggle) return;
    const open = Boolean(expanded);
    const wasOpen = stack.classList.contains("is-expanded");
    stack.classList.toggle("is-expanded", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const label = toggle.querySelector(".toolbar-filter-toggle-label");
    if (label) label.textContent = open ? "收起" : "篩選";
    this.syncEventsFilterToggleLabel(open);
    const panel = this.els.eventsFilterPanel;
    if (backdrop) {
      backdrop.hidden = !open;
      backdrop.classList.toggle("is-open", open);
    }
    if (open) {
      const bottom = Math.max(0, Math.round(stack.getBoundingClientRect().bottom));
      if (backdrop) backdrop.style.top = `${bottom}px`;
      if (panel) {
        const available = window.innerHeight - bottom - 8;
        panel.style.maxHeight = `${Math.max(140, Math.floor(available))}px`;
      }
    } else {
      if (backdrop) backdrop.style.top = "";
      if (panel) panel.style.maxHeight = "";
    }
    document.documentElement.classList.toggle("events-filters-open", open);
    if (wasOpen && !open) {
      const active = document.activeElement;
      if (panel?.contains(active) || active === backdrop || active === document.body) {
        toggle.focus({ preventScroll: true });
      }
    }
  }

  eventsCompactFilterParts() {
    const parts = [];
    if (this.filterDistrict !== "all") parts.push(this.filterDistrict);
    if (this.filterBand !== "all") {
      parts.push(this.filterBand === "未知" ? "未知／不適用" : this.bandLabel(this.filterBand));
    }
    if (this.filterFavoritesOnly && this.favorites.length > 0) {
      parts.push(`只看關注（${this.favorites.length}）`);
    }
    if (this.eventStatus !== "all") parts.push(this.eventStatus);
    if (this.eventSchool !== "all") parts.push(this.eventSchool);
    if (!this.showTerritoryEvents) parts.push("不顯示教育局／全港項目");
    return parts;
  }

  syncEventsFilterToggleLabel(open) {
    const toggle = this.els.eventsFilterToggle;
    if (!toggle) return;
    if (open) {
      toggle.setAttribute("aria-label", "收起篩選");
      return;
    }
    const parts = this.eventsCompactFilterParts();
    toggle.setAttribute(
      "aria-label",
      parts.length ? `展開篩選，目前：${parts.join("、")}` : "展開篩選"
    );
  }

  updateEventsFilterSummary() {
    const summary = this.els.eventsFilterSummary;
    const text = this.els.eventsFilterSummaryText;
    const parts = this.eventsCompactFilterParts();
    const active = parts.length > 0;
    this.els.eventsFilterStack?.classList.toggle("has-active-filters", active);
    this.els.eventsFilterToggle?.classList.toggle("has-active", active);
    const open = Boolean(this.els.eventsFilterStack?.classList.contains("is-expanded"));
    this.syncEventsFilterToggleLabel(open);
    if (!summary || !text) return;
    if (!active) {
      summary.hidden = true;
      text.textContent = "";
      return;
    }
    text.textContent = parts.join(" · ");
    summary.hidden = false;
  }

  /** Clear the 升中 panel filters. Shared district / band / favorites-only follow the school list. */
  clearEventsCompactFilters() {
    this.eventStatus = "all";
    this.eventSchool = "all";
    this.showTerritoryEvents = true;
    this.filterBand = "all";
    this.filterFavoritesOnly = false;
    this.syncChipGroup(this.els.eventsFilters, "eventStatus", "all");
    this.syncBandChips();
    this.syncFavoritesFilterChip();
    this.syncTerritoryToggle();
    this.setSharedDistrict("all");
    this.syncEventSchoolSelect();
    this.onListFiltersChanged();
  }

  bandLabel(band) {
    if (band === "1" || band === "2" || band === "3") return `民間 Band ${band}`;
    return "未知／不適用";
  }

  filteredSchools() {
    const district = this.effectiveFilterDistrict();
    const favOnly = this.filterFavoritesOnly && this.favorites.length > 0;
    const favSet = favOnly ? new Set(this.favorites) : null;
    return this.schools.filter((s) => {
      if (favSet && !favSet.has(s.nameZh)) return false;
      if (district !== "all" && s.district !== district) return false;
      if (this.filterType !== "all" && s.type !== this.filterType) return false;
      const band = s.band || "未知";
      if (this.filterBand !== "all" && band !== this.filterBand) return false;
      if (!this.query) return true;
      return this.schoolSearchText(s).includes(this.query);
    });
  }

  sortedFilteredSchools() {
    return this.filteredSchools().slice().sort((a, b) => {
      const di = districtSortIndex(a.district) - districtSortIndex(b.district);
      if (di !== 0) return di;
      const ti = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      if (ti !== 0) return ti;
      return a.nameZh.localeCompare(b.nameZh, "zh-Hant");
    });
  }

  loadMoreSchools() {
    this.visibleCount += this.pageSize;
    this.renderList();
  }

  updateListWindow(shownCount, total) {
    const status = this.els.listWindowStatus;
    const footer = this.els.listWindowFooter;
    const more = this.els.loadMore;
    const done = this.els.listWindowDone;
    if (!status || !footer) return;
    if (total <= 0) {
      status.hidden = true;
      status.textContent = "";
      footer.hidden = true;
      return;
    }
    status.hidden = false;
    status.textContent = `已載入 ${shownCount} / 符合 ${total}`;
    footer.hidden = false;
    const allShown = shownCount >= total;
    if (more) more.hidden = allShown;
    if (done) {
      done.textContent = `已顯示全部 ${total} 所`;
      done.hidden = !allShown;
    }
  }

  renderList() {
    const list = this.sortedFilteredSchools();
    const visible = list.slice(0, this.visibleCount);

    const district = this.effectiveFilterDistrict();
    const districtNote = district === "all" ? "" : ` · ${district}`;
    this.els.resultCount.textContent =
      `顯示 ${list.length} / ${this.schools.length} 所中學${districtNote}`;
    this.updateListFilterSummary();
    const isEmpty = list.length === 0;
    if (this.els.listEmpty) {
      this.els.listEmpty.hidden = !isEmpty;
      const body = this.els.listEmpty.querySelector(".empty-state-body");
      if (body) {
        const phrase = this.activeFilterPhrase(this.activeListFilters());
        body.textContent = phrase
          ? `目前篩選：${phrase}。沒有符合的學校，可清除篩選或改選條件。`
          : "試試放寬分區、類型、民間組別或搜尋字詞。";
      }
    }
    this.updateListWindow(visible.length, list.length);
    this.els.schoolList.replaceChildren();
    if (isEmpty) return;

    for (const school of visible) {
      const node = this.els.cardTemplate.content.cloneNode(true);
      const card = node.querySelector(".school-card");
      card.querySelector(".school-name").textContent = school.nameZh;
      card.querySelector(".school-name-en").textContent = school.nameEn;

      const band = school.band || "未知";
      const bandPill = card.querySelector(".band-pill");
      bandPill.textContent = this.bandLabel(band);
      bandPill.classList.add(`band-${band}`);

      const badges = card.querySelector(".badges");
      if (school.district) {
        const d = document.createElement("span");
        d.className = "badge";
        d.textContent = school.district;
        badges.append(d);
      }

      const typeBadge = document.createElement("span");
      typeBadge.className = `badge type-${school.type}`;
      typeBadge.textContent = school.type;
      badges.append(typeBadge);

      if (school.gender && school.gender !== "男女") {
        const g = document.createElement("span");
        g.className = "badge";
        g.textContent = school.gender === "女" ? "女校" : school.gender === "男" ? "男校" : school.gender;
        badges.append(g);
      }

      if (school.religion && school.religion !== "不適用") {
        const r = document.createElement("span");
        r.className = "badge";
        r.textContent = school.religion;
        badges.append(r);
      }

      const meta = card.querySelector(".school-meta");
      const rows = [
        ["分區", school.district || "—"],
        ["組別", `<strong title="民間參考組別，非官方評級">${escapeHtml(this.bandLabel(band))}</strong>`],
        ["地址", school.addressZh],
        ["電話", school.phone
          ? `<a href="tel:${normalizePhoneHref(school.phone)}">${escapeHtml(school.phone)}</a>`
          : "—"],
        ["網址", school.website
          ? `<a href="${escapeHtml(ensureUrl(school.website))}" target="_blank" rel="noopener noreferrer">${escapeHtml(school.website.replace(/^https?:\/\//i, ""))}</a>`
          : "—"],
      ];
      meta.innerHTML = rows
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
        .join("");

      const actions = card.querySelector(".school-actions");
      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "btn btn-secondary fav-toggle";
      const favOn = this.isFavorite(school.nameZh);
      favBtn.classList.toggle("is-favorited", favOn);
      favBtn.setAttribute("aria-pressed", favOn ? "true" : "false");
      favBtn.setAttribute(
        "aria-label",
        favOn ? `取消關注 ${school.nameZh}` : `關注 ${school.nameZh}`
      );
      favBtn.textContent = favOn ? "已關注" : "關注";
      favBtn.addEventListener("click", () => this.toggleFavorite(school.nameZh));
      actions.append(favBtn);

      const mapBtn = document.createElement("button");
      mapBtn.type = "button";
      mapBtn.className = "btn btn-primary";
      mapBtn.textContent = "在地圖查看";
      mapBtn.addEventListener("click", () => this.showSchoolOnMap(school.id));
      actions.append(mapBtn);

      this.els.schoolList.append(node);
    }
  }

  whenMapHasSize(done) {
    const attempt = (left = 40) => {
      const { w, h } = this.mapContainerSize();
      if (w < 32 || h < 32) {
        if (left > 0) requestAnimationFrame(() => attempt(left - 1));
        return;
      }
      done();
    };
    requestAnimationFrame(() => attempt());
  }

  ensureMap() {
    if (this.mapReady) {
      this.whenMapHasSize(() => {
        if (!this.map) return;
        this.map.invalidateSize({ animate: false });
        if (this._refitWhenShown && this.markers.size) {
          this._refitWhenShown = false;
          this.refreshMapLayout({ refit: true });
        }
        // Cluster children are only attached inside the last shown bounds.
        this.map.fire("moveend");
      });
      return;
    }
    if (typeof L === "undefined") {
      if (this.els.selectedPointPrimary) {
        this.els.selectedPointPrimary.textContent = "地圖程式庫載入失敗，請檢查網路連線後重新整理。";
      }
      return;
    }

    // Never create the map while the tab is display:none / size 0 — Leaflet
    // then places markers at bogus pixel positions that invalidateSize alone
    // does not fix (tiles may still appear after a later invalidateSize).
    const { w, h } = this.mapContainerSize();
    if (w < 32 || h < 32) {
      if (!this._mapInitRetries) this._mapInitRetries = 0;
      if (this._mapInitRetries++ < 40) {
        requestAnimationFrame(() => this.ensureMap());
      } else {
        if (this.els.selectedPointPrimary) {
          this.els.selectedPointPrimary.textContent = "地圖容器尚未就緒，請再按一次「地圖與距離」。";
        }
      }
      return;
    }
    this._mapInitRetries = 0;

    // Hong Kong territory overview; fitBounds to visible schools follows.
    this.map = L.map(this.els.map, {
      zoomControl: true,
      attributionControl: true,
    }).setView([22.35, 114.15], 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.markerLayer = this.createMarkerLayer().addTo(this.map);
    this.addSchoolMarkers({ refit: true });

    this.map.on("click", (e) => {
      this.setSelectedPoint(e.latlng.lat, e.latlng.lng);
    });

    this.mapReady = true;
    this.map.invalidateSize({ animate: false });
    // After tab fade-in, only invalidateSize — do not re-fitBounds (would undo
    // deep-links / 「在地圖查看」 zoom).
    setTimeout(() => {
      if (this.map) this.map.invalidateSize({ animate: false });
    }, 80);
    setTimeout(() => {
      if (this.map) this.map.invalidateSize({ animate: false });
    }, 320);

    if (typeof ResizeObserver !== "undefined" && !this._mapResizeObserver) {
      this._mapResizeObserver = new ResizeObserver(() => {
        if (this.mapReady) this.map.invalidateSize({ animate: false });
      });
      this._mapResizeObserver.observe(this.els.map);
    }
  }

  createMarkerLayer() {
    if (typeof L.markerClusterGroup === "function") {
      const group = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
      });
      group.on("clusterclick", (event) => {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      });
      return group;
    }
    return L.layerGroup();
  }

  popupOptions() {
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    return {
      maxWidth: narrow ? 220 : 260,
      minWidth: narrow ? 140 : 180,
      className: "school-popup",
      autoPan: true,
      keepInView: true,
      closeButton: true,
      autoPanPaddingTopLeft: [12, 12],
      autoPanPaddingBottomRight: [12, 28],
    };
  }

  refreshClusterIcons() {
    if (this.markerLayer && typeof this.markerLayer.refreshClusters === "function") {
      this.markerLayer.refreshClusters();
    }
  }

  /** Open a school marker, unclustering via zoomToShowLayer when the plugin is present. */
  focusSchoolMarker(schoolId) {
    const school = this.markerMeta.get(schoolId) || this.schools.find((s) => s.id === schoolId);
    const marker = this.markers.get(schoolId);
    if (!this.map || !school) return;
    const open = () => {
      if (!marker) return;
      this.wireMarkerLogo(marker, school);
      marker.openPopup();
    };
    if (marker && this.markerLayer && typeof this.markerLayer.zoomToShowLayer === "function") {
      this.markerLayer.zoomToShowLayer(marker, open);
      return;
    }
    this.map.setView([school.lat, school.lng], 16, { animate: true });
    open();
  }

  refreshMapLayout({ refit = false } = {}) {
    if (!this.map) return;
    this.map.invalidateSize({ animate: false });
    if (refit && this.markers.size) {
      const bounds = [];
      for (const marker of this.markers.values()) {
        bounds.push(marker.getLatLng());
      }
      if (bounds.length) {
        this.map.fitBounds(bounds, { padding: [28, 28], animate: false });
      }
    }
  }

  schoolIcon(school, isNearest = false) {
    const band = school.band || "未知";
    const initials = escapeHtml(school.initials || school.nameZh.slice(0, 2));
    const nearestClass = isNearest ? " is-nearest" : "";
    // Always paint a coloured initials badge first so markers stay visible
    // even when favicons are blocked, slow, or blank. Logo is optional overlay.
    let logo = "";
    if (school.logoDomain && !this.failedLogoDomains.has(school.logoDomain)) {
      const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(school.logoDomain)}&sz=64`;
      logo = `<img class="marker-logo" src="${escapeHtml(favicon)}" alt="" decoding="async" referrerpolicy="no-referrer" hidden />`;
    }
    return L.divIcon({
      className: "school-marker leaflet-div-icon",
      html: `<div class="marker-badge band-${band}${nearestClass}" aria-label="${escapeHtml(school.nameZh)}"><span class="marker-initials">${initials}</span>${logo}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      tooltipAnchor: [0, -18],
    });
  }

  userIcon() {
    // Omit leaflet-div-icon so Leaflet's default white square never applies.
    // Inline SVG teardrop stays visible even if DivIcon chrome styles leak in.
    const pinSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">` +
      `<path fill="#b23b2d" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" ` +
      `d="M14 2.5c-5.8 0-10.5 4.7-10.5 10.5 0 7.4 10.5 20 10.5 20s10.5-12.6 10.5-20C24.5 7.2 19.8 2.5 14 2.5z"/>` +
      `<circle cx="14" cy="12.5" r="3.6" fill="#ffffff"/>` +
      `</svg>`;
    return L.divIcon({
      className: "user-marker",
      html: `<span class="marker-pin">${pinSvg}</span>`,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -32],
    });
  }

  wireMarkerLogo(marker, school) {
    const el = marker.getElement();
    if (!el || !school?.logoDomain) return;
    const img = el.querySelector("img.marker-logo");
    if (!img || img.dataset.logoWired === "1") return;
    img.dataset.logoWired = "1";
    const dropLogo = () => {
      this.failedLogoDomains.add(school.logoDomain);
      img.removeAttribute("src");
      img.remove();
      const nearest = Boolean(el.querySelector(".marker-badge")?.classList.contains("is-nearest"));
      // Rebuild without the image so cluster redraws do not request it again.
      requestAnimationFrame(() => {
        if (!this.markers.has(school.id) || !this.failedLogoDomains.has(school.logoDomain)) return;
        marker.setIcon(this.schoolIcon(school, nearest));
      });
    };
    const showLogo = () => {
      // Tiny / broken placeholders stay hidden so initials remain visible.
      if (!img.naturalWidth || img.naturalWidth < 12) {
        dropLogo();
        return;
      }
      img.hidden = false;
      el.querySelector(".marker-badge")?.classList.add("has-logo");
    };
    if (img.complete) {
      if (img.naturalWidth === 0) dropLogo();
      else showLogo();
      return;
    }
    img.addEventListener("load", showLogo, { once: true });
    img.addEventListener("error", dropLogo, { once: true });
  }

  addSchoolMarkers({ refit = true } = {}) {
    if (!this.markerLayer || !this.map) return;
    this.markerLayer.clearLayers();
    this.markers.clear();
    this.markerMeta.clear();
    const bounds = [];
    const visible = this.filteredSchools();

    for (const school of visible) {
      if (school.lat == null || school.lng == null) continue;
      const marker = L.marker([school.lat, school.lng], {
        icon: this.schoolIcon(school, false),
        title: school.nameZh,
        keyboard: true,
        riseOnHover: true,
      });
      marker.bindTooltip(school.nameZh, {
        direction: "top",
        offset: [0, -12],
        opacity: 0.95,
        className: "school-tooltip",
        sticky: false,
      });
      const districtBit = school.district ? `${escapeHtml(school.district)} · ` : "";
      marker.bindPopup(
        `<p class="popup-title">${escapeHtml(school.nameZh)}</p>
         <p class="popup-meta">${districtBit}${escapeHtml(this.bandLabel(school.band || "未知"))} · ${escapeHtml(school.type)} · ${escapeHtml(school.addressZh)}</p>`,
        this.popupOptions()
      );
      // Touch: first tap shows name tooltip; second opens popup via Leaflet defaults
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        marker.openTooltip();
      });
      marker.on("add", () => this.wireMarkerLogo(marker, school));
      marker.addTo(this.markerLayer);
      this.markers.set(school.id, marker);
      this.markerMeta.set(school.id, school);
      bounds.push([school.lat, school.lng]);
    }

    if (refit && bounds.length) {
      this.map.fitBounds(bounds, { padding: [28, 28], animate: false, maxZoom: 14 });
    }
  }

  setSelectedPoint(lat, lng) {
    this.selectedLatLng = { lat, lng };
    this.els.mapHint.classList.add("is-hidden");
    this.els.clearPoint.hidden = false;
    this.els.selectedPoint.classList.add("is-set");
    if (this.els.selectedPointPrimary) {
      this.els.selectedPointPrimary.textContent = "已選參考點";
    }
    if (this.els.selectedPointCoords) {
      this.els.selectedPointCoords.hidden = false;
      this.els.selectedPointCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
    } else {
      this.userMarker = L.marker([lat, lng], {
        icon: this.userIcon(),
        zIndexOffset: 1000,
        title: "選取位置",
      }).addTo(this.map);
      this.userMarker.bindPopup("已選參考點", this.popupOptions()).openPopup();
    }

    this.renderDistances();
  }

  clearSelectedPoint() {
    this.selectedLatLng = null;
    if (this.userMarker) {
      this.map.removeLayer(this.userMarker);
      this.userMarker = null;
    }
    this.els.clearPoint.hidden = true;
    this.els.selectedPoint.classList.remove("is-set");
    if (this.els.selectedPointPrimary) {
      this.els.selectedPointPrimary.textContent = "尚未選點。請在地圖上點選參考位置。";
    }
    if (this.els.selectedPointCoords) {
      this.els.selectedPointCoords.hidden = true;
      this.els.selectedPointCoords.textContent = "";
    }
    if (this.els.distanceEmpty) this.els.distanceEmpty.hidden = true;
    if (this.els.distanceList) this.els.distanceList.hidden = false;
    this.els.distanceList.replaceChildren();
    const noSchools = this.schools.length > 0 && this.filteredSchools().length === 0;
    this.els.mapHint.classList.toggle("is-hidden", noSchools);
    for (const [id, marker] of this.markers) {
      const school = this.markerMeta.get(id);
      if (school) {
        marker.setIcon(this.schoolIcon(school, false));
        this.wireMarkerLogo(marker, school);
      }
    }
    this.refreshClusterIcons();
  }

  renderDistances() {
    if (!this.selectedLatLng) return;
    const { lat, lng } = this.selectedLatLng;
    const pool = this.filteredSchools();

    const ranked = pool
      .map((s) => ({
        school: s,
        meters: haversineMeters(lat, lng, s.lat, s.lng),
      }))
      .sort((a, b) => a.meters - b.meters);

    const shown = ranked.slice(0, DISTANCE_LIST_LIMIT);
    this.els.distanceList.replaceChildren();

    if (!ranked.length) {
      if (this.els.distanceEmpty) {
        this.els.distanceEmpty.hidden = false;
        const body = this.els.distanceEmpty.querySelector(".empty-state-body");
        if (body) {
          const phrase = this.activeFilterPhrase(this.activeListFilters());
          body.textContent = phrase
            ? `目前篩選：${phrase}。沒有學校可比較直線距離。`
            : "目前沒有學校。清除篩選後可再看直線距離（非交通時間／非行車路線）。";
        }
      }
      this.els.distanceList.hidden = true;
      return;
    }
    if (this.els.distanceEmpty) this.els.distanceEmpty.hidden = true;
    this.els.distanceList.hidden = false;

    shown.forEach((item, index) => {
      const li = document.createElement("li");
      const districtBit = item.school.district
        ? `${escapeHtml(item.school.district)} · `
        : "";
      li.innerHTML = `
        <span class="distance-rank">${index + 1}</span>
        <span>
          <span class="distance-name">${escapeHtml(item.school.nameZh)}</span>
          <span class="distance-meta">${districtBit}${escapeHtml(this.bandLabel(item.school.band || "未知"))} · ${escapeHtml(item.school.type)}</span>
        </span>
        <span class="distance-value">${formatDistance(item.meters)}</span>
      `;
      li.addEventListener("click", () => {
        this.focusSchoolMarker(item.school.id);
      });
      this.els.distanceList.append(li);
    });

    if (ranked.length > DISTANCE_LIST_LIMIT) {
      const more = document.createElement("li");
      more.className = "distance-more";
      more.textContent = `僅顯示最近 ${DISTANCE_LIST_LIMIT} 所（篩選後共 ${ranked.length} 所）。可改分區篩選收窄範圍。`;
      this.els.distanceList.append(more);
    }

    const nearestId = ranked[0]?.school.id;
    for (const [id, marker] of this.markers) {
      const school = this.markerMeta.get(id);
      if (school) {
        marker.setIcon(this.schoolIcon(school, id === nearestId));
        this.wireMarkerLogo(marker, school);
      }
    }
    this.refreshClusterIcons();
  }

  showSchoolOnMap(schoolId) {
    const school = this.schools.find((s) => s.id === schoolId);
    if (!school) return;

    // If the school is filtered out, clear filters so the marker exists.
    if (!this.filteredSchools().some((s) => s.id === schoolId)) {
      this.clearAllFilters();
    }

    // A deferred overview fit would undo zoomToShowLayer after the tab opens.
    this._refitWhenShown = false;
    // Activate tab first; ensureMap waits for non-zero container size.
    this.els.tabMap.click();
    this.ensureMap();

    const open = () => {
      if (!this.mapReady) {
        requestAnimationFrame(open);
        return;
      }
      this.whenMapHasSize(() => {
        if (!this.markers.has(schoolId)) {
          this.addSchoolMarkers({ refit: false });
        }
        this.refreshMapLayout({ refit: false });
        this.focusSchoolMarker(schoolId);
      });
    };
    open();
  }
}
