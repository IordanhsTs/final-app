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

  // --- PUSH NOTIFICATIONS SETUP (DISABLED FOR PLAN B2) ---
  useEffect(() => {
    async function setupPushNotifications() {
      if (!currentUser) return;
      try {
        // Δημιουργία καναλιού για τον ήχο
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('orders_channel_final', {
            name: 'Νέες Παραγγελίες',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
            sound: true, 
            enableVibrate: true,
          });
        }
        await Notifications.requestPermissionsAsync();
      } catch (e) {
        console.error('Error setting up notifications:', e);
      }
    }
    setupPushNotifications();
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