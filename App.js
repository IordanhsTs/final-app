import React, { useState, useEffect } from 'react';
import { Alert, View, ActivityIndicator, AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Εισαγωγή των Οθονών
import LoginScreen from './src/screens/LoginScreen';
import DriverDashboard from './src/screens/DriverDashboard';

// ─── Ρύθμιση notification handler (για foreground notifications) ──────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // --- AUTH SESSION MANAGEMENT (AUTO-LOGIN) ---
  useEffect(() => {
    async function restoreSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user && session.user.id) {
        const { data: driver } = await supabase.from('drivers').select('*').eq('id', session.user.id).single();
        if (driver) {
          setCurrentUser(driver);
        }
      }
      setIsInitializing(false);
    }

    restoreSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // --- NOTIFICATION CHANNEL + PERMISSIONS + FCM TOKEN ---
  useEffect(() => {
    async function setupNotifications() {
      if (!currentUser) return;
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('orders_urgent_v1', {
            name: 'Παραγγελίες (Επείγον)',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'default',
            vibrationPattern: [0, 500, 200, 500],
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
        
        // Λήψη FCM Token (ΔΕΝ ΘΑ ΒΓΑΛΕΙ INVALID_SENDER ΠΛΕΟΝ)
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

  // --- SUPABASE REALTIME: Ακούει ΣΕ ΠΡΑΓΜΑΤΙΚΟ ΧΡΟΝΟ νέες παραγγελίες ---
  useEffect(() => {
    if (!currentUser) return;

    console.log('🔌 Σύνδεση στο Supabase Realtime...');

    const channel = supabase
      .channel('new-orders')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: 'status=eq.pending',
        },
        async (payload) => {
          const newOrder = payload.new;
          console.log('⚡ REALTIME: Νέα παραγγελία!', newOrder.id, newOrder.address);

          // 1. Τοπική ειδοποίηση
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🛵 Νέα Παραγγελία!',
                body: newOrder.address || 'Νέα παραγγελία στο σύστημα.',
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                vibrate: [0, 500, 200, 500],
              },
              trigger: {
                channelId: 'orders_urgent_v1',
              },
            });
          } catch (e) {
            console.log('Notification error:', e);
          }

          // 2. ΑΝΑΓΚΑΣΤΙΚΟΣ ΗΧΟΣ μέσω expo-av (παρακάμπτει τα πάντα)
          try {
            const { Audio } = require('expo-av');
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              staysActiveInBackground: true,
              playsInSilentModeIOS: true,
              shouldDuckAndroid: false,
              playThroughEarpieceAndroid: false,
            });
            const { sound } = await Audio.Sound.createAsync(
              require('./assets/notification.mp3'),
              { shouldPlay: true, volume: 1.0 }
            );
            console.log('🔊 ΗΧΟΣ ΑΝΑΠΑΡΑΓΩΓΗ!');
            // Αφήνουμε τον ήχο να παίξει και μετά τον ελευθερώνουμε
            sound.setOnPlaybackStatusUpdate((status) => {
              if (status.didJustFinish) {
                sound.unloadAsync();
              }
            });
          } catch (e) {
            console.log('Audio error:', e);
          }
        }
      )
      .subscribe((status) => {
        console.log('🔌 Realtime status:', status);
      });

    return () => {
      console.log('🔌 Αποσύνδεση από Realtime');
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  // --- LOCATION + BACKGROUND SERVICE SETUP ---
  useEffect(() => {
    async function setupLocationServices() {
      if (!currentUser) {
        // Logout: σταματάμε το background location task
        try {
          const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
          if (hasStarted) {
            await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
          }
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

      // Ζητάμε άδεια background location με try/catch (μην κρασάρει αν αρνηθεί)
      try {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          console.log('Background permission not granted');
        }
      } catch (e) {
        console.log('Error requesting background location:', e);
      }

      // Συνάρτηση για εκκίνηση του service
      const startService = async () => {
        try {
          const hasStarted = await Location.hasStartedLocationUpdatesAsync('background-location-task');
          if (!hasStarted) {
            await Location.startLocationUpdatesAsync('background-location-task', {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 10000,          // Αυστηρά κάθε 10 δευτερόλεπτα
              distanceInterval: 0,          // 0 ώστε να χτυπάει ακόμα κι αν το κινητό είναι εντελώς ακίνητο
              foregroundService: {
                notificationTitle: 'VERTEX - Σε βάρδια',
                notificationBody: 'Η εφαρμογή παρακολουθεί παραγγελίες...',
                notificationColor: '#208AEF',
                killServiceOnDestroy: false,
              },
              pausesUpdatesAutomatically: false,
              showsBackgroundLocationIndicator: true,
            });
            console.log('✅ Background Location Service ξεκίνησε');
          }
        } catch (e) {
          Alert.alert('Σφάλμα Foreground Service', String(e));
          console.error('Σφάλμα εκκίνησης background location:', e);
        }
      };

      // Ελέγχουμε αν η εφαρμογή είναι ενεργή ΠΡΙΝ ξεκινήσουμε το service
      // Αν ο χρήστης γύρισε από τις ρυθμίσεις τοποθεσίας, ίσως η εφαρμογή να είναι ακόμα στο background για λίγα ms.
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
  }, [currentUser]);

  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#208AEF" />
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
      currentUser={currentUser}
      setCurrentUser={setCurrentUser}
      isDarkMode={isDarkMode}
      setIsDarkMode={setIsDarkMode}
    />
  );
}