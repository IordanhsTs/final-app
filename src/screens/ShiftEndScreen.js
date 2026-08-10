import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabase';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, ScreenTitle, InfoBox, PrimaryButton, OdometerInput, formatOdometer } from './ScreenShell';

// ── Λήξη βάρδιας με ένδειξη κοντέρ (αίτημα πελάτη 10/08/2026) ───────────────
// Η οθόνη που αντικαθιστά τον χιλιομετρητή GPS. Ο διανομέας κοιτάζει το κοντέρ
// στο τέλος της βάρδιας και γράφει το νούμερο· χιλιόμετρα βάρδιας = τελικό −
// αρχικό. Εμφανίζεται σε ΔΥΟ σημεία (και τα δύο ζητήθηκαν ρητά):
//   • «Λήξη βάρδιας» από το μενού — για όποιον σχολάει χωρίς να αποσυνδεθεί
//   • πριν την «Έξοδο» — γιατί η έξοδος ΕΙΝΑΙ λήξη βάρδιας
//
// ⚠ ΓΙΑΤΙ ΔΕΝ ΕΙΝΑΙ ΥΠΟΧΡΕΩΤΙΚΗ ΟΘΟΝΗ-ΦΡΑΓΜΑ: ένα πεσμένο δίκτυο στις 2 τα
// ξημερώματα δεν επιτρέπεται να κρατά τον διανομέα συνδεδεμένο. Αν το αίτημα
// αποτύχει υπάρχει πάντα διέξοδος — τα χιλιόμετρα δεν χάνονται, τα κλείνει η
// επόμενη μέτρηση της ίδιας μηχανής (migration 0020).
//
// ΤΟ «ΔΙΚΟ ΜΟΥ ΜΗΧΑΝΑΚΙ» ΔΕΝ ΡΩΤΙΕΤΑΙ: δεν χρεώνονται καύσιμα, άρα δεν υπάρχει
// τίποτα να μετρηθεί — μόνο η βάρδια κλείνει.

// Πάνω από τόσα χιλιόμετρα σε μία βάρδια, ζητάμε επιβεβαίωση. Δεν είναι όριο:
// είναι το σημείο όπου ένα λάθος ψηφίο γίνεται πιο πιθανό από μια πραγματική
// διαδρομή — 300 χλμ με μηχανάκι διανομής είναι ~8 ώρες συνεχούς οδήγησης.
const CONFIRM_ABOVE_KM = 300;

