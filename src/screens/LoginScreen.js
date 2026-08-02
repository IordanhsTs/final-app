import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, Alert, Platform, StyleSheet, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../supabase';
import { Colors } from '../styles/globalStyles';

export default function LoginScreen({ setCurrentUser, isDarkMode }) {
  // Η οθόνη είχε ΚΑΡΦΩΤΑ μαύρο/χρυσό styles και δεν διάβαζε καθόλου το
  // globalStyles — γι' αυτό είχε μείνει εκτός της αλλαγής παλέτας (navy + χρυσό)
  // και ήταν η μόνη οθόνη με διαφορετική ταυτότητα. Τώρα παίρνει τα ίδια tokens.
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const styles = createStyles(theme, isDarkMode);
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
      if (data.is_blocked === true) {
        Alert.alert('Λογαριασμός Μπλοκαρισμένος', 'Η πρόσβαση στο λογαριασμό σας έχει διακοπεί.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
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

          {/* Το χρυσό περίγραμμα είναι GRADIENT, όπως στην ενεργή καρτέλα του
              dashboard — έτσι οι δύο οθόνες μοιράζονται την ίδια χειρονομία αντί
              για ένα επίπεδο χρυσό πλαίσιο που δεν θύμιζε τίποτα άλλο. */}
          <LinearGradient
            colors={[theme.accent, isDarkMode ? 'rgba(212,168,83,0.18)' : 'rgba(197,160,102,0.22)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardWrapper}
          >
            <View style={styles.card}>

              {/* Form Inputs */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>EMAIL</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="name@example.com"
                  placeholderTextColor={theme.subtitle}
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
                  placeholderTextColor={theme.subtitle}
                  secureTextEntry={true}
                  onChangeText={setPassword} 
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                />
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.buttonWrapper, loading && { opacity: 0.6 }]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                <View style={styles.buttonBackground}>
                  <Text style={styles.buttonText}>{loading ? 'ΓΙΝΕΤΑΙ ΣΥΝΔΕΣΗ...' : 'ΕΙΣΟΔΟΣ'}</Text>
                </View>
              </TouchableOpacity>

            </View>
          </LinearGradient>

        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background, // βαθύ navy (dark) / κρεμ (light)
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
    color: theme.accent,
    letterSpacing: 4,
    textTransform: 'uppercase',
    // Η λάμψη έχει νόημα μόνο πάνω στο σκούρο· στο κρεμ θόλωνε τα γράμματα.
    textShadowColor: isDark ? 'rgba(212,168,83,0.45)' : 'transparent',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 12,
    color: theme.subtitle,
    marginTop: 8,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardWrapper: {
    borderRadius: 24,
    padding: 1.5, // πάχος του gradient περιγράμματος
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: isDark ? 0.5 : 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 22.5,
    padding: 24,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.accent,
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 1.5,
  },
  input: {
    height: 56,
    // ΟΧΙ διάφανο με χρυσό περίγραμμα (όπως πριν): πάνω στο navy το πεδίο
    // εξαφανιζόταν μέσα στην κάρτα. Χρειάζεται δική του, ανοιχτότερη επιφάνεια —
    // στο σκούρο η `surface` ΤΑΥΤΙΖΕΤΑΙ με την κάρτα, γι' αυτό `toggleBg`.
    backgroundColor: isDark ? theme.toggleBg : theme.inputBg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.text,
  },
  buttonWrapper: {
    marginTop: 16,
    borderRadius: 12,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonBackground: {
    backgroundColor: theme.accent,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    // Σκούρο κείμενο ΠΑΝΩ στο χρυσό — και στα δύο θέματα. Το `theme.background`
    // του ανοιχτού είναι κρεμ και θα ήταν αδιάβαστο εδώ.
    color: isDark ? theme.background : theme.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
