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

function formatHongKongDateRange(start, end, isDateTime) {
  if (!start) return "日期待定";
  const optsDate = { timeZone: "Asia/Hong_Kong", year: "numeric", month: "numeric", day: "numeric" };
  const optsTime = { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false };

  if (!isDateTime) {
    const startLabel = new Date(`${start}T12:00:00+08:00`).toLocaleDateString("zh-HK", optsDate);
    if (!end || end === start) return startLabel;
    const endLabel = new Date(`${end}T12:00:00+08:00`).toLocaleDateString("zh-HK", optsDate);
    return `${startLabel} – ${endLabel}`;
  }

  const s = new Date(start);
  const startDate = s.toLocaleDateString("zh-HK", optsDate);
  const startTime = s.toLocaleTimeString("zh-HK", optsTime);
  if (!end) return `${startDate} ${startTime}`;
  const e = new Date(end);
  const endDate = e.toLocaleDateString("zh-HK", optsDate);
  const endTime = e.toLocaleTimeString("zh-HK", optsTime);
  if (startDate === endDate) return `${startDate}\n${startTime}–${endTime}`;
  return `${startDate} ${startTime}\n– ${endDate} ${endTime}`;
}

class App {
  constructor() {
    this.schools = [];
    this.eventsPayload = null;
    this.filterType = "all";
    this.filterBand = "all";
    this.filterDistrict = "all";
    this.eventStatus = "all";
    this.eventBand = "all";
    this.eventDistrict = "all";
    this.eventSchool = "all";
    this.schoolBandByName = new Map();
    this.schoolDistrictByName = new Map();
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

    this.els = {
      tabList: document.getElementById("tab-list"),
      tabEvents: document.getElementById("tab-events"),
      tabMap: document.getElementById("tab-map"),
      panelList: document.getElementById("panel-list"),
      panelEvents: document.getElementById("panel-events"),
      panelMap: document.getElementById("panel-map"),
      search: document.getElementById("search"),
      filters: document.querySelector(".filters"),
      bandFilters: document.querySelector(".band-filters"),
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

  init() {
    this.deepLink = readDeepLink();
    this.bindTabs();
    this.bindListControls();
    this.bindEventFilters();
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
      this.schoolBandByName = new Map(
        schools.map((s) => [s.nameZh, s.band || "未知"])
      );
      this.schoolDistrictByName = new Map(
        schools.map((s) => [s.nameZh, s.district])
      );
      this.populateDistrictFilter();
      this.renderList();
    }
    this.populateEventDistrictFilter();

    this.loadEvents();
    this.applyDeepLinkTab();
  }

  applyDeepLinkTab() {
    const link = this.deepLink;
    if (!link) return;
    const tab = link.tab || (link.status || link.band || link.school ? "events" : null);
    if (tab === "events") this.els.tabEvents.click();
    else if (tab === "map") this.els.tabMap.click();
  }

  applyEventDeepLink() {
    const link = this.deepLink;
    if (!link || link.eventsApplied) return;
    link.eventsApplied = true;
    if (link.status) {
      this.eventStatus = link.status;
      this.syncChipGroup(this.els.eventsFilters, "eventStatus", this.eventStatus);
    }
    if (link.band) {
      this.eventBand = link.band;
      this.syncChipGroup(this.els.eventsBandFilters, "eventBand", this.eventBand);
    }
    if (link.school) {
      const resolved = this.resolveEventSchool(link.school);
      if (resolved) this.eventSchool = resolved;
    }
  }

  /** Match a decoded 升中 school param to a loaded event school, or the territory bucket. */
  resolveEventSchool(raw) {
    const name = decodeUrlParam(raw);
    if (!name || name === "all" || name === "全部") return "all";
    if (name === "__territory__" || name === "全港／教育局" || name === "全港/教育局") {
      return "__territory__";
    }
    const names = new Set();
    for (const ev of this.eventsPayload?.events || []) {
      for (const school of ev.schools || []) {
        if (school) names.add(school);
      }
    }
    if (names.has(name)) return name;
    for (const school of names) {
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
    select.value = this.filterDistrict;
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
      if (this.els.eventsTitle && payload.title) {
        this.els.eventsTitle.textContent = payload.title;
      }
      this.applyEventDeepLink();
      this.populateEventSchoolFilter();
      this.renderEvents();
    } catch (err) {
      this.showEventsLoadError();
    }
  }

  /** Unique school names from loaded events, plus 全部 / 全港／教育局. */
  populateEventSchoolFilter() {
    const select = this.els.eventsSchoolSelect;
    if (!select || !this.eventsPayload?.events) return;

    const names = new Set();
    for (const ev of this.eventsPayload.events) {
      for (const school of ev.schools || []) {
        if (school) names.add(school);
      }
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "zh-Hant"));

    const previous = this.eventSchool;
    select.replaceChildren();

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "全部";
    select.append(allOpt);

    const territoryOpt = document.createElement("option");
    territoryOpt.value = "__territory__";
    territoryOpt.textContent = "全港／教育局";
    select.append(territoryOpt);

    for (const name of sorted) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.append(opt);
    }

