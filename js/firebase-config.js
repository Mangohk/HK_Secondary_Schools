/**
 * Firebase web config for GitHub Pages (public by design).
 *
 * Replace YOUR_* placeholders with values from the Firebase console
 * (Project settings → Your apps → Web app). Never put Admin / service-account
 * secrets in this repo.
 *
 * Authorized domains must include: mangohk.github.io (and localhost for local HTTP).
 * Site path: https://mangohk.github.io/HK_Secondary_Schools/
 */

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

/** True when web config looks filled in (not scaffolding placeholders). */
export function isFirebaseConfigured() {
  const { apiKey, projectId, appId } = firebaseConfig;
  if (!apiKey || !projectId || !appId) return false;
  if (String(apiKey).startsWith("YOUR_")) return false;
  if (String(projectId).startsWith("YOUR_")) return false;
  if (String(appId).startsWith("YOUR_")) return false;
  return true;
}