export default function ShiftEndScreen({ isDarkMode, driverName, onBack, onEnded, mode = 'menu' }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const isLogout = mode === 'logout';

  const [state, setState] = useState(null);     // null = φορτώνει
  const [km, setKm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmBig, setConfirmBig] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('driver_vehicle_state');
    if (err) {
      // Fail-open: χωρίς απάντηση δεν ξέρουμε αν οδηγεί εταιρικό — δεν του
      // ζητάμε νούμερο που δεν μπορούμε να αποθηκεύσουμε, τον αφήνουμε να κλείσει.
      setState({ vehicle_choice: null, unknown: true });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setState(row || { vehicle_choice: null });
    if (row && row.vehicle_choice === 'company') {
      const seed = row.start_odometer_km ?? row.vehicle_odometer_km;
      if (seed !== null && seed !== undefined) setKm(String(Math.round(Number(seed))));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isCompany = state && state.vehicle_choice === 'company';
  const start = state && state.start_odometer_km !== null && state.start_odometer_km !== undefined
    ? Number(state.start_odometer_km) : null;
  const typed = km === '' ? null : Number(km);
  const shiftKm = start !== null && typed !== null ? typed - start : null;
  const tooLow = shiftKm !== null && shiftKm < 0;

  async function finish(odometerKm) {
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('end_shift_odometer', {
      p_odometer_km: odometerKm === undefined ? null : odometerKm,
    });
    setSaving(false);
    if (err) {
      setError(err.message || 'Η λήξη βάρδιας δεν καταχωρήθηκε.');
      return;
    }
    onEnded(data && data.shift_km !== null && data.shift_km !== undefined ? Number(data.shift_km) : null);
  }

  function submit() {
    if (!isCompany) { finish(null); return; }
    if (tooLow) return;
    if (shiftKm !== null && shiftKm > CONFIRM_ABOVE_KM && !confirmBig) {
      setConfirmBig(true);
      return;
    }
    finish(Number(km));
  }

  const card = {
    backgroundColor: theme.surface,
    borderWidth: 1, borderColor: theme.border,
    borderRadius: 16, padding: 16,
  };

  const renderBody = () => {
    if (state === null) {
      return <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 40 }} />;
    }

    // ── Δικό του μηχανάκι (ή άγνωστο): μόνο επιβεβαίωση ─────────────────────
    if (!isCompany) {
      return (
        <View style={{ gap: 14 }}>
          <View style={{ ...card, marginHorizontal: 16, alignItems: 'center', paddingVertical: 26 }}>
            <Feather name="log-out" size={32} color={theme.accent} />
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '900', marginTop: 12, textAlign: 'center' }}>
              {isLogout ? 'Έξοδος από την εφαρμογή;' : 'Τέλος βάρδιας;'}
            </Text>
            <Text style={{ color: theme.subtitle, fontSize: 13.5, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
              {state.unknown
                ? 'Δεν φορτώθηκαν τα στοιχεία της βάρδιας. Μπορείτε να συνεχίσετε — αν οδηγούσατε εταιρικό μηχανάκι, δηλώστε τα χιλιόμετρα στο κέντρο.'
                : 'Δεν οδηγείτε εταιρικό μηχανάκι, οπότε δεν χρειάζεται ένδειξη κοντέρ.'}
            </Text>
          </View>
        </View>
      );
    }

    // ── Εταιρικό: η ένδειξη του κοντέρ ─────────────────────────────────────
    return (
      <View style={{ gap: 14 }}>
        <View style={{ ...card, marginHorizontal: 16, alignItems: 'center', paddingVertical: 18 }}>
          <Text style={{ color: theme.subtitle, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }}>
            ΞΕΚΙΝΗΣΑΤΕ ΤΗ ΒΑΡΔΙΑ ΣΤΑ
          </Text>
          <Text style={{ color: theme.text, fontSize: 30, fontWeight: '900', marginTop: 4 }}>
            {start === null ? '—' : formatOdometer(start)}
          </Text>
          <Text style={{ color: theme.subtitle, fontSize: 12.5, marginTop: 3 }}>
            {state.vehicle_code || ''}
          </Text>
        </View>

        <InfoBox isDarkMode={isDarkMode}>
          Γράψτε τι δείχνει τώρα το κοντέρ της μηχανής. Από αυτό υπολογίζονται τα καύσιμα της βάρδιας.
        </InfoBox>

        <OdometerInput
          isDarkMode={isDarkMode}
          value={km}
          onChangeText={(t) => { setKm(t); setConfirmBig(false); }}
          onSubmitEditing={submit}
        />

        {/* Τα χιλιόμετρα της βάρδιας, ζωντανά. Ο διανομέας βλέπει αμέσως αν
            πληκτρολόγησε λάθος — μετά την καταχώρηση θα ήταν αργά. */}
        {shiftKm !== null ? (
          <View style={{
            ...card, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12,
            borderColor: tooLow ? '#EF4444' : theme.accent,
          }}>
            <Feather name={tooLow ? 'alert-triangle' : 'map'} size={22} color={tooLow ? '#EF4444' : theme.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.subtitle, fontSize: 11.5, fontWeight: '800' }}>
                ΧΙΛΙΟΜΕΤΡΑ ΒΑΡΔΙΑΣ
              </Text>
              <Text style={{ color: tooLow ? '#EF4444' : theme.text, fontSize: 22, fontWeight: '900', marginTop: 2 }}>
                {tooLow ? 'Λιγότερα από την αρχή' : `${formatOdometer(shiftKm)} χλμ`}
              </Text>
            </View>
          </View>
        ) : null}

        {tooLow ? (
          <InfoBox isDarkMode={isDarkMode} icon="alert-triangle" tone="warn">
            Το κοντέρ δεν γυρίζει πίσω. Ελέγξτε ξανά το νούμερο — η βάρδια ξεκίνησε στα {formatOdometer(start)} χλμ.
          </InfoBox>
        ) : confirmBig ? (
          <InfoBox isDarkMode={isDarkMode} icon="alert-triangle" tone="warn">
            {formatOdometer(shiftKm)} χλμ σε μία βάρδια είναι πολλά. Αν το νούμερο είναι σωστό, πατήστε ξανά για επιβεβαίωση.
          </InfoBox>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={driverName} />

      <ScrollView
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle isDarkMode={isDarkMode} icon="flag">
          {isLogout ? 'Λήξη βάρδιας & έξοδος' : 'Λήξη βάρδιας'}
        </ScreenTitle>

        {renderBody()}

        {error ? (
          <View style={{ marginTop: 16 }}>
            <InfoBox isDarkMode={isDarkMode} icon="alert-triangle" tone="warn">
              {error}
            </InfoBox>
            {/* ΔΙΕΞΟΔΟΣ: χωρίς αυτό, ένα πεσμένο δίκτυο θα κρατούσε τον διανομέα
                κλειδωμένο μέσα στην εφαρμογή στο τέλος της βάρδιας. */}
            <View style={{ paddingHorizontal: 16 }}>
              <TouchableOpacity
                onPress={() => onEnded(null)}
                style={{
                  height: 46, borderRadius: 12,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: theme.border,
                }}
              >
                <Text style={{ color: theme.subtitle, fontWeight: '800' }}>
                  {isLogout ? 'ΕΞΟΔΟΣ ΧΩΡΙΣ ΚΑΤΑΓΡΑΦΗ' : 'ΑΚΥΡΩΣΗ'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {state !== null ? (
        <View style={{ paddingBottom: 22, paddingTop: 6, backgroundColor: theme.background }}>
          <PrimaryButton
            isDarkMode={isDarkMode}
            icon={isLogout ? 'log-out' : 'check'}
            label={saving ? 'ΚΑΤΑΧΩΡΗΣΗ…' : confirmBig ? 'ΝΑΙ, ΕΙΝΑΙ ΣΩΣΤΟ' : isLogout ? 'ΛΗΞΗ & ΕΞΟΔΟΣ' : 'ΛΗΞΗ ΒΑΡΔΙΑΣ'}
            disabled={saving || tooLow || (isCompany && km === '')}
            onPress={submit}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
