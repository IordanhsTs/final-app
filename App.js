import React, { useState, useEffect } from 'react';
import { Alert, View, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from './supabase';

// Εισαγωγή του Background Task για να αρχικοποιηθεί
import './src/services/backgroundTasks'; 

// Εισαγωγή των Οθονών
import LoginScreen from './src/screens/LoginScreen';
import StoreDashboard from './src/screens/StoreDashboard';
import DriverDashboard from './src/screens/DriverDashboard';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [locationSubscription, setLocationSubscription] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // --- AUTH SESSION MANAGEMENT (AUTO-LOGIN) ---
  useEffect(() => {
    async function restoreSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user && session.user.id) {
        // Ψάχνουμε αν είναι διανομέας
        const { data: driver } = await supabase.from('drivers').select('*').eq('id', session.user.id).single();
        if (driver) {
          setUserRole('driver');
          setCurrentUser(driver);
        } else {
          // Αν δεν είναι, ψάχνουμε αν είναι κατάστημα
          const { data: store } = await supabase.from('stores').select('*').eq('id', session.user.id).single();
          if (store) {
            setUserRole('store');
            setCurrentUser(store);
          }
        }
      }
      setIsInitializing(false); // Τέλος φόρτωσης
    }

    restoreSession();

    // Ακούμε για τυχόν αλλαγές (π.χ. αν πατήσει Έξοδος)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setUserRole(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function setupLocation() {
      if (userRole === 'driver' && currentUser) {
        
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Προσοχή', 'Η τοποθεσία είναι απαραίτητη.');
          return;
        }

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          async (location) => {
            console.log("📍 Στίγμα στάλθηκε:", location.coords.latitude, location.coords.longitude);
            await supabase
              .from('drivers')
              .update({ 
                latitude: location.coords.latitude, 
                longitude: location.coords.longitude 
              })
              .eq('id', currentUser.id);
          }
        );
        
        setLocationSubscription(sub);
      } else {
        if (locationSubscription) {
          locationSubscription.remove();
          setLocationSubscription(null);
        }
      }
    }

    setupLocation();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [currentUser, userRole]);

  // Δείχνουμε ένα loading όσο ελέγχει αν ο χρήστης είναι ήδη συνδεδεμένος
  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#208AEF" />
      </View>
    );
  }

  // --- ROUTER (Επιλογή Οθόνης) ---
  if (!currentUser) {
    return (
      <LoginScreen 
        setCurrentUser={setCurrentUser} 
        setUserRole={setUserRole} 
        isDarkMode={isDarkMode} 
        setIsDarkMode={setIsDarkMode} 
      />
    );
  }

  if (userRole === 'store') {
    return (
      <StoreDashboard 
        currentUser={currentUser} 
        setCurrentUser={setCurrentUser} 
        isDarkMode={isDarkMode} 
        setIsDarkMode={setIsDarkMode} 
      />
    );
  }

  if (userRole === 'driver') {
    return (
      <DriverDashboard 
        currentUser={currentUser} 
        setCurrentUser={setCurrentUser} 
        isDarkMode={isDarkMode} 
        setIsDarkMode={setIsDarkMode} 
      />
    );
  }
}