import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Switch, ScrollView, Dimensions, BackHandler } from 'react-native';
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
  driverName, isOnDuty, lastLocationUpdate, activeScreen, unreadAnnouncements,
}) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const width = Math.min(300, Dimensions.get('window').width * 0.82);
  const slide = useRef(new Animated.Value(-width)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  // ΧΩΡΙΣ native <Modal> (αίτημα πελάτη 04/08/2026): το <Modal transparent
  // animationType="fade"> έτρεχε ΔΙΚΟ ΤΟΥ native fade πάνω στο ίδιο το
  // Android Window ΤΑΥΤΟΧΡΟΝΑ με αυτό το χειροκίνητο slide — δύο ανεξάρτητα
  // animation, το ένα εκτός ελέγχου του JS. Σε μερικές συσκευές το native
  // dim του Window δεν καθάριζε πλήρως μετά το κλείσιμο, και ό,τι χρώμα
  // υπήρχε από κάτω (π.χ. η πράσινη κουκκίδα στίγματος του header) έμενε
  // ελαφρώς σκουρότερο. Τώρα το σκοτάδι πίσω από το συρτάρι είναι ΔΙΚΟ ΜΑΣ
  // Animated.Value (backdrop) — ένα animation, πλήρως ελεγχόμενο, μηδενίζει
  // εγγυημένα στο κλείσιμο.
  //
  // `mounted` κρατά το συρτάρι ζωντανό ΟΣΟ διαρκεί το slide-out· χωρίς αυτό
  // θα εξαφανιζόταν ακαριαία αντί να γλιστρήσει έξω.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 0 : -width,
        duration: visible ? 220 : 160,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: visible ? 1 : 0,
        duration: visible ? 220 : 160,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, width, slide, backdrop]);

  // Το πλήκτρο «πίσω» του Android έκλεινε το συρτάρι μέσω του onRequestClose
  // του Modal — τώρα που δεν υπάρχει Modal, το αναλαμβάνουμε εμείς.
  useEffect(() => {
    if (!mounted) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mounted, onClose]);

  const renderIcon = (item, color, size = 21) =>
    item.lib === 'ionicons'
      ? <Ionicons name={item.icon} size={size} color={color} />
      : <Feather name={item.icon} size={size} color={color} />;

  if (!mounted) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, elevation: 999 }}>
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.55)', opacity: backdrop }}
      >
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
                {/* Η αναλυτική γραμμή στίγματος (ώρα τελευταίου GPS update) ζούσε
                    πριν σε δική της μπάρα κάτω από τον header της αρχικής —
                    μετακόμισε εδώ (αίτημα πελάτη 04/08/2026), στον header έμεινε
                    μόνο μια μικρή κουκκίδα δίπλα στο «VERTEX DRIVER». Η κουκκίδα
                    δείχνει την ίδια αλήθεια GPS με εκείνη, όχι μια δεύτερη έννοια. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Feather name="map-pin" size={11} color={theme.subtitle} />
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isOnDuty ? '#22C55E' : '#EF4444' }} />
                  <Text style={{ color: theme.subtitle, fontSize: 12, fontWeight: '600' }}>
                    Στίγμα: {lastLocationUpdate}
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
      </Animated.View>
    </View>
  );
}
