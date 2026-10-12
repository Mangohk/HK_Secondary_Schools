/**
 * Bootstrap: App + optional Firebase Auth / Firestore prefs.
 * Guest browsing works even when Firebase is not configured.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { App } from "./app.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { createAuthChrome } from "./auth.js";
import { createPrefsStore } from "./prefs.js";

const app = new App();
app.init();

const authMount = document.getElementById("auth-mount");
const configured = isFirebaseConfigured();

/** @type {ReturnType<typeof createPrefsStore> | null} */
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

if (configured) {
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
} else {
  createAuthChrome({
    firebaseApp: null,
    mount: authMount,
    enabled: false,
    onUser: () => {},
  }).start();
}

// Flush pending prefs on page hide when signed in.
window.addEventListener("pagehide", () => {
  if (prefsStore && activeUid) {
    prefsStore.flush().catch(() => {});
  }
});

window.__HK_APP__ = app;
