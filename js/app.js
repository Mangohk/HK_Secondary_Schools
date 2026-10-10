const TYPE_ORDER = ["官立", "資助", "直資", "私立"];

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
  if (meters < 1000) {
    return `${Math.round(meters)} 米`;
  }
  if (meters < 10000) {
    return `${(meters / 1000).toFixed(2)} 公里`;
  }
  return `${(meters / 1000).toFixed(1)} 公里`;
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
    this.eventStatus = "all";
    this.eventBand = "all";
    this.eventSchool = "all";
    this.schoolBandByName = new Map();
    this.query = "";
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
      resultCount: document.getElementById("result-count"),
      schoolList: document.getElementById("school-list"),
      eventsList: document.getElementById("events-list"),
      eventsTitle: document.getElementById("events-title"),
      eventsMeta: document.getElementById("events-meta"),
      eventsFilters: document.querySelector(".events-filters"),
      eventsBandFilters: document.querySelector(".events-band-filters"),
      eventsSchoolSelect: document.getElementById("events-school-select"),
      map: document.getElementById("map"),
      mapHint: document.getElementById("map-hint"),
      selectedPoint: document.getElementById("selected-point"),
      distanceList: document.getElementById("distance-list"),
      clearPoint: document.getElementById("clear-point"),
      cardTemplate: document.getElementById("school-card-template"),
    };
  }

  init() {
    this.bindTabs();
    this.bindListControls();
    this.bindEventFilters();
    this.els.clearPoint.addEventListener("click", () => this.clearSelectedPoint());

    const schools = window.SHATIN_SCHOOLS;
    if (!Array.isArray(schools) || !schools.length) {
      this.els.schoolList.innerHTML =
        `<p class="sources">載入失敗：找不到內嵌學校資料。請確認已載入 <code>data/schools-data.js</code>。</p>`;
    } else {
      this.schools = schools;
      this.schoolBandByName = new Map(
        schools.map((s) => [s.nameZh, s.band || "未知"])
      );
      this.renderList();
    }

    this.loadEvents();
  }

  eventsJsonUrl() {
    return new URL("data/events.json", window.location.href).href;
  }

  showEventsLoadError() {
    this.eventsPayload = null;
    this.els.eventsMeta.textContent = "載入失敗";
    this.els.eventsList.innerHTML =
      `<p class="events-error" role="alert">無法載入升中項目（<code>data/events.json</code>）。請用 HTTP 開啟本站（GitHub Pages 或本機靜態伺服器）；直接雙擊 <code>index.html</code> 時，瀏覽器在 file:// 下通常無法讀取本地 JSON。</p>`;
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
      this.els.eventsMeta.textContent =
        `data/events.json · 共 ${payload.events.length} 項（請以學校／教育局官網核實）`;
      this.populateEventSchoolFilter();
      this.renderEvents();
    } catch (err) {
      this.showEventsLoadError();
    }
  }

  /** Unique school names from loaded events, plus 全部 / 全區／教育局. */
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

    const districtOpt = document.createElement("option");
    districtOpt.value = "__district__";
    districtOpt.textContent = "全區／教育局";
    select.append(districtOpt);

    for (const name of sorted) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.append(opt);
    }

    const stillValid =
      previous === "all" ||
      previous === "__district__" ||
      names.has(previous);
    this.eventSchool = stillValid ? previous : "all";
    select.value = this.eventSchool;
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
        this.els.eventsFilters.querySelectorAll(".chip").forEach((chip) => {
          chip.classList.toggle("is-active", chip === btn);
        });
        this.renderEvents();
      });
    }
    if (this.els.eventsBandFilters) {
      this.els.eventsBandFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-event-band]");
        if (!btn) return;
        this.eventBand = btn.dataset.eventBand;
        this.els.eventsBandFilters.querySelectorAll(".chip").forEach((chip) => {
          chip.classList.toggle("is-active", chip === btn);
        });
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
    if (this.eventSchool === "__district__") {
      return schools.length === 0;
    }
    return schools.includes(this.eventSchool);
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

  renderEvents() {
    if (!this.eventsPayload?.events) return;
    const list = this.eventsPayload.events.filter((ev) => {
      if (this.eventStatus !== "all" && ev.status !== this.eventStatus) {
        return false;
      }
      if (!this.eventMatchesBandFilter(ev)) return false;
      return this.eventMatchesSchoolFilter(ev);
    });

    this.els.eventsList.replaceChildren();
    if (!list.length) {
      this.els.eventsList.innerHTML = `<p class="sources">此篩選條件下沒有項目。</p>`;
      return;
    }

    for (const ev of list) {
      const card = document.createElement("article");
      card.className = "event-card";

      const when = document.createElement("div");
      when.className = "event-when";
      when.textContent = formatHongKongDateRange(ev.dateStart, ev.dateEnd, ev.isDateTime);
      if (ev.keyPoints) {
        const key = document.createElement("small");
        key.textContent = `關鍵：${ev.keyPoints}`;
        when.append(key);
      }

      const body = document.createElement("div");
      body.className = "event-body";
      const title = document.createElement("h3");
      title.textContent = ev.title;
      body.append(title);

      const badges = document.createElement("div");
      badges.className = "badges";
      const typeBadge = document.createElement("span");
      typeBadge.className = `badge type-${ev.type}`;
      typeBadge.textContent = ev.type;
      badges.append(typeBadge);
      const statusBadge = document.createElement("span");
      statusBadge.className = `badge status-${ev.status}`;
      statusBadge.textContent = ev.status;
      badges.append(statusBadge);
      if (ev.schools?.length) {
        for (const school of ev.schools) {
          const s = document.createElement("span");
          s.className = "badge";
          s.textContent = school;
          badges.append(s);
        }
      }
      body.append(badges);

      if (ev.notes) {
        const notes = document.createElement("p");
        notes.textContent = ev.notes;
        body.append(notes);
      }

      if (ev.sourceUrl) {
        const links = document.createElement("p");
        links.innerHTML = `<a href="${escapeHtml(ensureUrl(ev.sourceUrl))}" target="_blank" rel="noopener noreferrer">來源</a>`;
        body.append(links);
      }

      card.append(when, body);
      this.els.eventsList.append(card);
    }
  }

  bindListControls() {
    this.els.search.addEventListener("input", (e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.renderList();
    });

    this.els.filters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-type]");
      if (!btn) return;
      this.filterType = btn.dataset.type;
      this.els.filters.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("is-active", chip === btn);
      });
      this.renderList();
    });

    if (this.els.bandFilters) {
      this.els.bandFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-band]");
        if (!btn) return;
        this.filterBand = btn.dataset.band;
        this.els.bandFilters.querySelectorAll(".chip").forEach((chip) => {
          chip.classList.toggle("is-active", chip === btn);
        });
        this.renderList();
      });
    }
  }

  bandLabel(band) {
    if (band === "1" || band === "2" || band === "3") return `Band ${band}`;
    return "未知／不適用";
  }

  filteredSchools() {
    return this.schools.filter((s) => {
      if (this.filterType !== "all" && s.type !== this.filterType) return false;
      const band = s.band || "未知";
      if (this.filterBand !== "all" && band !== this.filterBand) return false;
      if (!this.query) return true;
      const hay = [
        s.nameZh,
        s.nameEn,
        s.addressZh,
        s.addressEn,
        s.type,
        s.religion,
        s.gender,
        s.bandNote || "",
        this.bandLabel(band),
        s.phone,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(this.query);
    });
  }

  renderList() {
    const bandOrder = { "1": 0, "2": 1, "3": 2, "未知": 3 };
    const list = this.filteredSchools().slice().sort((a, b) => {
      const bi = (bandOrder[a.band] ?? 9) - (bandOrder[b.band] ?? 9);
      if (bi !== 0) return bi;
      const ti = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      if (ti !== 0) return ti;
      return a.nameZh.localeCompare(b.nameZh, "zh-Hant");
    });

    this.els.resultCount.textContent = `顯示 ${list.length} / ${this.schools.length} 所中學`;
    this.els.schoolList.replaceChildren();

    for (const school of list) {
      const node = this.els.cardTemplate.content.cloneNode(true);
      const card = node.querySelector(".school-card");
      card.querySelector(".school-name").textContent = school.nameZh;
      card.querySelector(".school-name-en").textContent = school.nameEn;

      const band = school.band || "未知";
      const bandPill = card.querySelector(".band-pill");
      bandPill.textContent = this.bandLabel(band);
      bandPill.classList.add(`band-${band}`);

      const badges = card.querySelector(".badges");
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

  ensureMap() {
    if (this.mapReady) {
      this.refreshMapLayout({ refit: false });
      return;
    }
    if (typeof L === "undefined") {
      this.els.selectedPoint.textContent = "地圖程式庫載入失敗，請檢查網路連線後重新整理。";
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
        this.els.selectedPoint.textContent = "地圖容器尚未就緒，請再按一次「地圖與距離」。";
      }
      return;
    }
    this._mapInitRetries = 0;

    this.map = L.map(this.els.map, {
      zoomControl: true,
      attributionControl: true,
    }).setView([22.39, 114.20], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.markerLayer = L.layerGroup().addTo(this.map);
    this.addSchoolMarkers();

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
    if (school.logoDomain) {
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

  wireMarkerLogo(marker) {
    const el = marker.getElement();
    if (!el) return;
    const img = el.querySelector("img.marker-logo");
    if (!img) return;
    const showLogo = () => {
      // Tiny / broken placeholders stay hidden so initials remain visible.
      if (!img.naturalWidth || img.naturalWidth < 12) {
        img.remove();
        return;
      }
      img.hidden = false;
      el.querySelector(".marker-badge")?.classList.add("has-logo");
    };
    const dropLogo = () => {
      img.remove();
    };
    if (img.complete) {
      if (img.naturalWidth === 0) dropLogo();
      else showLogo();
      return;
    }
    img.addEventListener("load", showLogo, { once: true });
    img.addEventListener("error", dropLogo, { once: true });
  }

  addSchoolMarkers() {
    this.markerLayer.clearLayers();
    this.markers.clear();
    this.markerMeta.clear();
    const bounds = [];

    for (const school of this.schools) {
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
      marker.bindPopup(
        `<p class="popup-title">${escapeHtml(school.nameZh)}</p>
         <p class="popup-meta">${escapeHtml(this.bandLabel(school.band || "未知"))} · ${escapeHtml(school.type)} · ${escapeHtml(school.addressZh)}</p>`,
        { maxWidth: 260 }
      );
      // Touch: first tap shows name tooltip; second opens popup via Leaflet defaults
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        marker.openTooltip();
      });
      marker.on("add", () => this.wireMarkerLogo(marker));
      marker.addTo(this.markerLayer);
      this.markers.set(school.id, marker);
      this.markerMeta.set(school.id, school);
      bounds.push([school.lat, school.lng]);
    }

    if (bounds.length) {
      this.map.fitBounds(bounds, { padding: [28, 28], animate: false });
    }
  }

  setSelectedPoint(lat, lng) {
    this.selectedLatLng = { lat, lng };
    this.els.mapHint.classList.add("is-hidden");
    this.els.clearPoint.hidden = false;
    this.els.selectedPoint.textContent = `選取座標：${lat.toFixed(5)}, ${lng.toFixed(5)}（直線距離 · Haversine）`;

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
    } else {
      this.userMarker = L.marker([lat, lng], {
        icon: this.userIcon(),
        zIndexOffset: 1000,
        title: "選取位置",
      }).addTo(this.map);
      this.userMarker.bindPopup("你選取的參考點").openPopup();
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
    this.els.mapHint.classList.remove("is-hidden");
    this.els.selectedPoint.textContent = "尚未選點。請在地圖上點選參考位置。";
    this.els.distanceList.replaceChildren();
    for (const marker of this.markers.values()) {
      // leave icons; refresh below in renderDistances when point set
    }
    for (const [id, marker] of this.markers) {
      const school = this.markerMeta.get(id);
      if (school) {
        marker.setIcon(this.schoolIcon(school, false));
        this.wireMarkerLogo(marker);
      }
    }
  }

  renderDistances() {
    if (!this.selectedLatLng) return;
    const { lat, lng } = this.selectedLatLng;

    const ranked = this.schools
      .map((s) => ({
        school: s,
        meters: haversineMeters(lat, lng, s.lat, s.lng),
      }))
      .sort((a, b) => a.meters - b.meters);

    this.els.distanceList.replaceChildren();
    ranked.forEach((item, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="distance-rank">${index + 1}</span>
        <span>
          <span class="distance-name">${escapeHtml(item.school.nameZh)}</span>
          <span class="distance-meta">${escapeHtml(this.bandLabel(item.school.band || "未知"))} · ${escapeHtml(item.school.type)} · ${escapeHtml(item.school.addressZh)}</span>
        </span>
        <span class="distance-value">${formatDistance(item.meters)}</span>
      `;
      li.addEventListener("click", () => {
        const marker = this.markers.get(item.school.id);
        if (marker) {
          this.map.panTo(marker.getLatLng());
          marker.openPopup();
        }
      });
      this.els.distanceList.append(li);
    });

    const nearestId = ranked[0]?.school.id;
    for (const [id, marker] of this.markers) {
      const school = this.markerMeta.get(id);
      if (school) {
        marker.setIcon(this.schoolIcon(school, id === nearestId));
        this.wireMarkerLogo(marker);
      }
    }
  }

  showSchoolOnMap(schoolId) {
    const school = this.schools.find((s) => s.id === schoolId);
    if (!school) return;

    // Activate tab first; ensureMap waits for non-zero container size.
    this.els.tabMap.click();
    this.ensureMap();

    const open = () => {
      if (!this.mapReady) {
        requestAnimationFrame(open);
        return;
      }
      this.refreshMapLayout({ refit: false });
      const marker = this.markers.get(schoolId);
      this.map.setView([school.lat, school.lng], 16, { animate: true });
      if (marker) {
        this.wireMarkerLogo(marker);
        marker.openPopup();
      }
    };
    open();
  }
}

const app = new App();
app.init();
