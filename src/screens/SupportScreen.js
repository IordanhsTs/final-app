import React from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, InfoBox, PrimaryButton } from './ScreenShell';

// ── Υποστήριξη — απλό κουμπί κλήσης (client feedback 08/08/2026) ────────────
// Πριν ήταν σκόπιμα άδεια (βλ. ιστορικό commit): ο πελάτης δεν είχε αποφασίσει
// ωράριο/τρόπο επικοινωνίας. Τώρα έδωσε ρητά το 23850-22500 «για αρχή» — απλό
// κουμπί κλήσης, εύκολο να αλλάξει το νούμερο αργότερα.
const SUPPORT_PHONE = '2385022500';
const SUPPORT_PHONE_DISPLAY = '23850-22500';

export default function SupportScreen({ currentUser, isDarkMode, onBack }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 40 }}>
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={currentUser.full_name} />

      <ScrollView contentContainerStyle={{ paddingBottom: 34 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 6, marginBottom: 16 }}>
          <Ionicons name="headset-outline" size={24} color={theme.accent} />
          <Text style={{ fontSize: 23, fontWeight: '900', color: theme.text, flexShrink: 1 }}>
            Υποστήριξη
          </Text>
        </View>

        <View style={{ alignItems: 'center', paddingHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ fontSize: 15, color: theme.subtitle, textAlign: 'center', marginBottom: 20 }}>
            Για οτιδήποτε προκύψει στη βάρδια, κάλεσε το κέντρο ελέγχου.
          </Text>
          <Text style={{ fontSize: 26, fontWeight: '900', color: theme.text, letterSpacing: 1 }}>
            {SUPPORT_PHONE_DISPLAY}
          </Text>
        </View>

        <PrimaryButton
          isDarkMode={isDarkMode}
          icon="phone-call"
          label="Κάλεσε"
          onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}
        />

        <View style={{ marginTop: 16 }}>
          <InfoBox isDarkMode={isDarkMode} icon="info">
            Το νούμερο είναι προσωρινό.
          </InfoBox>
        </View>
      </ScrollView>
    </View>
  );
}
