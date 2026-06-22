import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../supabase';

export const LOCATION_TASK_NAME = 'background-location-task';

let callCount = 0;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  callCount++;
  const now = new Date().toLocaleTimeString('el-GR');
  console.log(`📍 BACKGROUND TASK #${callCount} @ ${now}`);

  if (error) {
    console.error('Σφάλμα Background Location:', error);
    return;
  }

  // ── ΕΛΕΓΧΟΣ ΠΑΡΑΓΓΕΛΙΩΝ (κάθε φορά που τρέχει το task) ──
  try {
    const { data: pendingOrders, error: dbError } = await supabase
      .from('orders')
      .select('id, address')
      .eq('status', 'pending');

    if (dbError) {
      console.log('❌ DB error:', dbError.message);
    } else if (pendingOrders && pendingOrders.length > 0) {
      const knownStr = await AsyncStorage.getItem('knownPendingOrderIds');
      const knownIds = knownStr ? JSON.parse(knownStr) : [];

      for (const order of pendingOrders) {
        if (!knownIds.includes(order.id)) {
          console.log('🔔 ΝΕΑ ΠΑΡΑΓΓΕΛΙΑ! ID:', order.id, '| Διεύθυνση:', order.address);

          await Notifications.setNotificationChannelAsync('orders_urgent_v1', {
            name: 'Παραγγελίες (Επείγον)',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'default',
            vibrationPattern: [0, 500, 200, 500],
            enableVibrate: true,
            enableLights: true,
            lightColor: '#FF0000',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
          });

          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🛵 Νέα Παραγγελία!',
              body: order.address || 'Νέα παραγγελία στο σύστημα.',
              sound: 'default',
              priority: Notifications.AndroidNotificationPriority.MAX,
              vibrate: [0, 500, 200, 500],
            },
            trigger: {
              channelId: 'orders_urgent_v1',
            },
          });

          knownIds.push(order.id);
          await AsyncStorage.setItem('knownPendingOrderIds', JSON.stringify(knownIds));
        }
      }
    }
  } catch (err) {
    console.log('❌ Order check error:', err.message);
  }

  // ── ΑΝΕΒΑΣΜΑ ΤΟΠΟΘΕΣΙΑΣ ──
  if (!data) return;
  const { locations } = data;
  const location = locations?.[0];
  const driverId = await AsyncStorage.getItem('driverId');
  if (!driverId || !location) return;

  await supabase
    .from('drivers')
    .update({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    })
    .eq('id', driverId);
});