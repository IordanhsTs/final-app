import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Animated, Switch, ScrollView, Dimensions } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Colors } from '../styles/globalStyles';

// ── Πλαϊνό μενού διανομέα (σχέδιο πελάτη 03/08/2026) ────────────────────────
// Αντικαθιστά το παλιό dropdown 230px με τρεις επιλογές. Είναι ΣΥΡΤΑΡΙ πλήρους
// ύψους που μπαίνει από αριστερά — από εκεί βγαίνει και το hamburger.
//
// ΤΟ ΘΕΜΑ ΚΑΙ Η ΕΞΟΔΟΣ ΜΕΝΟΥΝ ΚΑΤΩ ΑΠΟ ΓΡΑΜΜΗ: δεν είναι «σελίδες» της
// εφαρμογής αλλά ρυθμίσεις της συνεδρίας — το σχέδιο τα ξεχωρίζει και σωστά,
// γιατί αλλιώς η «Έξοδος» θα ήταν ένα ακόμη στοιχείο λίστας δίπλα στις
// «Ανακοινώσεις» και θα πατιόταν κατά λάθος.

const MENU_ITEMS = [
  { key: 'home',         label: 'Αρχική',                  icon: 'home',       lib: 'feather' },
  { key: 'history',      label: 'Ιστορικό & Στατιστικά',   icon: 'pie-chart',  lib: 'feather' },
  { key: 'availability', label: 'Διαθεσιμότητα εβδομάδας', icon: 'calendar',   lib: 'feather' },
  { key: 'schedule',     label: 'Το πρόγραμμά μου',        icon: 'clipboard',  lib: 'feather' },
  { key: 'announcements',label: 'Ανακοινώσεις',            icon: 'megaphone-outline', lib: 'ionicons' },
  { key: 'support',      label: 'Υποστήριξη',              icon: 'headset-outline',   lib: 'ionicons' },
];

/** Αρχικά ονόματος για το στρογγυλό «avatar»: «Αλέξανδρος Τσιγγέλης» → «ΑΤ». */
function initialsOf(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

export default function DriverMenu({
  visible, onClose, onNavigate, onLogout,
  isDarkMode, setIsDarkMode,
  driverName, isOnDuty, activeScreen, unreadAnnouncements,
}) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const width = Math.min(300, Dimensions.get('window').width * 0.82);
  const slide = useRef(new Animated.Value(-width)).current;

  // Το Modal εμφανίζεται με fade· το ίδιο το συρτάρι γλιστράει. Χωρίς αυτό
  // εμφανιζόταν απότομα στη θέση του και έμοιαζε με σφάλμα ζωγραφικής.
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -width,
      duration: visible ? 220 : 160,
      useNativeDriver: true,
    }).start();
  }, [visible, width, slide]);

  const renderIcon = (item, color, size = 21) =>
    item.lib === 'ionicons'
      ? <Ionicons name={item.icon} size={size} color={color} />
      : <Feather name={item.icon} size={size} color={color} />;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <Animated.View
          style={{
            width,
            backgroundColor: theme.surface,
            transform: [{ translateX: slide }],
            borderRightWidth: 1, borderRightColor: theme.border,
          }}
        >
          <ScrollView contentContainerStyle={{ paddingTop: 46, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {/* ── Ταυτότητα διανομέα ─────────────────────────────────────── */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 18, paddingBottom: 22 }}>
              <View style={{
                width: 48, height: 48, borderRadius: 24,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1.5, borderColor: theme.accent,
                backgroundColor: isDarkMode ? 'rgba(212,168,83,0.12)' : 'rgba(197,160,102,0.14)',
              }}>
                <Text style={{ color: theme.accent, fontWeight: '900', fontSize: 16 }}>
                  {initialsOf(driverName)}
                </Text>
              </View>

              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '900', fontSize: 15 }} numberOfLines={2}>
                  {driverName}
                </Text>
                {/* Η κουκκίδα δείχνει αν φτάνουν στίγματα GPS — την ίδια αλήθεια
                    με την μπάρα «Στίγμα» της αρχικής, όχι μια δεύτερη έννοια. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isOnDuty ? '#22C55E' : '#EF4444' }} />
                  <Text style={{ color: theme.subtitle, fontSize: 12, fontWeight: '600' }}>
                    {isOnDuty ? 'Ενεργός' : 'Χωρίς στίγμα'}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Οθόνες ─────────────────────────────────────────────────── */}
            {MENU_ITEMS.map((item) => {
              const on = activeScreen === item.key;
              const color = on ? theme.accent : theme.text;
              return (
                <TouchableOpacity
                  key={item.key}
                  activeOpacity={0.75}
                  onPress={() => onNavigate(item.key)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 14,
                    marginHorizontal: 10, marginBottom: 2,
                    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12,
                    backgroundColor: on
                      ? (isDarkMode ? 'rgba(212,168,83,0.16)' : 'rgba(197,160,102,0.18)')
                      : 'transparent',
                  }}
                >
                  {renderIcon(item, color)}
                  <Text style={{ color, fontSize: 15, fontWeight: on ? '900' : '600', flexShrink: 1 }}>
                    {item.label}
                  </Text>

                  {/* Αδιάβαστες ανακοινώσεις: κουκκίδα με αριθμό, χωρίς push
                      (απόφαση 03/08/2026 — δεν χτυπάμε το κινητό εν κινήσει). */}
                  {item.key === 'announcements' && unreadAnnouncements > 0 ? (
                    <View style={{
                      minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10,
                      backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '900' }}>{unreadAnnouncements}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}

            <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 16, marginHorizontal: 18 }} />

            {/* ── Θέμα ───────────────────────────────────────────────────── */}
            {/* Ολόκληρη η γραμμή πατιέται, όχι μόνο ο διακόπτης: με γάντια πάνω
                στη μηχανή, ένας διακόπτης 50px είναι δύσκολος στόχος. */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => setIsDarkMode(!isDarkMode)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 14,
                marginHorizontal: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12,
              }}
            >
              <Feather name={isDarkMode ? 'moon' : 'sun'} size={21} color={theme.text} />
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', flex: 1 }}>
                Θέμα εφαρμογής
              </Text>
              <Switch
                value={isDarkMode}
                onValueChange={setIsDarkMode}
                trackColor={{ false: '#9CA3AF', true: theme.accent }}
                thumbColor="#FFFFFF"
              />
            </TouchableOpacity>

            {/* ── Έξοδος ─────────────────────────────────────────────────── */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={onLogout}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 14,
                marginHorizontal: 10, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12,
              }}
            >
              <Feather name="log-out" size={21} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '800' }}>Έξοδος</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>

        {/* Πάτημα έξω από το συρτάρι = κλείσιμο */}
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      </View>
    </Modal>
  );
}
