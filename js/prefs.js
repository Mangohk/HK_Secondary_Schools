/**
 * Firestore user prefs: users/{uid}
 * Synced fields only — never includes search `query`.
 */

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export const PREFS_DEBOUNCE_MS = 400;

const ALLOWED_TYPES = new Set(["all", "官立", "資助", "直資", "私立"]);
const ALLOWED_BANDS = new Set(["all", "1", "2", "3", "未知"]);

/**
 * @param {import('firebase/app').FirebaseApp} app
 */
export function createPrefsStore(app) {
  const db = getFirestore(app);
  let saveTimer = null;
  let pendingUid = null;
  let pendingPayload = null;
  let writing = false;

  function userRef(uid) {
    return doc(db, "users", uid);
  }

  function sanitizeFavorites(raw, schoolByName) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const name = item.trim();
      if (!name || seen.has(name)) continue;
      if (schoolByName && schoolByName.size && !schoolByName.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }

  /**
   * Cloud showPast when it is a boolean. Legacy hidePast is inverted.
   * Missing both → undefined so login does not invent a value and write it back.
   */
  function readShowPast(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    if (typeof raw.showPast === "boolean") return raw.showPast;
    if (typeof raw.hidePast === "boolean") return !raw.hidePast;
    return undefined;
  }

  function sanitizePrefs(raw, schoolByName) {
    if (!raw || typeof raw !== "object") return null;
    const filterDistrict =
      typeof raw.filterDistrict === "string" && raw.filterDistrict
        ? raw.filterDistrict
        : "all";
    const filterType = ALLOWED_TYPES.has(raw.filterType) ? raw.filterType : "all";
    const filterBand = ALLOWED_BANDS.has(raw.filterBand) ? raw.filterBand : "all";
    const showTerritoryEvents = raw.showTerritoryEvents !== false;
    const favorites = sanitizeFavorites(raw.favorites, schoolByName);
    const showPast = readShowPast(raw);
    const prefs = {
      filterDistrict,
      filterType,
      filterBand,
      showTerritoryEvents,
      favorites,
    };
    if (typeof showPast === "boolean") prefs.showPast = showPast;
    return prefs;
  }

  /**
   * Load cloud prefs. Returns null if the document is missing.
   */
  async function load(uid, schoolByName) {
    const snap = await getDoc(userRef(uid));
    if (!snap.exists()) return null;
    return sanitizePrefs(snap.data(), schoolByName);
  }

  async function writeNow(uid, prefs) {
    const payload = {
      filterDistrict: prefs.filterDistrict ?? "all",
      filterType: prefs.filterType ?? "all",
      filterBand: prefs.filterBand ?? "all",
      showTerritoryEvents: prefs.showTerritoryEvents !== false,
      showPast: prefs.showPast === true,
      favorites: Array.isArray(prefs.favorites) ? prefs.favorites : [],
      updatedAt: serverTimestamp(),
    };
    // Never persist search query.
    writing = true;
    try {
      await setDoc(userRef(uid), payload, { merge: true });
    } finally {
      writing = false;
    }
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!pendingUid || !pendingPayload) return Promise.resolve();
    const uid = pendingUid;
    const prefs = pendingPayload;
    pendingUid = null;
    pendingPayload = null;
    return writeNow(uid, prefs);
  }

  /**
   * Debounced write-through. Pass { immediate: true } for favorites toggles.
   */
  function scheduleSave(uid, prefs, { immediate = false } = {}) {
    pendingUid = uid;
    pendingPayload = prefs;
    if (immediate) return flush();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush().catch((err) => console.warn("[prefs] save failed", err));
    }, PREFS_DEBOUNCE_MS);
    return Promise.resolve();
  }

  function cancelPending() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    pendingUid = null;
    pendingPayload = null;
  }

  return {
    load,
    writeNow,
    scheduleSave,
    flush,
    cancelPending,
    sanitizePrefs,
    get isWriting() {
      return writing;
    },
  };
}
