import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../styles/globalStyles';

// ── Κοινό «κέλυφος» για τις οθόνες του μενού ────────────────────────────────
// Οι νέες οθόνες (Διαθεσιμότητα / Πρόγραμμα / Ανακοινώσεις / Υποστήριξη /
// Ιστορικό) ανοίγουν ως full-screen Modal, όπως ήδη έκανε το Ιστορικό — η
// εφαρμογή δεν έχει react-navigation και δεν αξίζει να μπει ένα native
// dependency (θα απαιτούσε νέο build) για πέντε οθόνες.
//
// ΓΙΑΤΙ ΚΟΙΝΟ COMPONENT: πέντε οθόνες με πέντε αντιγραμμένες κεφαλίδες θα
// απέκλιναν στην πρώτη αλλαγή. Εδώ η κεφαλίδα ορίζεται μία φορά και είναι
// αυτούσια η κεφαλίδα του σχεδίου του πελάτη (βέλος επιστροφής αριστερά,
// «VERTEX DRIVER» στο κέντρο, όνομα διανομέα δεξιά).

export function ScreenHeader({ isDarkMode, onBack, driverName }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 15, paddingVertical: 12,
      backgroundColor: theme.background,
    }}>
      {/* Ίδιο πλάτος αριστερά/δεξιά ώστε ο τίτλος να πέφτει πραγματικά στη μέση */}
      <View style={{ width: 96, alignItems: 'flex-start' }}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityLabel="Επιστροφή"
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: isDarkMode ? theme.toggleBg : '#F0F0F0',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Feather name="arrow-left" size={22} color={isDarkMode ? '#FFF' : '#1E1A14'} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: '#C5A066', fontWeight: 'bold', letterSpacing: 1.5 }}>
          VERTEX DRIVER
        </Text>
      </View>

      <View style={{ width: 96, alignItems: 'flex-end' }}>
        <Text
          style={{ color: isDarkMode ? '#EAD7B1' : '#121212', fontSize: 13, fontWeight: 'bold', textAlign: 'right' }}
          numberOfLines={2}
        >
          {driverName}
        </Text>
      </View>
    </View>
  );
}

/** Ο μεγάλος τίτλος της οθόνης, με το χρυσό εικονίδιό του (όπως στο σχέδιο). */
export function ScreenTitle({ isDarkMode, icon, children }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 6, marginBottom: 16 }}>
      <Feather name={icon} size={24} color={theme.accent} />
      <Text style={{ fontSize: 23, fontWeight: '900', color: theme.text, flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Πλαίσιο πληροφορίας με χρυσό περίγραμμα — το «Οι ώρες που δηλώνεις ενδέχεται
 * να τροποποιηθούν…» του σχεδίου. Χρησιμοποιείται και αλλού (κλειδωμένη
 * εβδομάδα, άδειο πρόγραμμα).
 */
export function InfoBox({ isDarkMode, icon = 'info', children, tone = 'accent' }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const color = tone === 'warn' ? '#FBBF24' : theme.accent;

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      marginHorizontal: 16, marginBottom: 16,
      padding: 14, borderRadius: 16,
      borderWidth: 1, borderColor: color,
      backgroundColor: isDarkMode ? 'rgba(212,168,83,0.07)' : 'rgba(197,160,102,0.08)',
    }}>
      <Feather name={icon} size={20} color={color} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: theme.text }}>
        {children}
      </Text>
    </View>
  );
}

/** Κενή κατάσταση: εικονίδιο σε χρυσό κύκλο, τίτλος, εξήγηση. */
export function EmptyState({ isDarkMode, icon, title, subtitle }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  return (
    <View style={{ alignItems: 'center', paddingVertical: 46, paddingHorizontal: 28 }}>
      <View style={{
        width: 74, height: 74, borderRadius: 37, marginBottom: 18,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: isDarkMode ? 'rgba(212,168,83,0.10)' : 'rgba(197,160,102,0.12)',
        borderWidth: 1, borderColor: isDarkMode ? 'rgba(212,168,83,0.35)' : 'rgba(197,160,102,0.4)',
      }}>
        <Feather name={icon} size={30} color={theme.accent} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '900', color: theme.text, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ fontSize: 13.5, color: theme.subtitle, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Πλοήγηση εβδομάδας «‹  3 – 9 Αυγούστου  ›». Κοινή σε Διαθεσιμότητα και
 * Πρόγραμμα — οι δύο οθόνες πρέπει να δείχνουν την ίδια εβδομάδα με τον ίδιο
 * ακριβώς τρόπο, αλλιώς ο διανομέας δεν καταλαβαίνει ότι μιλάνε για το ίδιο πράγμα.
 */
export function WeekSwitcher({ isDarkMode, label, onPrev, onNext, badge }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const arrow = {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  };

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 14 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: theme.surface, borderRadius: 16,
        borderWidth: 1, borderColor: theme.border, padding: 6,
      }}>
        <TouchableOpacity onPress={onPrev} style={arrow} accessibilityLabel="Προηγούμενη εβδομάδα">
          <Feather name="chevron-left" size={24} color={theme.accent} />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: theme.text }}>{label}</Text>
          {badge ? (
            <Text style={{ fontSize: 11, fontWeight: '700', color: theme.subtitle, marginTop: 2 }}>{badge}</Text>
          ) : null}
        </View>

        <TouchableOpacity onPress={onNext} style={arrow} accessibilityLabel="Επόμενη εβδομάδα">
          <Feather name="chevron-right" size={24} color={theme.accent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Χρυσό κουμπί σε όλο το πλάτος — η κύρια ενέργεια κάθε οθόνης. */
export function PrimaryButton({ isDarkMode, icon, label, onPress, disabled }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginHorizontal: 16, height: 54, borderRadius: 14,
        backgroundColor: theme.accent,
        opacity: disabled ? 0.45 : 1,
        shadowColor: theme.accent, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35, shadowRadius: 8, elevation: 5,
      }}
    >
      {icon ? <Feather name={icon} size={19} color={isDarkMode ? '#0B1020' : '#1E1A14'} /> : null}
      <Text style={{
        color: isDarkMode ? '#0B1020' : '#1E1A14',
        fontSize: 14, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase',
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
