/**
 * Bootstrap: App first, then optional Firebase Auth / Firestore prefs.
 *
 * Critical: never statically import the Firebase CDN here. A blocked or slow
 * gstatic load must not prevent school/event data from rendering. Guest browsing
 * works even when Firebase is unavailable or not configured.
 */

import { App } from "./app.js?v=schoolscope-3";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js?v=schoolscope-3";

const app = new App();
app.init();
window.__HK_APP__ = app;

const authMount = document.getElementById("auth-mount");
const configured = isFirebaseConfigured();

/** @type {Awaited<ReturnType<typeof import("./prefs.js").createPrefsStore>> | null} */
let prefsStore = null;
/** @type {string | null} */
let activeUid = null;
/** Suppress cloud writes while applying a remote snapshot. */
let applyingCloud = false;

function snapshotSyncedPrefs() {
  return app.getSyncedPrefs();
}

function scheduleCloudSave({ immediate = false } = {}) {
  if (!prefsStore || !activeUid || applyingCloud) return;
  prefsStore.scheduleSave(activeUid, snapshotSyncedPrefs(), { immediate });
}

app.setPrefsHooks({
  onSyncedChange: ({ immediate } = {}) => scheduleCloudSave({ immediate }),
});

/**
 * On login: cloud overlays local.
 * Empty cloud doc: upload current in-memory prefs once, then cloud is source of truth.
 * On logout: keep current UI state in memory for this session (not account content).
 */
async function handleAuthUser(user) {
  if (!user) {
    if (prefsStore) prefsStore.cancelPending();
    activeUid = null;
    app.setAuthUser(null);
    return;
  }

  activeUid = user.uid;
  app.setAuthUser({
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
  });

  if (!prefsStore) return;

  try {
    const cloud = await prefsStore.load(user.uid, app.schoolByName);
    if (cloud) {
      applyingCloud = true;
      try {
        app.applySyncedPrefs(cloud);
      } finally {
        applyingCloud = false;
      }
    } else {
      // First login / empty doc: seed cloud from current session once.
      await prefsStore.writeNow(user.uid, snapshotSyncedPrefs());
    }
  } catch (err) {
    console.warn("[prefs] load/seed failed", err);
  }
}

function renderGuestAuthNote(message, title) {
  if (!authMount) return;
  authMount.replaceChildren();
  authMount.hidden = false;
  const note = document.createElement("p");
  note.className = "auth-note";
  note.textContent = message;
  if (title) note.title = title;
  authMount.append(note);
}

/**
 * Load Firebase + auth chrome only after App has already painted school/event data.
 * Dynamic imports keep a CDN failure from blanking the whole site.
 */
async function bootAuthLayer() {
  if (!configured) {
    renderGuestAuthNote(
      "登入未設定（訪客可用）",
      "Firebase web config 仍是 placeholder。填好 js/firebase-config.js 並在 Console 開 Google Sign-In 後即可登入。"
    );
    return;
  }

  try {
    const [{ initializeApp }, { createAuthChrome }, { createPrefsStore }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
      import("./auth.js?v=schoolscope-3"),
      import("./prefs.js?v=schoolscope-3"),
    ]);

    try {
      const firebaseApp = initializeApp(firebaseConfig);
      prefsStore = createPrefsStore(firebaseApp);
      const authChrome = createAuthChrome({
        firebaseApp,
        mount: authMount,
        enabled: true,
        onUser: handleAuthUser,
      });
      authChrome.start();
    } catch (err) {
      console.warn("[firebase] init failed; continuing as guest", err);
      createAuthChrome({
        firebaseApp: null,
        mount: authMount,
        enabled: false,
        onUser: () => {},
      }).start();
    }
  } catch (err) {
    console.warn("[firebase] SDK unavailable; continuing as guest", err);
    renderGuestAuthNote(
      "登入暫不可用（訪客可用）",
      "無法載入 Firebase SDK（網絡或封鎖）。學校與升中資料仍可瀏覽。"
    );
  }
}

bootAuthLayer();

// Flush pending prefs on page hide when signed in.
window.addEventListener("pagehide", () => {
  if (prefsStore && activeUid) {
    prefsStore.flush().catch(() => {});
  }
});
