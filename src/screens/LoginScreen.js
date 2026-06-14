import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, Alert, Platform } from 'react-native'; // Προστέθηκε το Platform
import { supabase } from '../../supabase';
import { getStyles } from '../styles/globalStyles';

export default function LoginScreen({ setCurrentUser, setUserRole, isDarkMode, setIsDarkMode }) {
  const styles = getStyles(isDarkMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState('driver');

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Σφάλμα', 'Παρακαλώ συμπληρώστε email και κωδικό.');
      return;
    }
    setLoading(true);
    
    // 1. Σύνδεση στο επίσημο σύστημα Authentication του Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });

    if (authError) {
      Alert.alert('Αποτυχία Σύνδεσης', 'Λάθος email ή κωδικός.');
      setLoading(false);
      return;
    }

    // 2. Ανάκτηση δεδομένων προφίλ του χρήστη από τη βάση
    const table = selectedRole === 'driver' ? 'drivers' : 'stores';
    const { data, error } = await supabase.from(table).select('*').eq('email', email.trim()).single();

    if (data && !error) {
      if (selectedRole === 'driver') await supabase.from('drivers').update({ is_active: true }).eq('id', data.id);
      setUserRole(selectedRole);
      setCurrentUser(data);
    } else {
      console.log('Profile Fetch Error:', error);
      Alert.alert('Σφάλμα', `Ο λογαριασμός βρέθηκε, αλλά λείπει από τον πίνακα των ${selectedRole === 'driver' ? 'διανομέων' : 'καταστημάτων'}.`);
      // Αν δεν βρεθεί προφίλ στον ρόλο που επέλεξε, τον αποσυνδέουμε ξανά για ασφάλεια
      await supabase.auth.signOut(); 
    }
    setLoading(false);
  }

  return (
    <View style={styles.containerCenter}>
      <Text style={styles.title}>Delivery System</Text>
      
      <View style={styles.roleToggle}>
        <TouchableOpacity style={[styles.toggleBtn, selectedRole === 'driver' && styles.toggleBtnActive]} onPress={() => setSelectedRole('driver')}>
          <Text style={[styles.toggleText, selectedRole === 'driver' && styles.toggleTextActive, { color: selectedRole === 'driver' ? (isDarkMode ? '#60A5FA' : '#208AEF') : (isDarkMode ? '#AAAAAA' : '#555555') }]}>🛵 Διανομέας</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toggleBtn, selectedRole === 'store' && styles.toggleBtnActive]} onPress={() => setSelectedRole('store')}>
          <Text style={[styles.toggleText, selectedRole === 'store' && styles.toggleTextActive, { color: selectedRole === 'store' ? (isDarkMode ? '#60A5FA' : '#208AEF') : (isDarkMode ? '#AAAAAA' : '#555555') }]}>🏢 Κατάστημα</Text>
        </TouchableOpacity>
      </View>

      <TextInput 
        style={styles.input} 
        placeholder="Email" 
        placeholderTextColor={isDarkMode ? '#AAAAAA' : '#888888'}
        keyboardType="email-address" 
        onChangeText={setEmail} 
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
      />

      <TextInput 
        style={styles.input} 
        placeholder="Κωδικός πρόσβασης" 
        placeholderTextColor={isDarkMode ? '#AAAAAA' : '#888888'}
        secureTextEntry={true}
        onChangeText={setPassword} 
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />

      <TouchableOpacity 
        style={[styles.button, { 
          backgroundColor: selectedRole === 'driver' ? (isDarkMode ? '#3B82F6' : '#208AEF') : (isDarkMode ? '#A855F7' : '#8E44AD'), 
          shadowColor: selectedRole === 'driver' ? '#208AEF' : '#8E44AD' 
        }]} 
        onPress={handleLogin}
      >
        <Text style={styles.buttonTextWhite}>{loading ? '...' : 'Είσοδος'}</Text>
      </TouchableOpacity>
    </View>
  );
}