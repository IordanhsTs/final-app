import * as VertexLocation from '../../modules/vertex-location';
import { supabase, getActiveBackend, getTenantSchema } from '../../supabase';
import { supportsNativeTokenStore } from './sessionStore';

// Ξεκινάει τον native foreground service (WakeLock + FusedLocation + REST POST).
export async function startNativeTracking(driverId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !driverId) {
    console.log('[NativeTracking] Λείπει session ή driverId — δεν ξεκινάω.');
    return;
  }

  // Παίρνουμε το ΕΝΕΡΓΟ backend (primary ή standby) ώστε το native service
  // να στέλνει στίγματα στο σωστό host μετά από failover.
  const backend = getActiveBackend();
  VertexLocation.startTracking({
    driverId: String(driverId),
    supabaseUrl: backend.url,
    anonKey: backend.anonKey,
    accessToken: session.access_token,
    // ΤΟ REFRESH TOKEN ΠΑΕΙ ΣΤΟ NATIVE ΜΟΝΟ ΑΝ ΕΚΕΙΝΟ ΞΕΡΕΙ ΝΑ ΤΟ ΕΠΙΣΤΡΕΨΕΙ.
    // Παλιότερα APK ανανέωναν με το δικό τους αντίγραφο και το κρατούσαν στη
    // μνήμη — το rotation του Supabase ακύρωνε ό,τι είχε ο JS στον δίσκο και ο
    // διανομέας έβρισκε οθόνη εισόδου την επόμενη φορά. Χωρίς refresh token, το
    // native απλώς σταματά να στέλνει όταν λήξει το access token και ξαναρχίζει
    // μόλις ανοίξει η εφαρμογή — προτιμότερο από σπασμένη σύνδεση.
    ...(supportsNativeTokenStore() ? { refreshToken: session.refresh_token } : {}),
    intervalMs: '10000',
    // MULTI-TENANT: το native service γράφει raw REST — πρέπει να ξέρει το schema της
    // εταιρίας ώστε το στίγμα να πάει στο co_*.drivers (όχι πάντα στο 'public'), εκεί
    // που διαβάζει το admin. Fallback 'public' για backward-compatibility.
    schema: getTenantSchema(),
  });
  console.log('✅ Native Location Service ξεκίνησε');
}

export function stopNativeTracking() {
  try {
    VertexLocation.stopTracking();
    console.log('🛑 Native Location Service σταμάτησε');
  } catch (e) {
    console.log('[NativeTracking] stop error:', e?.message);
  }
}

// Ταΐζει το ΤΡΕΧΟΝ (ζωντανό) native service με φρέσκο token, χωρίς restart. Καλείται
// από τον JS auth listener σε κάθε TOKEN_REFRESHED/SIGNED_IN → μία αρχή αλήθειας για
// τα tokens, ώστε το native να μη κάνει το δικό του (αποκλίνον) refresh. No-op αν δεν
// τρέχει tracking (π.χ. SIGNED_IN πριν ξεκινήσει το service — τότε το startNativeTracking
// περνά ούτως ή άλλως φρέσκο token).
export function updateNativeToken(accessToken, refreshToken) {
  try {
    if (!accessToken) return;
    // Σε builds με μόνιμη αποθήκη γράφουμε ΠΑΝΤΑ (και με νεκρό service): έτσι η
    // αποθήκη μένει συγχρονισμένη με τον JS, που είναι ο κύριος refresher.
    if (supportsNativeTokenStore()) {
      VertexLocation.updateToken(refreshToken ? { accessToken, refreshToken } : { accessToken });
      return;
    }
    if (VertexLocation.isTracking && VertexLocation.isTracking()) {
      VertexLocation.updateToken({ accessToken });
    }
  } catch (e) {
    console.log('[NativeTracking] updateToken error:', e?.message);
  }
}

// Εμφανίζει το system dialog για εξαίρεση από τη βελτιστοποίηση μπαταρίας (μία φορά).
export async function ensureBatteryExemption() {
  try {
    if (!VertexLocation.isIgnoringBatteryOptimizations()) {
      VertexLocation.requestBatteryOptExemption();
    }
  } catch (e) {
    console.log('[NativeTracking] battery exemption error:', e?.message);
  }
}
