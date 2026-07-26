import React, { useState, useEffect, useRef } from 'react';
import { Alert, View, ActivityIndicator, AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, onBackendChange, onTokenRefresh, clearDriverPresenceEverywhere, getTenantSchema } from './supabase';
import { startNativeTracking, stopNativeTracking, ensureBatteryExemption, updateNativeToken } from './src/services/nativeLocationService';
// Εισαγωγή των Οθονών
import LoginScreen from './src/screens/LoginScreen';
import DriverDashboard from './src/screens/DriverDashboard';

// ─── Ρύθμιση notification handler (για foreground notifications) ──────────────
// Ο ήχος παίζεται ΜΟΝΟ μέσω FCM push notification (channel orders_urgent_v3).
// Δεν χρησιμοποιούμε expo-audio πλέον για ήχο παραγγελιών.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Στην ΑΝΑΘΕΣΗ με ανοιχτή εφαρμογή ο ήχος του push θα έπεφτε πάνω στον
    // 15δευτερο in-app συναγερμό (ίδιο αρχείο, ξεκάθαρα διπλός). Το push
    // υπάρχει για την κλειδωμένη οθόνη — σε foreground το σιωπαίνουμε.
    const isAssignment = notification.request?.content?.data?.kind === 'assign'
      || notification.request?.content?.data?.kind === 'reassign';
    return {
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: !isAssignment,
      shouldSetBadge: false,
    };
  },
});

