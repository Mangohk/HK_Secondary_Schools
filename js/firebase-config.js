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
  apiKey: "AIzaSyD3Owtj6-YWDN5VkpdQXH53J4s5ot3h4nU",
  authDomain: "hk-secondary-schools.firebaseapp.com",
  projectId: "hk-secondary-schools",
  storageBucket: "hk-secondary-schools.firebasestorage.app",
  messagingSenderId: "173241819499",
  appId: "1:173241819499:web:5e372a754ad295991a6c2e",
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
