import React, { useState, useEffect, useRef } from 'react';
import { Alert, View, ActivityIndicator, AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, onBackendChange, onTokenRefresh, clearDriverPresenceEverywhere, getTenantSchema, consumeIntentionalSignOut, hardSignOut } from './supabase';
import { startNativeTracking, stopNativeTracking, ensureBatteryExemption, updateNativeToken } from './src/services/nativeLocationService';
import { readNativeTokens, cacheDriverProfile, readCachedDriverProfile } from './src/services/sessionStore';
// Εισαγωγή των Οθονών
import LoginScreen from './src/screens/LoginScreen';
import DriverDashboard from './src/screens/DriverDashboard';
import { Colors } from './src/styles/globalStyles';

// ─── Ρύθμιση notification handler (για foreground notifications) ──────────────
// Ο ήχος παίζεται ΜΟΝΟ μέσω FCM push notification (channel orders_urgent_v3).
// Δεν χρησιμοποιούμε expo-audio πλέον για ήχο παραγγελιών.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Στην ΑΝΑΘΕΣΗ/ΜΕΤΑΘΕΣΗ και στο ΜΗΝΥΜΑ ΚΕΝΤΡΟΥ, με ανοιχτή εφαρμογή, ο ήχος
    // του push θα έπεφτε πάνω στον αντίστοιχο in-app συναγερμό (realtime-driven,
    // ίδιο αρχείο, ξεκάθαρα διπλός) — και το banner πάνω στο in-app modal. Το push
    // υπάρχει για την κλειδωμένη/κλειστή οθόνη· σε foreground το σιωπαίνουμε.
    //
    // Τα 'reassign_away' και 'cancel' ΔΕΝ έχουν in-app αντίστοιχο: ο διανομέας
    // απλώς βλέπει μια γραμμή να εξαφανίζεται από τη λίστα του, χωρίς εξήγηση.
    // Γι' αυτά κρατάμε ΚΑΙ ήχο ΚΑΙ banner — αλλιώς δεν θα μάθει ποτέ τον λόγο.
    // Το 'driver_broadcast' (ανακοίνωση συναδέλφου: «έπαθα λάστιχο») έχει κι
    // αυτό in-app παράθυρο με δικό του ήχο μία φορά — χωρίς τη σιγή εδώ, ο
    // διανομέας θα άκουγε τον ίδιο ήχο δύο φορές με ανοιχτή την εφαρμογή.
    const kind = notification.request?.content?.data?.kind;
    const hasInAppUi = kind === 'assign' || kind === 'reassign' || kind === 'message'
      || kind === 'driver_broadcast';
    return {
      shouldShowBanner: !hasInAppUi,
      shouldShowList: !hasInAppUi,
      shouldPlaySound: !hasInAppUi,
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
  // ΠΡΟΕΠΙΛΟΓΗ ΣΚΟΥΡΟ: αυτή είναι η ταυτότητα της εφαρμογής (navy + χρυσό).
  // Πριν ήταν `false`, δηλαδή σε κάθε κρύα εκκίνηση ο διανομέας έβρισκε ανοιχτό
  // θέμα και ξανάκανε την ίδια εναλλαγή — δεν φαινόταν μόνο επειδή η οθόνη
  // εισόδου αγνοούσε τελείως το θέμα.
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [backendVersion, setBackendVersion] = useState(0);
  const myDeviceId = useRef(null);
  // Γίνεται true ΜΟΛΙΣ διαβαστεί η αποθηκευμένη επιλογή. Χωρίς αυτό, το effect
  // παρακάτω θα έγραφε την προεπιλογή πάνω στην αποθηκευμένη τιμή πριν προλάβει
  // να φορτωθεί, και η επιλογή του διανομέα θα χανόταν σε κάθε εκκίνηση.
  const themeLoaded = useRef(false);
  // Φρένο επανεισόδου: η ανάκτηση καλεί setSession, που σε αποτυχία βγάζει ΚΑΙ
  // ΑΥΤΗ 'SIGNED_OUT' — χωρίς το φρένο θα κυνηγούσε την ουρά της.
  const recoveringSession = useRef(false);
  // Γίνεται false μόνο σε επαναφορά από τοπικό αντίγραφο χωρίς απάντηση της
  // βάσης: τότε ΔΕΝ δηλώνουμε τη συσκευή ως ενεργή, γιατί δεν ξέρουμε αν ο
  // λογαριασμός έχει στο μεταξύ μετακομίσει σε άλλο κινητό.
  const deviceClaimAllowed = useRef(true);

  // Τελευταία ελπίδα όταν το token του JS είναι άκυρο: το native GPS service
  // κρατά τη δική του, μόνιμα αποθηκευμένη έκδοση (SharedPreferences) — αν αυτό
  // ανανέωσε τελευταίο, εκεί βρίσκεται το ζωντανό refresh token. Επιστρέφει το
  // session ή null. Το φρένο επανεισόδου είναι απαραίτητο: το setSession σε
  // αποτυχία βγάζει κι αυτό 'SIGNED_OUT', που ξανακαλεί αυτή τη συνάρτηση.
  const recoverSessionFromNative = async () => {
    if (recoveringSession.current) return null;
    recoveringSession.current = true;
    try {
      const native = readNativeTokens();
      if (!native.accessToken || !native.refreshToken) return null;
      const { data, error } = await supabase.auth.setSession({
        access_token: native.accessToken,
        refresh_token: native.refreshToken,
      });
      if (error || !data || !data.session) return null;
      console.log('[auth] η σύνδεση ανακτήθηκε από τα tokens του native service');
      return data.session;
    } catch (_) {
      return null;
    } finally {
      recoveringSession.current = false;
    }
  };

  // Κλείσιμο συνεδρίας από ΔΙΚΗ ΜΑΣ απόφαση — ποτέ από αποτυχία token.
  // `global`: ακυρώνει το session παντού (αποσύνδεση/μπλοκάρισμα από το κέντρο).
  // Τοπικό scope όταν ο λογαριασμός συνεχίζει σε ΑΛΛΗ συσκευή: δεν την ρίχνουμε μαζί μας.
  const endSession = async ({ global }) => {
    await hardSignOut({ global });
    setCurrentUser(null);
  };

  useEffect(() => {
    if (!themeLoaded.current) return;
    AsyncStorage.setItem('vertex-dark-mode', isDarkMode ? '1' : '0').catch(() => {});
  }, [isDarkMode]);

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
      // ΕΔΩ και όχι σε δικό του effect: το isInitializing κρατά την οθόνη στο
      // spinner, οπότε το θέμα προλαβαίνει να φορτώσει πριν ζωγραφιστεί
      // οτιδήποτε — αλλιώς θα άναβε μια στιγμή με λάθος χρώματα.
      try {
        const stored = await AsyncStorage.getItem('vertex-dark-mode');
        if (stored !== null) setIsDarkMode(stored === '1');
      } catch (_) {}
      themeLoaded.current = true;

      myDeviceId.current = await getDeviceId();
      const { data: sessionData } = await supabase.auth.getSession();
      // Αν το token του JS είναι πια άκυρο (κλασικά: το native ανανέωνε μόνο του
      // όσο η εφαρμογή ήταν σκοτωμένη), δοκιμάζουμε τα tokens του native ΠΡΙΝ
      // δείξουμε οθόνη εισόδου.
      const session = (sessionData && sessionData.session) || (await recoverSessionFromNative());
      if (session && session.user && session.user.id) {
        const { data: driver, error } = await supabase
          .from('drivers').select('*').eq('id', session.user.id).maybeSingle();

        if (error) {
          // Δεν απάντησε η βάση (δίκτυο, timeout, 5xx). ΔΕΝ ξέρουμε τίποτα για
          // τον λογαριασμό — άρα ΔΕΝ αποσυνδέουμε. Η άγνοια δεν είναι λόγος
          // αποσύνδεσης· ήταν ακριβώς έτσι που «έβγαινε» μόνος του ο διανομέας.
          // Μπαίνουμε με το τελευταίο γνωστό προφίλ, ΧΩΡΙΣ όμως να διεκδικήσουμε
          // τη συσκευή: αν στο μεταξύ ο λογαριασμός πήγε αλλού, θα το μάθουμε από
          // το πρώτο realtime update και θα αποσυνδεθούμε — δεν κλέβουμε εμείς
          // τη θέση της νέας συσκευής επειδή τυχαία δεν είχαμε δίκτυο.
          console.log('[auth] το προφίλ δεν φορτώθηκε, κρατάμε τη σύνδεση:', error.message);
          const cached = await readCachedDriverProfile(session.user.id);
          if (cached) {
            deviceClaimAllowed.current = false;
            setCurrentUser(cached);
          }
        } else if (!driver) {
          // Επιτυχές ερώτημα με μηδέν γραμμές → ο λογαριασμός δεν υπάρχει πια.
          await endSession({ global: false });
        } else if (driver.active_device_id && driver.active_device_id !== myDeviceId.current) {
          // Ο λογαριασμός συνδέθηκε σε ΑΛΛΗ συσκευή όσο ήμασταν κλειστοί.
          // Τοπικό scope: δεν ακυρώνουμε το session της νέας συσκευής.
          await endSession({ global: false });
        } else if (driver.is_active === false || driver.is_blocked === true) {
          await endSession({ global: true });
        } else {
          deviceClaimAllowed.current = true;
          setCurrentUser(driver);
          cacheDriverProfile(driver);
        }
      }
      setIsInitializing(false);
    }

    restoreSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'SIGNED_OUT') return;
      supabase.removeAllChannels();

      // Ηθελημένη αποσύνδεση (διανομέας / admin / άλλη συσκευή) → τέλος.
      if (consumeIntentionalSignOut()) {
        setCurrentUser(null);
        return;
      }

      // ΑΚΟΥΣΙΑ: το supabase-js έσβησε μόνο του το session επειδή απέτυχε η
      // ανανέωση του token. Τελευταία ελπίδα πριν πετάξουμε τον διανομέα έξω.
      if (await recoverSessionFromNative()) return;

      Alert.alert('Η σύνδεση διακόπηκε', 'Παρακαλώ συνδεθείτε ξανά.');
      setCurrentUser(null);
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
    // Το τοπικό αντίγραφο του προφίλ: καλύπτει και τη σύνδεση από την οθόνη
    // εισόδου, ώστε το επόμενο άνοιγμα να μπαίνει χωρίς να ρωτήσει τη βάση.
    cacheDriverProfile(currentUser);
    if (!deviceClaimAllowed.current) return;
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
          await endSession({ global: true });
        } else if (
          payload.new && payload.new.active_device_id &&
          myDeviceId.current && payload.new.active_device_id !== myDeviceId.current
        ) {
          // SINGLE-DEVICE: ο λογαριασμός συνδέθηκε σε ΑΛΛΗ συσκευή → αυτή αυτο-αποσυνδέεται.
          // ΟΧΙ clearDriverPresence (το row ανήκει πλέον στη νέα συσκευή) + local scope
          // ώστε να ΜΗΝ ακυρωθεί το session της νέας συσκευής.
          Alert.alert("Αποσύνδεση", "Ο λογαριασμός σας συνδέθηκε σε άλλη συσκευή.");
          supabase.removeAllChannels();
          await endSession({ global: false });
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
          //
          // ΓΙΑΤΙ Ο ΗΧΟΣ ΕΙΝΑΙ 20": με ΚΛΕΙΣΤΗ εφαρμογή τον ήχο τον παίζει το ίδιο
          // το Android από το κανάλι, ΜΙΑ ΦΟΡΑ και όσο κρατάει το αρχείο — δεν
          // υπάρχει ρύθμιση «επανάλαβε» ή «διάρκεια». Ο 20δευτερος συναγερμός του
          // DriverDashboard είναι in-app (expo-audio loop) και δεν μπορεί να τρέξει
          // χωρίς ανοιχτή εφαρμογή. Άρα ο ΜΟΝΟΣ τρόπος να χτυπήσει 20" με κλειστή
          // εφαρμογή είναι το ίδιο το αρχείο να διαρκεί 20" — γι' αυτό το
          // assignment.wav είναι ο ήχος σε 9 συνεχόμενους κύκλους (19,4").
          //
          // ΠΡΟΣΟΧΗ — ΓΙΑΤΙ «_v3»: οι ρυθμίσεις ενός καναλιού (ΚΑΙ ο ήχος) είναι
          // ΑΜΕΤΑΒΛΗΤΕΣ στο Android μετά την πρώτη δημιουργία σε κάθε συσκευή.
          // Αλλάζοντας ήχο εδώ ΔΕΝ διορθώνεται τίποτα σε ήδη εγκατεστημένη
          // εφαρμογή — πρέπει ΝΕΟ channel id, μαζί με το channel_id της
          // send-assignment-notification. Σβήνουμε ΚΑΙ τα δύο προηγούμενα: το _v1
          // μπορεί να έχει μείνει σε συσκευή που δεν πρόλαβε ποτέ το _v2.
          await Notifications.deleteNotificationChannelAsync('assignments_urgent_v1').catch(() => {});
          await Notifications.deleteNotificationChannelAsync('assignments_urgent_v2').catch(() => {});
          await Notifications.setNotificationChannelAsync('assignments_urgent_v3', {
            name: 'Αναθέσεις από τον διαχειριστή',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'assignment.wav',
            // Το μοτίβο δόνησης παίζει κι αυτό ΜΙΑ φορά, οπότε το γράφουμε ολόκληρο:
            // 16 × (800ms δόνηση + 400ms παύση) = 19,2" — όσο διαρκεί κι ο ήχος.
            vibrationPattern: [0, ...Array.from({ length: 16 }, () => [800, 400]).flat()],
            enableVibrate: true,
            bypassDnd: true,
          });

          // Ξεχωριστό κανάλι για ΜΗΝΥΜΑΤΑ από το κέντρο ελέγχου — δικός του ήχος,
          // ώστε ο διανομέας να ξεχωρίζει παραγγελία / ανάθεση / μήνυμα.
          await Notifications.setNotificationChannelAsync('messages_urgent_v1', {
            name: 'Μηνύματα από το κέντρο ελέγχου',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'message.wav',
            vibrationPattern: [0, 400, 200, 400],
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
    // Με φόντο θέματος — αλλιώς η εκκίνηση άναβε λευκή πριν εμφανιστεί το navy.
    const splash = Colors[isDarkMode ? 'dark' : 'light'];
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: splash.background }}>
        <ActivityIndicator size="large" color={splash.accent} />
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