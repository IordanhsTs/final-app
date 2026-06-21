import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../supabase';

// ─── Ονόματα Tasks ────────────────────────────────────────────────────────────
export const LOCATION_TASK_NAME = 'background-location-task';

// ─── Background Location Task ─────────────────────────────────────────────────
// Αυτό το task τρέχει μέσα σε Android Foreground Service — δεν το σκοτώνει ποτέ το OS.
// Κάνει ΔΥΟ πράγματα: (1) ανεβάζει τοποθεσία, (2) ελέγχει για νέες παραγγελίες.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Σφάλμα Background Location:', error);
    return;
  }
  if (!data) return;

  const { locations } = data;
  const location = locations[0];
  const driverId = await AsyncStorage.getItem('driverId');

  if (!driverId || !location) return;

  // ── 1. Ανέβασμα τοποθεσίας ───────────────────────────────────────────────
  await supabase
    .from('drivers')
    .update({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    })
    .eq('id', driverId);

  // Αφαιρέθηκε ο κώδικας για έλεγχο νέων παραγγελιών
  // Πλέον αυτό γίνεται μέσω Push Notifications (FCM) από τη Supabase.
});