    const stillValid =
      previous === "all" ||
      previous === "__territory__" ||
      previous === "__district__" ||
      names.has(previous);
    this.eventSchool =
      previous === "__district__" ? "__territory__" : stillValid ? previous : "all";
    select.value = this.eventSchool;
  }

  /** 全部十八區, each DISTRICT_ORDER district, then 全港／教育局. */
  populateEventDistrictFilter() {
    const select = this.els.eventsDistrictSelect;
    if (!select) return;

    const previous = this.eventDistrict;
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

    const territoryOpt = document.createElement("option");
    territoryOpt.value = "__territory__";
    territoryOpt.textContent = "全港／教育局";
    select.append(territoryOpt);

    const allowed = new Set(["all", "__territory__", ...DISTRICT_ORDER]);
    this.eventDistrict = allowed.has(previous) ? previous : "all";
    select.value = this.eventDistrict;
  }

  bindTabs() {
    const panels = {
      list: this.els.panelList,
      events: this.els.panelEvents,
      map: this.els.panelMap,
    };
    const tabs = {
      list: this.els.tabList,
      events: this.els.tabEvents,
      map: this.els.tabMap,
    };

    const activate = (name) => {
      for (const [key, panel] of Object.entries(panels)) {
        const on = key === name;
        panel.classList.toggle("is-active", on);
        panel.hidden = !on;
        tabs[key].classList.toggle("is-active", on);
        tabs[key].setAttribute("aria-selected", String(on));
      }
      if (name === "map") {
        // Wait until the tab panel is laid out (display:none → visible).
        // One rAF is not always enough; ensureMap retries until size > 0.
        requestAnimationFrame(() => this.ensureMap());
      }
    };

    this.els.tabList.addEventListener("click", () => activate("list"));
    this.els.tabEvents.addEventListener("click", () => activate("events"));
    this.els.tabMap.addEventListener("click", () => activate("map"));
  }

  mapContainerSize() {
    const el = this.els.map;
    if (!el) return { w: 0, h: 0 };
    return { w: el.clientWidth || 0, h: el.clientHeight || 0 };
  }

  bindEventFilters() {
    if (this.els.eventsFilters) {
      this.els.eventsFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-event-status]");
        if (!btn) return;
        this.eventStatus = btn.dataset.eventStatus;
        this.syncChipGroup(this.els.eventsFilters, "eventStatus", this.eventStatus);
        this.renderEvents();
      });
    }
    if (this.els.eventsBandFilters) {
      this.els.eventsBandFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-event-band]");
        if (!btn) return;
        this.eventBand = btn.dataset.eventBand;
        this.syncChipGroup(this.els.eventsBandFilters, "eventBand", this.eventBand);
        this.renderEvents();
      });
    }
    if (this.els.eventsDistrictSelect) {
      this.els.eventsDistrictSelect.addEventListener("change", () => {
        this.eventDistrict = this.els.eventsDistrictSelect.value || "all";
        this.renderEvents();
      });
    }
    if (this.els.eventsSchoolSelect) {
      this.els.eventsSchoolSelect.addEventListener("change", () => {
        this.eventSchool = this.els.eventsSchoolSelect.value || "all";
        this.renderEvents();
      });
    }
  }

  eventMatchesSchoolFilter(ev) {
    if (this.eventSchool === "all") return true;
    const schools = Array.isArray(ev.schools) ? ev.schools : [];
    if (
      this.eventSchool === "__territory__" ||
      this.eventSchool === "__district__"
    ) {
      return schools.length === 0;
    }
    return schools.includes(this.eventSchool);
  }

  /**
   * District from the school list via exact nameZh.
   * A named district needs at least one matching school; empty schools match only 全港／教育局.
   */
  eventMatchesDistrictFilter(ev) {
    if (this.eventDistrict === "all") return true;
    const schools = Array.isArray(ev.schools) ? ev.schools : [];
    if (this.eventDistrict === "__territory__") return schools.length === 0;
    if (!schools.length) return false;
    return schools.some(
      (name) => this.schoolDistrictByName.get(name) === this.eventDistrict
    );
  }

  /** Band from school list; unknown names count as 未知. Empty schools → no band. */
  eventMatchesBandFilter(ev) {
    if (this.eventBand === "all") return true;
    const schools = Array.isArray(ev.schools) ? ev.schools : [];
    if (!schools.length) return false;
    return schools.some((name) => {
      const band = this.schoolBandByName.get(name) || "未知";
      return band === this.eventBand;
    });
  }

  clearEventFilters() {
    this.eventStatus = "all";
    this.eventBand = "all";
    this.eventDistrict = "all";
    this.eventSchool = "all";
    this.syncChipGroup(this.els.eventsFilters, "eventStatus", "all");
    this.syncChipGroup(this.els.eventsBandFilters, "eventBand", "all");
    if (this.els.eventsDistrictSelect) this.els.eventsDistrictSelect.value = "all";
    if (this.els.eventsSchoolSelect) this.els.eventsSchoolSelect.value = "all";
    this.renderEvents();
  }

  renderEvents() {
    if (!this.eventsPayload?.events) return;
    const total = this.eventsPayload.events.length;
    const list = this.eventsPayload.events.filter((ev) => {
      if (this.eventStatus !== "all" && ev.status !== this.eventStatus) {
        return false;
      }
      if (!this.eventMatchesBandFilter(ev)) return false;
      if (!this.eventMatchesDistrictFilter(ev)) return false;
      return this.eventMatchesSchoolFilter(ev);
    });

    if (this.els.eventsMeta) {
      this.els.eventsMeta.textContent = `顯示 ${list.length} / ${total} 項`;
    }

    this.els.eventsList.replaceChildren();
    const isEmpty = list.length === 0;
    if (this.els.eventsEmpty) {
      this.els.eventsEmpty.hidden = !isEmpty;
      const body = this.els.eventsEmpty.querySelector(".empty-state-body");
      if (body) {
        body.textContent =
          "呢個條件暫時冇項目。可試其他篩選，或稍後再睇（資料持續更新）。";
      }
    }
    if (isEmpty) return;

    for (const ev of list) {
      const card = document.createElement("article");
      card.className = "event-card";

      const when = document.createElement("div");
      when.className = "event-when";
      when.textContent = formatHongKongDateRange(ev.dateStart, ev.dateEnd, ev.isDateTime);
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
      if (ev.schools?.length) {
        for (const school of ev.schools) {
          const s = document.createElement("span");
          s.className = "badge";
          s.textContent = decodeVisiblePercent(school);
          badges.append(s);
        }
      }
      body.append(badges);

      if (ev.notes) {
        const notes = document.createElement("p");
        notes.textContent = decodeVisiblePercent(ev.notes);
        body.append(notes);
      }

      if (ev.sourceUrl) {
        const href = ensureUrl(decodeHrefPercent(ev.sourceUrl));
        const links = document.createElement("p");
        const anchor = document.createElement("a");
        anchor.setAttribute("href", href);
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = eventSourceLabel(ev, ev.sourceUrl);
        links.append(anchor);
        body.append(links);
      }

      card.append(when, body);
      this.els.eventsList.append(card);
    }
  }

  onListFiltersChanged() {
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
  }

  syncChipGroup(container, datasetKey, value) {
    if (!container) return;
    container.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset[datasetKey] === value);
    });
  }

  /** Reset school-list filters. Map reads the same state via onListFiltersChanged. */
  clearAllFilters() {
    this.filterDistrict = "all";
    this.filterType = "all";
    this.filterBand = "all";
    this.query = "";
    if (this.els.districtSelect) this.els.districtSelect.value = "all";
    if (this.els.search) this.els.search.value = "";
    this.syncChipGroup(this.els.filters, "type", "all");
    this.syncChipGroup(this.els.bandFilters, "band", "all");
    this.onListFiltersChanged();
  }

  removeListFilter(key) {
    if (key === "district") {
      this.filterDistrict = "all";
      if (this.els.districtSelect) this.els.districtSelect.value = "all";
    } else if (key === "type") {
      this.filterType = "all";
      this.syncChipGroup(this.els.filters, "type", "all");
    } else if (key === "band") {
      this.filterBand = "all";
      this.syncChipGroup(this.els.bandFilters, "band", "all");
    } else if (key === "query") {
      this.query = "";
      if (this.els.search) this.els.search.value = "";
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
    if (this.filterDistrict !== "all") {
      items.push({ key: "district", label: `分區：${this.filterDistrict}` });
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
    });

    if (this.els.bandFilters) {
      this.els.bandFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-band]");
        if (!btn) return;
        this.filterBand = btn.dataset.band;
        this.syncChipGroup(this.els.bandFilters, "band", this.filterBand);
        this.onListFiltersChanged();
      });
    }

    if (this.els.districtSelect) {
      this.els.districtSelect.addEventListener("change", () => {
        this.filterDistrict = this.els.districtSelect.value || "all";
        this.onListFiltersChanged();
      });
    }
  }

  bandLabel(band) {
    if (band === "1" || band === "2" || band === "3") return `民間 Band ${band}`;
    return "未知／不適用";
  }

  filteredSchools() {
    return this.schools.filter((s) => {
      if (this.filterDistrict !== "all" && s.district !== this.filterDistrict) {
        return false;
      }
      if (this.filterType !== "all" && s.type !== this.filterType) return false;
      const band = s.band || "未知";
      if (this.filterBand !== "all" && band !== this.filterBand) return false;
      if (!this.query) return true;
      const hay = [
        s.nameZh,
        s.nameEn,
        s.district || "",
        s.addressZh,
        s.addressEn,
        s.type,
        s.religion,
        s.gender,
        s.bandNote || "",
        this.bandLabel(band),
        // Keep the shorter alias searchable after the 民間 prefix.
        band === "1" || band === "2" || band === "3" ? `Band ${band}` : "",
        s.phone,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(this.query);
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

    const districtNote =
      this.filterDistrict === "all" ? "" : ` · ${this.filterDistrict}`;
    this.els.resultCount.textContent =
      `顯示 ${list.length} / ${this.schools.length} 所中學${districtNote}`;
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

const app = new App();
app.init();
