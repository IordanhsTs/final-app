import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, EmptyState, InfoBox } from './ScreenShell';

// ── Υποστήριξη — σκόπιμα άδεια (αίτημα πελάτη 03/08/2026) ───────────────────
// Ο πελάτης φαντάζεται έναν υπάλληλο γραφείου διαθέσιμο κάποιες μέρες, αλλά δεν
// έχει αποφασιστεί τίποτα (ποιες ώρες, με ποιον τρόπο επικοινωνίας). Μπαίνει η
// θέση στο μενού με ειλικρινές μήνυμα αντί για μισοφτιαγμένη λειτουργία που θα
// έστελνε τον διανομέα σε αδιέξοδο μέσα στη βάρδια.

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

        <EmptyState
          isDarkMode={isDarkMode}
          icon="tool"
          title="Έρχεται σύντομα"
          subtitle="Η υποστήριξη μέσα από την εφαρμογή ετοιμάζεται και θα ενεργοποιηθεί σε επόμενη ενημέρωση."
        />

        <InfoBox isDarkMode={isDarkMode} icon="phone">
          Μέχρι τότε, για οτιδήποτε προκύψει στη βάρδια επικοινώνησε απευθείας με
          το κέντρο ελέγχου.
        </InfoBox>
      </ScrollView>
    </View>
  );
}
