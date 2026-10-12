/**
 * Google Sign-In (popup) + auth chrome for the site header.
 */

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

/**
 * @param {object} options
 * @param {import('firebase/app').FirebaseApp} options.firebaseApp
 * @param {HTMLElement} options.mount
 * @param {(user: import('firebase/auth').User | null) => void | Promise<void>} options.onUser
 * @param {boolean} [options.enabled]
 */
export function createAuthChrome({ firebaseApp, mount, onUser, enabled = true }) {
  const auth = enabled ? getAuth(firebaseApp) : null;
  const provider = enabled ? new GoogleAuthProvider() : null;
  let currentUser = null;
  let busy = false;

  function render() {
    if (!mount) return;
    mount.replaceChildren();
    mount.hidden = false;

    if (!enabled) {
      const note = document.createElement("p");
      note.className = "auth-note";
      note.textContent = "登入未設定（訪客可用）";
      note.title =
        "Firebase web config 仍是 placeholder。填好 js/firebase-config.js 並在 Console 開 Google Sign-In 後即可登入。";
      mount.append(note);
      return;
    }

    if (busy) {
      const status = document.createElement("span");
      status.className = "auth-status";
      status.textContent = "處理中…";
      mount.append(status);
      return;
    }

    if (!currentUser) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary auth-login-btn";
      btn.textContent = "用 Google 登入";
      btn.addEventListener("click", () => signIn());
      mount.append(btn);
      const hint = document.createElement("span");
      hint.className = "auth-guest-hint";
      hint.textContent = "訪客可用；登入後同步篩選與關注";
      mount.append(hint);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "auth-user";

    if (currentUser.photoURL) {
      const img = document.createElement("img");
      img.className = "auth-avatar";
      img.src = currentUser.photoURL;
      img.alt = "";
      img.width = 32;
      img.height = 32;
      img.referrerPolicy = "no-referrer";
      wrap.append(img);
    }

    const name = document.createElement("span");
    name.className = "auth-display-name";
    name.textContent = currentUser.displayName || currentUser.email || "已登入";
    name.title = currentUser.email || "";
    wrap.append(name);

    const out = document.createElement("button");
    out.type = "button";
    out.className = "btn btn-secondary auth-logout-btn";
    out.textContent = "登出";
    out.addEventListener("click", () => logOut());
    wrap.append(out);

    mount.append(wrap);
  }

  async function signIn() {
    if (!auth || !provider || busy) return;
    busy = true;
    render();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.warn("[auth] sign-in failed", err);
      const code = err?.code || "";
      let msg = "登入失敗，請稍後再試。";
      if (code === "auth/popup-blocked") msg = "彈出視窗被封鎖，請允許後再試。";
      else if (code === "auth/unauthorized-domain") {
        msg = "此網域未獲授權。請在 Firebase Console 加入 mangohk.github.io。";
      }
      window.alert(msg);
    } finally {
      busy = false;
      render();
    }
  }

  async function logOut() {
    if (!auth || busy) return;
    busy = true;
    render();
    try {
      await signOut(auth);
    } catch (err) {
      console.warn("[auth] sign-out failed", err);
    } finally {
      busy = false;
      render();
    }
  }

  function start() {
    render();
    if (!auth) {
      onUser(null);
      return () => {};
    }
    return onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      busy = false;
      render();
      try {
        await onUser(user);
      } catch (err) {
        console.warn("[auth] onUser handler failed", err);
      }
    });
  }

  return {
    start,
    signIn,
    logOut,
    getUser: () => currentUser,
  };
}
