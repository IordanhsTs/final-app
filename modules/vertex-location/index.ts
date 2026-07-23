import VertexLocation from './src/VertexLocationModule';

export type TrackingConfig = {
  driverId: string;
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
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
export function updateToken(config: { accessToken: string; refreshToken: string }): void {
  VertexLocation.updateToken(config);
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
