import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// ─── FAILOVER: primary + standby backend ─────────────────────────────────────
// Αν δεν οριστεί EXPO_PUBLIC_SUPABASE_STANDBY_URL, η εφαρμογή δουλεύει ακριβώς
// όπως πριν (ένα backend, χωρίς failover). Το standby μοιράζεται το ίδιο JWT
// secret με το primary, οπότε το ίδιο session/anon key ισχύει και στα δύο.

const BACKENDS = [
  {
    name: 'primary',
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
  {
    name: 'standby',
    url: process.env.EXPO_PUBLIC_SUPABASE_STANDBY_URL,
    anonKey:
      process.env.EXPO_PUBLIC_SUPABASE_STANDBY_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
].filter((b) => !!b.url);

// Κεντρική "πηγή αλήθειας" (Cloudflare Worker) για το ποιο backend είναι ενεργό.
// Χωρίς αυτήν, κάθε συσκευή αποφασίζει μόνη της με τοπικά health checks.
const CONFIG_URLS = (process.env.EXPO_PUBLIC_FAILOVER_CONFIG_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const STORAGE_KEY = 'vertex-auth'; // κοινό session key και για τα δύο backends
const ACTIVE_CACHE_KEY = 'vertex-active-backend';
const TENANT_KEY = 'vertex-tenant'; // MULTI-TENANT: το schema της εταιρίας του χρήστη
const CHECK_INTERVAL_MS = 30000;
const FETCH_TIMEOUT_MS = 4000;
const FAILURES_BEFORE_SWITCH = 2;

let activeIndex = 0;
let tenantSchema; // MULTI-TENANT: undefined → default schema 'public' (backward-compatible)
let consecutiveFailures = 0;
const listeners = new Set();
const tokenListeners = new Set(); // ταΐζουν το native GPS service με φρέσκο token σε refresh
let watchdogTimer = null;

function buildClient(index) {
  const b = BACKENDS[index];
  return createClient(b.url, b.anonKey, {
    auth: {
      storage: AsyncStorage,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    ...(tenantSchema ? { db: { schema: tenantSchema } } : {}),
  });
}

let client = buildClient(activeIndex);

// ─── MULTI-TENANT: schema ανά εταιρία (από το `tenant` claim του JWT) ──────────
// (React Native/Hermes: δικός μας base64url decoder, χωρίς εξάρτηση σε atob)
function b64urlDecode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = input.replace(/-/g, '+').replace(/_/g, '/');
  let output = '';
  for (let bc = 0, bs = 0, i = 0; i < str.length; i++) {
    const c = chars.indexOf(str.charAt(i));
    if (c === -1 || c === 64) continue;
    bs = bc % 4 ? bs * 64 + c : c;
    if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
  }
  return output;
}

// Ξαναχτίζει τον client με το τρέχον tenantSchema (ίδιο μοτίβο με το failover switchTo).
async function rebuildClient(reason) {
  const old = client;
  client = buildClient(activeIndex);
  try { old.removeAllChannels(); } catch (_) {}
  try { old.auth.stopAutoRefresh(); } catch (_) {}
  attachTenantWatcher();
  console.log(`🏷️ [tenant] rebuild client (${reason}) schema=${tenantSchema}`);
  listeners.forEach((fn) => { try { fn(BACKENDS[activeIndex]); } catch (_) {} });
}

async function applyTenantFromSession(session) {
  if (!session || !session.access_token) return;
  try {
    const claims = JSON.parse(b64urlDecode(session.access_token.split('.')[1]));
    const t = claims.tenant;
    if (t && t !== tenantSchema) {
      tenantSchema = t;
      try { await AsyncStorage.setItem(TENANT_KEY, t); } catch (_) {}
      await rebuildClient('tenant set');
    }
  } catch (e) {
    console.error('[tenant] αδυναμία ανάγνωσης claim:', e);
  }
}

function attachTenantWatcher() {
  try {
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        tenantSchema = undefined;
        AsyncStorage.removeItem(TENANT_KEY).catch(() => {});
        return;
      }
      // Μία αρχή αλήθειας για τα tokens: σε κάθε refresh/login ταΐζουμε το native GPS
      // service με το φρέσκο token, ώστε να μη κάνει το δικό του (αποκλίνον) refresh
      // που προκαλούσε logout + παγωμένο στίγμα.
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session && session.access_token) {
        tokenListeners.forEach((fn) => {
          try { fn(session.access_token, session.refresh_token); } catch (_) {}
        });
      }
      applyTenantFromSession(session);
    });
  } catch (_) {}
}
attachTenantWatcher();

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

