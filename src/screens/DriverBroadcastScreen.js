import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, ScreenTitle, InfoBox, PrimaryButton } from './ScreenShell';

// ── Ενημέρωση συναδέλφων (αίτημα πελάτη 08/08/2026) ─────────────────────────
// ΔΕΝ είναι chat. Ο διανομέας γράφει ΜΙΑ γραμμή («έπαθα λάστιχο», «πάω για
// βενζίνη»), τη στέλνει σε όσους είναι σε βάρδια, εκείνοι πατάνε ΟΚ και τελείωσε.
// Δεν υπάρχει ιστορικό, δεν υπάρχει απάντηση, δεν αποθηκεύεται τίποτα πουθενά.
//
// ΓΙ' ΑΥΤΟ ΔΕΝ ΥΠΑΡΧΕΙ ΛΙΣΤΑ ΑΠΕΣΤΑΛΜΕΝΩΝ σε αυτή την οθόνη: δεν θα ήταν
// «λείπει», θα ήταν ψέμα — δεν κρατιέται τίποτα για να δειχτεί.

// Όσο χωράει σε ειδοποίηση κλειδωμένης οθόνης χωρίς να κοπεί. Το ίδιο όριο
// επιβάλλει και το edge function.
const MAX_LEN = 160;

// Φρένο στο κατά λάθος διπλό πάτημα και στη σπαμ-αποστολή: ο ήχος χτυπά σε
// ΟΛΑ τα κινητά σε βάρδια, οπότε το κόστος ενός λάθους το πληρώνουν όλοι.
const COOLDOWN_S = 20;

export default function DriverBroadcastScreen({ currentUser, isDarkMode, onBack, onSend }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { tone: 'ok'|'warn'|'error', text }
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function startCooldown() {
    setCooldown(COOLDOWN_S);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(timer.current); timer.current = null; return 0; }
        return s - 1;
      });
    }, 1000);
  }

  async function handleSend() {
    const message = text.trim();
    if (!message || sending || cooldown > 0) return;

    setSending(true);
    setResult(null);
    try {
      const r = await onSend(message);

      // ΤΙ ΛΕΜΕ ΣΤΟΝ ΔΙΑΝΟΜΕΑ: όχι «εστάλη», αλλά ΠΟΥ έφτασε. Το «εστάλη
      // επιτυχώς» του κέντρου ελέγχου αφορούσε μόνο το broadcast και έκρυβε
      // αποτυχίες push — εδώ ξεχωρίζουμε ρητά τις δύο διαδρομές.
      if (r.pushed > 0) {
        setResult({ tone: 'ok', text: `Στάλθηκε σε ${r.pushed} ${r.pushed === 1 ? 'συνάδελφο' : 'συναδέλφους'} σε βάρδια.` });
      } else if (r.pushError) {
        setResult({
          tone: r.liveOk ? 'warn' : 'error',
          text: r.liveOk
            ? 'Δεν χτύπησε ειδοποίηση στα κινητά — θα το δουν μόνο όσοι έχουν ανοιχτή την εφαρμογή.'
            : 'Η ανακοίνωση δεν στάλθηκε. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.',
        });
      } else {
        setResult({ tone: 'warn', text: 'Κανένας άλλος διανομέας δεν είναι σε βάρδια αυτή τη στιγμή.' });
      }

      // Καθαρίζουμε το πεδίο ΜΟΝΟ αν έφυγε κάτι από τα δύο κανάλια. Αν έπεσαν
      // και τα δύο, το κείμενο μένει εκεί ώστε να πατήσει ξανά «Αποστολή» χωρίς
      // να το ξαναγράψει με γάντια πάνω στη μηχανή.
      const hardFail = !!r.pushError && !r.liveOk;
      if (!hardFail) {
        setText('');
        startCooldown();
      }
    } catch (e) {
      console.log('Broadcast send error:', e);
      setResult({ tone: 'error', text: 'Η ανακοίνωση δεν στάλθηκε. Δοκίμασε ξανά.' });
    } finally {
      setSending(false);
    }
  }

  const remaining = MAX_LEN - text.length;
  const resultColor = result?.tone === 'ok' ? '#22C55E' : result?.tone === 'warn' ? '#FBBF24' : '#EF4444';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 40 }}>
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={currentUser.full_name} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
          <ScreenTitle isDarkMode={isDarkMode} icon="radio">Ενημέρωση συναδέλφων</ScreenTitle>

          <InfoBox isDarkMode={isDarkMode} icon="users">
            Το μήνυμα φτάνει σε όσους διανομείς είναι σε βάρδια αυτή τη στιγμή, με τον
            ήχο των μηνυμάτων. Δεν αποθηκεύεται πουθενά και δεν μπορούν να απαντήσουν —
            βλέπουν το όνομά σου, την ώρα, και πατάνε ΟΚ.
          </InfoBox>

          <View style={{ marginHorizontal: 16, marginBottom: 10 }}>
            <TextInput
              value={text}
              onChangeText={(t) => setText(t.slice(0, MAX_LEN))}
              placeholder="π.χ. Έπαθα λάστιχο στην Καστοριάς, θα αργήσω."
              placeholderTextColor={theme.subtitle}
              multiline
              maxLength={MAX_LEN}
              textAlignVertical="top"
              style={{
                minHeight: 120,
                backgroundColor: theme.surface,
                borderWidth: 1, borderColor: theme.border, borderRadius: 16,
                padding: 14,
                fontSize: 16, lineHeight: 23, color: theme.text,
              }}
            />
            <Text style={{ alignSelf: 'flex-end', marginTop: 6, fontSize: 12, fontWeight: '700', color: remaining <= 20 ? '#FBBF24' : theme.subtitle }}>
              {remaining} χαρακτήρες ακόμα
            </Text>
          </View>

          {result ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginHorizontal: 16, marginBottom: 14 }}>
              <Feather
                name={result.tone === 'ok' ? 'check-circle' : result.tone === 'warn' ? 'alert-circle' : 'x-circle'}
                size={16}
                color={resultColor}
                style={{ marginTop: 2 }}
              />
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, fontWeight: '600', color: resultColor }}>
                {result.text}
              </Text>
            </View>
          ) : null}

          {sending ? (
            <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 6, marginBottom: 6 }} />
          ) : (
            <PrimaryButton
              isDarkMode={isDarkMode}
              icon="send"
              label={cooldown > 0 ? `Ξανά σε ${cooldown}″` : 'Αποστολή'}
              disabled={!text.trim() || cooldown > 0}
              onPress={handleSend}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
