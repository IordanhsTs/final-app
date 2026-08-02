import VertexLocation from './src/VertexLocationModule';

export type TrackingConfig = {
  driverId: string;
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  // Προαιρετικό: δίνεται μόνο σε builds που αποθηκεύουν μόνιμα ό,τι ανανεώνουν
  // (getTokens/clearTokens). Σε παλιότερα APK το native θα ανανέωνε χωρίς να το
  // μάθει ποτέ ο JS — δηλαδή θα έσπαγε τη σύνδεση. Βλ. sessionStore.js.
  refreshToken?: string;
  intervalMs?: string;
};

export function startTracking(config: TrackingConfig): void {
  VertexLocation.startTracking(config);
}

export function stopTracking(): void {
  VertexLocation.stopTracking();
}

// Ενημερώνει το ζωντανό service με φρέσκο token (μία αρχή αλήθειας — ο JS refresher
// ταΐζει το native ώστε να μη κάνει το δικό του, αποκλίνον refresh).
export function updateToken(config: { accessToken: string; refreshToken?: string }): void {
  VertexLocation.updateToken(config);
}

// Τα τελευταία tokens που κρατά το native — διαβάζονται και με νεκρό service.
export function getTokens(): { accessToken: string; refreshToken: string } {
  return VertexLocation.getTokens();
}

// Σβήνει τη μόνιμη αποθήκη tokens (μόνο σε ηθελημένη αποσύνδεση).
export function clearTokens(): void {
  VertexLocation.clearTokens();
}

export function isTracking(): boolean {
  return VertexLocation.isTracking();
}

export function isIgnoringBatteryOptimizations(): boolean {
  return VertexLocation.isIgnoringBatteryOptimizations();
}

export function requestBatteryOptExemption(): void {
  VertexLocation.requestBatteryOptExemption();
}

export function openAppSettings(): void {
  VertexLocation.openAppSettings();
}