async function isHealthy(backend) {
  try {
    const res = await fetchWithTimeout(`${backend.url}/auth/v1/health`, {
      headers: { apikey: backend.anonKey },
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// Ρωτάει τα config URLs με τη σειρά· επιστρέφει 'primary' | 'standby' | null.
async function readRemoteConfig() {
  for (const base of CONFIG_URLS) {
    try {
      const sep = base.includes('?') ? '&' : '?';
      const res = await fetchWithTimeout(`${base}${sep}t=${Date.now()}`);
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && (cfg.active === 'primary' || cfg.active === 'standby')) {
          return cfg.active;
        }
      }
    } catch (_) {}
  }
  return null;
}

async function switchTo(index, reason) {
  if (index === activeIndex || !BACKENDS[index]) return;
  const old = client;
  activeIndex = index;
  consecutiveFailures = 0;
  client = buildClient(index);
  attachTenantWatcher();
  try { old.removeAllChannels(); } catch (_) {}
  try { old.auth.stopAutoRefresh(); } catch (_) {}
  try { await AsyncStorage.setItem(ACTIVE_CACHE_KEY, String(index)); } catch (_) {}
  console.log(`🔄 [Failover] Μετάβαση στο backend "${BACKENDS[index].name}" (${reason})`);
  listeners.forEach((fn) => {
    try { fn(BACKENDS[index]); } catch (_) {}
  });
}

async function tick() {
  if (BACKENDS.length < 2) return;

  // 1) Κεντρική εντολή — προηγείται, ώστε όλες οι συσκευές να συμφωνούν
  //    στο ίδιο backend (αποφυγή split-brain).
  const desired = await readRemoteConfig();
  if (desired) {
    const idx = desired === 'standby' ? 1 : 0;
    if (idx !== activeIndex) await switchTo(idx, 'κεντρική εντολή');
    consecutiveFailures = 0;
    return;
  }

  // 2) Fallback αν δεν απαντά το config: τοπικός έλεγχος υγείας.
  if (await isHealthy(BACKENDS[activeIndex])) {
    consecutiveFailures = 0;
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURES_BEFORE_SWITCH) {
    const other = activeIndex === 0 ? 1 : 0;
    if (BACKENDS[other] && (await isHealthy(BACKENDS[other]))) {
      await switchTo(other, 'το ενεργό backend δεν αποκρίνεται');
    }
  }
}

export function startFailoverWatchdog() {
  if (watchdogTimer || BACKENDS.length < 2) return;
  watchdogTimer = setInterval(tick, CHECK_INTERVAL_MS);
  // Το Android "παγώνει" τα setInterval όταν η εφαρμογή είναι στο παρασκήνιο.
  // Χωρίς αυτό, ένα κινητό που έμεινε σε standby μετά από failover ΔΕΝ γυρίζει
  // πίσω στο primary μέχρι να γίνει πλήρης επανεκκίνηση. Ελέγχουμε λοιπόν τον
  // τροχονόμο ΑΜΕΣΩΣ κάθε φορά που ο διανομέας ανοίγει ξανά την εφαρμογή.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') tick();
  });
}

// Καλείται όταν αλλάξει backend — π.χ. για re-subscribe των realtime channels.
export function onBackendChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Καλείται σε κάθε TOKEN_REFRESHED/SIGNED_IN με (accessToken, refreshToken) — ζει πάνω
// από τα client rebuilds (failover/tenant) γιατί το attachTenantWatcher το ξανασυνδέει.
export function onTokenRefresh(listener) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export function getActiveBackend() {
  return BACKENDS[activeIndex];
}

