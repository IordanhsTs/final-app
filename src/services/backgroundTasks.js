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

  // ── 2. Έλεγχος για νέες παραγγελίες ──────────────────────────────────────
  try {
    const { data: pendingOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id, address, store_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (ordersError || !pendingOrders) return;

    // Διαβάζουμε τα IDs που ήδη γνωρίζουμε
    const knownIdsRaw = await AsyncStorage.getItem('knownPendingOrderIds');
    const knownIds = new Set(knownIdsRaw ? JSON.parse(knownIdsRaw) : []);

    // Βρίσκουμε παραγγελίες που είναι ΠΡΑΓΜΑΤΙΚΑ νέες
    const newOrders = pendingOrders.filter(o => !knownIds.has(o.id));

    if (newOrders.length > 0) {
      for (const order of newOrders) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🛵 Νέα Παραγγελία!',
            body: order.address || 'Νέα παραγγελία διαθέσιμη',
            sound: 'default',
            priority: Notifications.AndroidNotificationPriority.MAX,
            vibrate: [0, 500, 200, 500],
            data: { orderId: order.id },
          },
          trigger: null, // Εμφάνιση αμέσως
        });
      }
    }

    // Αποθηκεύουμε τα τρέχοντα IDs ως "γνωστά"
    await AsyncStorage.setItem(
      'knownPendingOrderIds',
      JSON.stringify(pendingOrders.map(o => o.id))
    );
  } catch (e) {
    console.error('Σφάλμα ελέγχου παραγγελιών σε background:', e);
  }
});