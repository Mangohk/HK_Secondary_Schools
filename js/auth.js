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
  /** @type {null | (() => void)} */
  let disposeMenu = null;

  function getDisplayLabel(user) {
    return user.displayName || user.email || "已登入";
  }

  function getAvatarInitial(user) {
    const source = (user.displayName || user.email || "").trim();
    const first = source ? [...source][0] : "";
    return first || "?";
  }

  function clearMenuListeners() {
    if (disposeMenu) {
      disposeMenu();
      disposeMenu = null;
    }
  }

  function render() {
    if (!mount) return;
    clearMenuListeners();
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

    const displayLabel = getDisplayLabel(currentUser);
    const menuId = "auth-account-menu";

    const wrap = document.createElement("div");
    wrap.className = "auth-user";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "auth-avatar-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menuId);
    trigger.setAttribute(
      "aria-label",
      currentUser.displayName || currentUser.email || "帳戶選單"
    );

    if (currentUser.photoURL) {
      const img = document.createElement("img");
      img.className = "auth-avatar";
      img.src = currentUser.photoURL;
      img.alt = "";
      img.width = 32;
      img.height = 32;
      img.referrerPolicy = "no-referrer";
      trigger.append(img);
    } else {
      const initial = document.createElement("span");
      initial.className = "auth-avatar auth-avatar-initial";
      initial.textContent = getAvatarInitial(currentUser);
      initial.setAttribute("aria-hidden", "true");
      trigger.append(initial);
    }

    const menu = document.createElement("div");
    menu.id = menuId;
    menu.className = "auth-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    const name = document.createElement("div");
    name.className = "auth-display-name";
    name.textContent = displayLabel;
    name.title = currentUser.email || "";
    menu.append(name);

    const out = document.createElement("button");
    out.type = "button";
    out.className = "auth-logout-btn";
    out.setAttribute("role", "menuitem");
    out.textContent = "登出";
    out.addEventListener("click", () => {
      closeMenu({ returnFocus: false });
      logOut();
    });
    menu.append(out);

    function closeMenu({ returnFocus = true } = {}) {
      if (menu.hidden) return;
      clearMenuListeners();
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (returnFocus) trigger.focus();
    }

    function openMenu() {
      if (!menu.hidden) return;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      out.focus();

      const onPointerDown = (event) => {
        if (wrap.contains(event.target)) return;
        closeMenu();
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeMenu();
        }
      };

      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      disposeMenu = () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
      };
    }

    function toggleMenu() {
      if (menu.hidden) openMenu();
      else closeMenu();
    }

    trigger.addEventListener("click", () => toggleMenu());

    wrap.append(trigger, menu);
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