// MULTI-TENANT: το schema στο οποίο ζουν τα δεδομένα του χρήστη. Τα realtime κανάλια
// ΠΡΕΠΕΙ να το χρησιμοποιούν (όχι καρφωτό 'public'), αλλιώς σε co_* tenant τα live
// updates σπάνε σιωπηλά. Fallback 'public' → backward-compatible με το σημερινό setup.
export function getTenantSchema() {
  return tenantSchema || 'public';
}

// READ-ONLY-ON-FAILOVER: όταν τρέχουμε στο εφεδρικό (standby), οι εγγραφές είναι
// κλειστές — το standby δέχεται ΜΟΝΟ αναγνώσεις κατά τη βλάβη ώστε να μην αποκλίνουν
// τα δεδομένα. Τιμή call-time (το switchTo αλλάζει το activeIndex χωρίς reload).
export function isReadOnly() {
  return BACKENDS[activeIndex]?.name === 'standby';
}

// Στο logout πρέπει να καθαρίσουμε is_active + fcm_token σε ΟΛΑ τα backends,
// όχι μόνο στο ενεργό — αλλιώς το άλλο σύστημα κρατάει το token και συνεχίζει
// να στέλνει ειδοποιήσεις παραγγελιών σε αποσυνδεδεμένο οδηγό. Το ίδιο session
// token ισχύει και στα δύο (κοινό JWT secret). Best-effort ανά backend.
export async function clearDriverPresenceEverywhere(driverId) {
  if (!driverId) return;
  let accessToken;
  try {
    const { data } = await supabase.auth.getSession();
    accessToken = data && data.session ? data.session.access_token : null;
  } catch (_) {}
  if (!accessToken) return;
  await Promise.all(
    BACKENDS.map(async (b) => {
      try {
        await fetchWithTimeout(`${b.url}/rest/v1/drivers?id=eq.${driverId}`, {
          method: 'PATCH',
          headers: {
            apikey: b.anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ is_active: false, fcm_token: null }),
        });
      } catch (_) {}

      // ΧΙΛΙΟΜΕΤΡΗΤΗΣ: κλείσιμο της βάρδιας τη στιγμή του logout. Χωρίς αυτό η
      // βάρδια θα έκλεινε μόνη της μετά από 30 λεπτά σιωπής (migration 0013) —
      // σωστά χιλιόμετρα αλλά φουσκωμένες ώρες. Best-effort: αν αποτύχει, το
      // αυτόματο κλείσιμο του server παραμένει το δίχτυ ασφαλείας.
      try {
        await fetchWithTimeout(`${b.url}/rest/v1/rpc/end_driver_shift`, {
          method: 'POST',
          headers: {
            apikey: b.anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Profile': getTenantSchema(),
            'Accept-Profile': getTenantSchema(),
          },
          body: '{}',
        });
      } catch (_) {}
    })
  );
}

// Επαναφορά της τελευταίας επιλογής (αν η συσκευή είχε ήδη μεταβεί σε standby)
// και εκκίνηση του watchdog.
(async () => {
  try {
    const saved = await AsyncStorage.getItem(ACTIVE_CACHE_KEY);
    const idx = saved ? parseInt(saved, 10) : 0;
    if (idx > 0 && BACKENDS[idx]) await switchTo(idx, 'αποθηκευμένη επιλογή');
  } catch (_) {}
  // MULTI-TENANT: επαναφορά αποθηκευμένου tenant → ξαναχτίσιμο με το σωστό schema
  try {
    const t = await AsyncStorage.getItem(TENANT_KEY);
    if (t && t !== tenantSchema) { tenantSchema = t; await rebuildClient('αποθηκευμένο tenant'); }
  } catch (_) {}
  startFailoverWatchdog();
})();

// Proxy ώστε το `supabase` να δείχνει πάντα στον ενεργό client — όλα τα
// υπάρχοντα imports (`import { supabase } from './supabase'`) δουλεύουν ως έχουν.
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);
