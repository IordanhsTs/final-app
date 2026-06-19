import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, Alert, Platform, StyleSheet, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { supabase } from '../../supabase';

export default function LoginScreen({ setCurrentUser, isDarkMode, setIsDarkMode }) {
  const styles = createStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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

    // 2. Ανάκτηση δεδομένων προφίλ διανομέα από τη βάση
    // Αρχιτεκτονική Single Source of Truth: Ταύτιση αποκλειστικά με το Auth UUID
    const { data, error } = await supabase.from('drivers').select('*').eq('id', authData.user.id).single();

    if (data && !error) {
      await supabase.from('drivers').update({ is_active: true }).eq('id', data.id);
      setCurrentUser(data);
    } else {
      console.log('Profile Fetch Error:', error);
      Alert.alert('Σφάλμα', 'Ο λογαριασμός δεν βρέθηκε στο σύστημα διανομέων.');
      // Αν δεν βρεθεί προφίλ, αποσυνδέουμε ξανά για ασφάλεια
      await supabase.auth.signOut(); 
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.inner}>
          
          {/* Header & Logo */}
          <View style={styles.logoContainer}>
            <Text style={styles.title}>VERTEX</Text>
            <Text style={styles.subtitle}>PREMIUM DELIVERY NETWORK</Text>
          </View>

          {/* Login Card Wrapper for Light Rift Effect */}
          <View style={styles.cardWrapper}>
            <View style={styles.card}>

              {/* Form Inputs */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>EMAIL</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="name@example.com" 
                  placeholderTextColor="#8A7347"
                  keyboardType="email-address" 
                  onChangeText={setEmail} 
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>ΚΩΔΙΚΟΣ ΠΡΟΣΒΑΣΗΣ</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="Εισάγετε τον κωδικό σας" 
                  placeholderTextColor="#8A7347"
                  secureTextEntry={true}
                  onChangeText={setPassword} 
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                />
              </View>

              {/* Submit Button */}
              <TouchableOpacity 
                style={styles.buttonWrapper} 
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                <View style={styles.buttonBackground}>
                  <Text style={styles.buttonText}>{loading ? 'ΓΙΝΕΤΑΙ ΣΥΝΔΕΣΗ...' : 'ΕΙΣΟΔΟΣ'}</Text>
                </View>
              </TouchableOpacity>
              
            </View>
          </View>

        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212', // Πολύ σκούρο charcoal / ματ μαύρο
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    marginBottom: 48,
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: '#C5A066', // Χρυσό / Μπρούντζο
    letterSpacing: 4,
    textTransform: 'uppercase',
    textShadowColor: '#C5A06680',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 12,
    color: '#A0A0A0',
    marginTop: 8,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardWrapper: {
    borderRadius: 24,
    padding: 2, // Πάχος για το glowing border effect (Ρήγμα φωτός)
    backgroundColor: '#208AEF',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 10,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 22,
    padding: 24,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C5A066',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 1.5,
  },
  input: {
    height: 56,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#C5A066',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#EAD7B1',
  },
  buttonWrapper: {
    marginTop: 16,
    borderRadius: 12,
    shadowColor: '#C5A066',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonBackground: {
    backgroundColor: '#C5A066',
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#121212',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