// ─── SINGLE-DEVICE: σταθερό αναγνωριστικό συσκευής ────────────────────────────
// Δημιουργείται μία φορά ανά εγκατάσταση και μένει στο AsyncStorage. Χρησιμεύει
// για να επιβάλλουμε «ένας λογαριασμός = μία ενεργή συσκευή».
async function getDeviceId() {
  let id = await AsyncStorage.getItem('vertex-device-id');
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem('vertex-device-id', id);
  }
  return id;
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [backendVersion, setBackendVersion] = useState(0);
  const myDeviceId = useRef(null);

  // --- FAILOVER: όταν αλλάξει backend, ξανατρέχουν τα effects (channels, GPS) ---
  useEffect(() => {
    const unsubscribe = onBackendChange(() => setBackendVersion((v) => v + 1));
    return unsubscribe;
  }, []);

  // --- TOKEN FEED: ο JS client (μόνος refresher) ταΐζει το native GPS service με το
  //     φρέσκο token σε κάθε ανανέωση, ώστε να μη αποκλίνουν οι αλυσίδες refresh token
  //     (αιτία του logout + παγωμένου στίγματος). ---
  useEffect(() => {
    const unsubscribe = onTokenRefresh((accessToken, refreshToken) => {
      updateNativeToken(accessToken, refreshToken);
    });
    return unsubscribe;
  }, []);

  // --- AUTH SESSION MANAGEMENT (AUTO-LOGIN) ---
  useEffect(() => {
    async function restoreSession() {
      myDeviceId.current = await getDeviceId();
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user && session.user.id) {
        const { data: driver } = await supabase.from('drivers').select('*').eq('id', session.user.id).single();
        if (driver) {
          // Ο λογαριασμός συνδέθηκε σε ΑΛΛΗ συσκευή όσο ήμασταν κλειστοί → όχι auto-login.
          const supersededByOtherDevice =
            driver.active_device_id && driver.active_device_id !== myDeviceId.current;
          if (supersededByOtherDevice) {
            await supabase.auth.signOut({ scope: 'local' });
          } else if (driver.is_active === false || driver.is_blocked === true) {
            await supabase.auth.signOut();
          } else {
            setCurrentUser(driver);
          }
        }
      }
      setIsInitializing(false);
    }

    restoreSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        supabase.removeAllChannels();
        setCurrentUser(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // --- SINGLE-DEVICE: μόλις συνδεθεί ο χρήστης, «δηλώνει» αυτή τη συσκευή ως την
  //     ενεργή. Αν ο ίδιος λογαριασμός συνδεθεί αλλού, αλλάζει το active_device_id
  //     και οι προηγούμενες συσκευές αυτο-αποσυνδέονται (βλ. status listener). ---
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const deviceId = await getDeviceId();
        myDeviceId.current = deviceId;
        await supabase.from('drivers').update({ active_device_id: deviceId }).eq('id', currentUser.id);
      } catch (_) {}
    })();
  }, [currentUser]);

  // --- LISTEN FOR ADMIN DEACTIVATION ---
  useEffect(() => {
    if (!currentUser) return;

    const statusChannel = supabase
      .channel(`driver_status_${currentUser.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: getTenantSchema(), table: 'drivers', filter: `id=eq.${currentUser.id}` }, async (payload) => {
        if (payload.new && (payload.new.is_active === false || payload.new.is_blocked === true)) {
          const msg = payload.new.is_blocked ? "Ο λογαριασμός σας έχει μπλοκαριστεί." : "Η βάρδια σας τερματίστηκε από το κέντρο ελέγχου.";
          Alert.alert("Αποσύνδεση", msg);
          await clearDriverPresenceEverywhere(currentUser.id);
          supabase.removeAllChannels();
          await supabase.auth.signOut();
          setCurrentUser(null);
        } else if (
          payload.new && payload.new.active_device_id &&
          myDeviceId.current && payload.new.active_device_id !== myDeviceId.current
        ) {
          // SINGLE-DEVICE: ο λογαριασμός συνδέθηκε σε ΑΛΛΗ συσκευή → αυτή αυτο-αποσυνδέεται.
          // ΟΧΙ clearDriverPresence (το row ανήκει πλέον στη νέα συσκευή) + local scope
          // ώστε να ΜΗΝ ακυρωθεί το session της νέας συσκευής.
          Alert.alert("Αποσύνδεση", "Ο λογαριασμός σας συνδέθηκε σε άλλη συσκευή.");
          supabase.removeAllChannels();
          await supabase.auth.signOut({ scope: 'local' });
          setCurrentUser(null);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(statusChannel);
    };
  }, [currentUser, backendVersion]);

  // --- NOTIFICATION CHANNEL + PERMISSIONS + FCM TOKEN ---
  useEffect(() => {
    async function setupNotifications() {
      if (!currentUser) return;
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('orders_urgent_v3', {
            name: 'Παραγγελίες (Επείγον)',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'notification.mp3',
            vibrationPattern: [0, 500, 200, 500],
            enableVibrate: true,
            bypassDnd: true,
          });

          // Ξεχωριστό κανάλι για την ΑΝΑΘΕΣΗ/ΜΕΤΑΘΕΣΗ: ο διανομέας μπορεί να
          // οδηγεί με το κινητό στην τσέπη, οπότε θέλει τον δυνατό/μακρύ ήχο
          // συναγερμού και όχι το σύντομο «νέα παραγγελία».
          await Notifications.setNotificationChannelAsync('assignments_urgent_v1', {
            name: 'Αναθέσεις από τον διαχειριστή',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'alarm.mp3',
            vibrationPattern: [0, 800, 300, 800, 300, 800],
            enableVibrate: true,
            bypassDnd: true,
          });
        }
        
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.log('❌ Notification permission not granted');
          return;
        }
        
        console.log('✅ Notification setup OK, ζητάω FCM Token...');
        
        // Λήψη FCM Token
        const tokenData = await Notifications.getDevicePushTokenAsync();
        const fcmToken = tokenData.data;
        console.log('✅ FCM Token:', fcmToken);

        await supabase
          .from('drivers')
          .update({ fcm_token: fcmToken })
          .eq('id', currentUser.id);

      } catch (e) {
        console.log('Notification setup error:', e);
      }
    }
    setupNotifications();
  }, [currentUser]);

  // --- LOCATION + BACKGROUND SERVICE SETUP ---
  useEffect(() => {
    async function setupLocationServices() {
      if (!currentUser) {
        // Logout: σταματάμε το background location task
        try {
          stopNativeTracking();
        } catch (_) {}
        await AsyncStorage.removeItem('driverId');
        await AsyncStorage.removeItem('knownPendingOrderIds');
        return;
      }

      // Login: αποθηκεύουμε το driverId για τα background tasks
      await AsyncStorage.setItem('driverId', currentUser.id);

      // Ζητάμε άδεια foreground location
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('Προσοχή', 'Η τοποθεσία είναι απαραίτητη για τη λειτουργία της εφαρμογής.');
        return;
      }

      // Έλεγχος αν δόθηκε "Κατά προσέγγιση" (Approximate) αντί για "Ακριβής" (Precise) τοποθεσία
      const fgPerm = await Location.getForegroundPermissionsAsync();
      if (fgPerm && fgPerm.android && fgPerm.android.accuracy === 'coarse') {
        Alert.alert(
          'Λάθος Άδεια Τοποθεσίας', 
          'Έχετε επιλέξει "Κατά προσέγγιση" τοποθεσία. Αυτό προκαλεί απόκλιση χιλιομέτρων στον χάρτη!\n\nΠαρακαλούμε πηγαίνετε στις Ρυθμίσεις του κινητού -> Άδειες και ενεργοποιήστε την "Ακριβή Τοποθεσία" (Precise Location).'
        );
      }

      // Ζητάμε άδεια background location
      try {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          Alert.alert(
            '⚠️ Απαιτείται Άδεια Τοποθεσίας',
            'Για να λειτουργεί το GPS tracking με κλειστή οθόνη, ΠΡΕΠΕΙ να επιλέξετε:\n\n"Να επιτρέπεται πάντα" (Allow all the time)\n\nΠηγαίνετε: Ρυθμίσεις → Εφαρμογές → Vertex → Άδειες → Τοποθεσία → "Να επιτρέπεται πάντα"',
            [{ text: 'OK' }]
          );
        }
      } catch (e) {
        console.log('Error requesting background location:', e);
      }

      // ΕΠΑΛΗΘΕΥΣΗ: Ελέγχουμε τι άδεια δόθηκε πραγματικά
      const bgPerm = await Location.getBackgroundPermissionsAsync();
      console.log('📍 Background Location Permission status:', bgPerm.status);
      await AsyncStorage.setItem('locationPermissionStatus', bgPerm.status);

      // Συνάρτηση για εκκίνηση του service
      const startService = async () => {
        try {
          // WARM-UP του GPS: Ζητάμε αμέσως μία ακριβή τοποθεσία για να "ξυπνήσει" το τσιπ του GPS
          const initialLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
          });
          console.log("📍 WARM-UP GPS Location:", initialLocation.coords);

          // Στέλνουμε αμέσως την πρώτη σωστή τοποθεσία στη βάση
          await supabase
            .from('drivers')
            .update({
              latitude: initialLocation.coords.latitude,
              longitude: initialLocation.coords.longitude,
            })
            .eq('id', currentUser.id);

          // --- NATIVE FOREGROUND SERVICE (WakeLock + FusedLocation, bypass JS bridge) ---
          await ensureBatteryExemption();   // δείχνει το system dialog την 1η φορά
          await startNativeTracking(currentUser.id);



        } catch (e) {
          Alert.alert('Σφάλμα Background Service', String(e));
          console.error('Σφάλμα εκκίνησης background location:', e);
        }
      };

      // Ελέγχουμε αν η εφαρμογή είναι ενεργή ΠΡΙΝ ξεκινήσουμε το service
      if (AppState.currentState === 'active') {
        await startService();
      } else {
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
          if (nextAppState === 'active') {
            subscription.remove();
            await startService();
          }
        });
      }
    }

    setupLocationServices();
  }, [currentUser, backendVersion]);

  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#C5A066" />
      </View>
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        setCurrentUser={setCurrentUser}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />
    );
  }

  return (
    <DriverDashboard
      key={backendVersion}
      currentUser={currentUser}
      setCurrentUser={setCurrentUser}
      isDarkMode={isDarkMode}
      setIsDarkMode={setIsDarkMode}
    />
  );
}