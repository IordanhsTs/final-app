import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabase';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, ScreenTitle, InfoBox, PrimaryButton, OdometerInput, formatOdometer } from './ScreenShell';

// ── Δήλωση μηχανήματος βάρδιας (αίτημα πελάτη 05/08/2026) ───────────────────
// Τρεις ερωτήσεις, με τη σειρά που τις είπε ο πελάτης: «εταιρικό ή δικό σας;»,
// «ποιο μηχανάκι;» και —από 10/08/2026— «τι δείχνει το κοντέρ αυτή τη στιγμή;».
//
// ΤΟ ΤΡΙΤΟ ΒΗΜΑ ΕΙΝΑΙ Η ΔΙΚΛΕΙΔΑ ΑΣΦΑΛΕΙΑΣ, ΟΧΙ ΓΡΑΦΕΙΟΚΡΑΤΙΑ: η οθόνη δείχνει
// την τελευταία γνωστή ένδειξη («τελευταία ενημέρωση: 25.432»). Ο διανομέας
// στέκεται μπροστά στη μηχανή, άρα τη διασταυρώνει επιτόπου. Αν το κοντέρ δείχνει
// άλλο νούμερο, γράφει το σωστό — και η διαφορά φτάνει ως ειδοποίηση στον
// διαχειριστή. Έτσι πιάνεται και ο προηγούμενος που δεν δήλωσε λήξη ΚΑΙ όποιος
// πήρε τη μηχανή χωρίς να ανοίξει καν βάρδια.
//
// ΔΥΟ ΡΟΛΟΙ, ΕΝΑ COMPONENT:
//   • ΦΡΑΓΜΑ (χωρίς `onBack`) — μπαίνει πάνω από την αρχική όταν ο διανομέας
//     πιάνει δουλειά. Δεν έχει κουμπί επιστροφής επειδή δεν υπάρχει «πίσω»:
//     από κάτω δεν έχει ανοίξει ακόμη τίποτα δικό του.
//   • ΟΘΟΝΗ ΜΕΝΟΥ (με `onBack`) — για αλλαγή μηχανής στη μέση της μέρας
//     (χάλασε το moto2, πήρε το moto5). Χωρίς αυτό, η μόνη διέξοδος θα ήταν
//     logout/login.
//
// ⚠ FAIL-OPEN: αν η βάση δεν απαντήσει, ο διανομέας ΔΕΝ κλειδώνεται έξω από τη
// δουλειά του. Ένα πεσμένο δίκτυο στις 8 το πρωί δεν επιτρέπεται να σταματήσει
// τη διανομή για μια δήλωση μηχανής — γι' αυτό υπάρχει και η «Συνέχεια χωρίς
// δήλωση», και γι' αυτό ο άδειος στόλος προσπερνιέται σιωπηλά.

export default function VehicleSelectScreen({ isDarkMode, onDone, onBack, driverName }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const isGate = !onBack;

  const [step, setStep] = useState('choice');   // 'choice' | 'pick' | 'odometer' | 'done'
  const [vehicles, setVehicles] = useState(null); // null = φορτώνει
  const [selected, setSelected] = useState(null);
  const [km, setKm] = useState('');
  const [result, setResult] = useState(null);   // η απάντηση του set_shift_vehicle
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('list_fleet_vehicles');
    if (err) {
      setVehicles([]);
      setError('Δεν φορτώθηκε η λίστα μηχανών.');
      return;
    }
    setVehicles(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ΑΔΕΙΟΣ ΣΤΟΛΟΣ = Η ΕΡΩΤΗΣΗ ΔΕΝ ΕΧΕΙ ΝΟΗΜΑ. Στο διάστημα ανάμεσα στην
  // ενημέρωση της εφαρμογής και στη στιγμή που ο διαχειριστής θα καταχωρήσει τα
  // μηχανάκια, το φράγμα θα ρωτούσε κάθε μέρα κάτι που δεν έχει απάντηση.
  useEffect(() => {
    if (isGate && vehicles && vehicles.length === 0 && !error) onDone();
  }, [isGate, vehicles, error, onDone]);

  const chosen = (vehicles || []).find((v) => v.id === selected) || null;

  async function submit(choice, vehicleId, odometerKm) {
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('set_shift_vehicle', {
      p_vehicle_id: vehicleId || null,
      p_choice: choice,
      p_odometer_km: odometerKm === undefined ? null : odometerKm,
    });
    setSaving(false);
    if (err) {
      setError(err.message || 'Η δήλωση δεν αποθηκεύτηκε.');
      return;
    }
    // Διαφορά στα χιλιόμετρα → το λέμε στον διανομέα ΠΡΙΝ ξεκινήσει. Δεν είναι
    // κατηγορία: είναι που ξέρει ότι το κέντρο το βλέπει κι αυτό, δηλαδή ακριβώς
    // ο λόγος που η δήλωση έχει αξία.
    if (data && data.alert) {
      setResult(data);
      setStep('done');
      return;
    }
    onDone();
  }

  const card = {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
  };

  // ── Βήμα 1: εταιρικό ή δικό του ───────────────────────────────────────────
  const renderChoice = () => (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      {[
        {
          key: 'company',
          icon: 'truck',
          title: 'Εταιρικό μηχανάκι',
          sub: 'Θα διαλέξετε ποιο από τη λίστα',
          onPress: () => setStep('pick'),
        },
        {
          key: 'own',
          icon: 'user',
          title: 'Δικό μου μηχανάκι',
          sub: 'Δεν χρεώνονται καύσιμα στην εταιρία',
          onPress: () => submit('own', null, null),
        },
      ].map((opt) => (
        <TouchableOpacity
          key={opt.key}
          activeOpacity={0.8}
          disabled={saving}
          onPress={opt.onPress}
          style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 14, opacity: saving ? 0.5 : 1 }}
        >
          <View style={{
            width: 52, height: 52, borderRadius: 26,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: isDarkMode ? 'rgba(212,168,83,0.12)' : 'rgba(197,160,102,0.14)',
            borderWidth: 1, borderColor: theme.accent,
          }}>
            <Feather name={opt.icon} size={24} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '900' }}>{opt.title}</Text>
            <Text style={{ color: theme.subtitle, fontSize: 13, marginTop: 3 }}>{opt.sub}</Text>
          </View>
          <Feather name="chevron-right" size={22} color={theme.subtitle} />
        </TouchableOpacity>
      ))}
    </View>
  );

  // ── Βήμα 2: ποιο μηχανάκι ─────────────────────────────────────────────────
  const renderPick = () => (
    <View style={{ paddingHorizontal: 16, gap: 10 }}>
      {vehicles === null ? (
        <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 30 }} />
      ) : vehicles.length === 0 ? (
        <View style={{ ...card, alignItems: 'center', paddingVertical: 28 }}>
          <Feather name="alert-circle" size={26} color={theme.subtitle} />
          <Text style={{ color: theme.text, fontWeight: '800', marginTop: 10, textAlign: 'center' }}>
            Δεν υπάρχουν καταχωρημένα μηχανάκια
          </Text>
          <Text style={{ color: theme.subtitle, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
            Επικοινωνήστε με το κέντρο ελέγχου.
          </Text>
        </View>
      ) : (
        vehicles.map((v) => {
          const on = selected === v.id;
          // Πιασμένο από ΑΛΛΟΝ. Δεν κλειδώνει την επιλογή (απόφαση 05/08/2026):
          // αν ο συνάδελφος ξέχασε χθες να αποσυνδεθεί, το κλειδί το κρατάει
          // όντως αυτός που στέκεται μπροστά στη μηχανή.
          const busy = v.in_use_by && !v.in_use_by_me;
          return (
            <TouchableOpacity
              key={v.id}
              activeOpacity={0.8}
              onPress={() => setSelected(v.id)}
              style={{
                ...card,
                flexDirection: 'row', alignItems: 'center', gap: 14,
                borderColor: on ? theme.accent : theme.border,
                borderWidth: on ? 2 : 1,
                backgroundColor: on
                  ? (isDarkMode ? 'rgba(212,168,83,0.10)' : 'rgba(197,160,102,0.10)')
                  : theme.surface,
              }}
            >
              <View style={{
                width: 46, height: 46, borderRadius: 12,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: isDarkMode ? theme.toggleBg : theme.inputBg,
              }}>
                <Feather name="truck" size={21} color={on ? theme.accent : theme.subtitle} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 17, fontWeight: '900' }}>{v.code}</Text>
                {v.plate || v.make_model ? (
                  <Text style={{ color: theme.subtitle, fontSize: 13, marginTop: 2 }}>
                    {[v.make_model, v.plate].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {v.odometer_km !== null && v.odometer_km !== undefined ? (
                  <Text style={{ color: theme.subtitle, fontSize: 12, marginTop: 3 }}>
                    Κοντέρ: {formatOdometer(v.odometer_km)} χλμ
                  </Text>
                ) : null}
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <Feather name="alert-triangle" size={12} color="#FBBF24" />
                    <Text style={{ color: '#FBBF24', fontSize: 12, fontWeight: '700' }}>
                      Σε χρήση από {v.in_use_by}
                    </Text>
                  </View>
                ) : null}
              </View>

              {on ? <Feather name="check-circle" size={22} color={theme.accent} /> : null}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  // ── Βήμα 3: η ένδειξη του κοντέρ ──────────────────────────────────────────
  const renderOdometer = () => {
    const known = chosen && chosen.odometer_km !== null && chosen.odometer_km !== undefined
      ? Number(chosen.odometer_km) : null;
    const typed = km === '' ? null : Number(km);
    const diff = known !== null && typed !== null ? typed - known : null;

    return (
      <View style={{ gap: 14 }}>
        <View style={{ ...card, marginHorizontal: 16, alignItems: 'center', paddingVertical: 20 }}>
          <Text style={{ color: theme.subtitle, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }}>
            ΤΕΛΕΥΤΑΙΑ ΕΝΗΜΕΡΩΣΗ ΧΙΛΙΟΜΕΤΡΩΝ
          </Text>
          <Text style={{ color: theme.accent, fontSize: 38, fontWeight: '900', marginTop: 6 }}>
            {known === null ? '—' : formatOdometer(known)}
          </Text>
          <Text style={{ color: theme.subtitle, fontSize: 12.5, marginTop: 4, textAlign: 'center' }}>
            {chosen && chosen.odometer_by
              ? `${chosen.code} · από ${chosen.odometer_by}`
              : (chosen ? chosen.code : '')}
          </Text>
        </View>

        <InfoBox isDarkMode={isDarkMode}>
          Κοιτάξτε τώρα το κοντέρ της μηχανής. Αν δείχνει άλλο νούμερο, γράψτε το σωστό —
          η διαφορά καταγράφεται και την ελέγχει το κέντρο.
        </InfoBox>

        <OdometerInput
          isDarkMode={isDarkMode}
          value={km}
          onChangeText={setKm}
          onSubmitEditing={() => { if (km !== '') submit('company', selected, Number(km)); }}
        />

        {/* Ζωντανή διαφορά: ο διανομέας βλέπει τι δηλώνει πριν το στείλει, όχι
            μετά. Χωρίς αυτό ένα λάθος ψηφίο («250432» αντί «25432») θα περνούσε
            απαρατήρητο και θα κατέληγε σε συναγερμό στον διαχειριστή. */}
        {diff !== null && diff !== 0 ? (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Feather
              name={diff > 0 ? 'trending-up' : 'alert-triangle'}
              size={14}
              color={diff > 0 ? theme.subtitle : '#FBBF24'}
            />
            <Text style={{ color: diff > 0 ? theme.subtitle : '#FBBF24', fontSize: 13, fontWeight: '700', flexShrink: 1 }}>
              {diff > 0
                ? `${formatOdometer(diff)} χλμ περισσότερα από την τελευταία καταγραφή`
                : `${formatOdometer(-diff)} χλμ λιγότερα — σίγουρα το διαβάσατε σωστά;`}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  // ── Βήμα 4: τι καταγράφηκε (μόνο όταν υπάρχει διαφορά) ────────────────────
  const renderDone = () => {
    const gap = result ? Number(result.gap_km) : 0;
    const off = result && result.alert === 'off_shift';
    return (
      <View style={{ gap: 14 }}>
        <View style={{ ...card, marginHorizontal: 16, alignItems: 'center', paddingVertical: 24 }}>
          <Feather name={off ? 'alert-triangle' : 'help-circle'} size={34} color="#FBBF24" />
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '900', marginTop: 12, textAlign: 'center' }}>
            {off
              ? `${formatOdometer(Math.abs(gap))} χλμ εκτός βάρδιας`
              : 'Η ένδειξη είναι μικρότερη από την προηγούμενη'}
          </Text>
          <Text style={{ color: theme.subtitle, fontSize: 13.5, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            {off
              ? 'Η μηχανή κινήθηκε χωρίς ανοιχτή βάρδια. Καταγράφηκε και θα το δει το κέντρο ελέγχου — εσείς ξεκινάτε κανονικά από αυτό το νούμερο.'
              : 'Καταγράφηκε για έλεγχο από το κέντρο. Η βάρδιά σας ξεκινά κανονικά από το νούμερο που δηλώσατε.'}
          </Text>
        </View>
      </View>
    );
  };

  const titles = {
    choice: 'Με τι θα δουλέψετε;',
    pick: 'Ποιο μηχανάκι θα οδηγήσετε;',
    odometer: 'Τι δείχνει το κοντέρ;',
    done: 'Καταγράφηκε',
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {onBack ? <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={driverName} /> : null}

      <ScrollView
        contentContainerStyle={{ paddingTop: isGate ? 46 : 6, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle isDarkMode={isDarkMode} icon={step === 'odometer' ? 'hash' : 'truck'}>
          {titles[step]}
        </ScreenTitle>

        {step === 'choice' ? (
          <InfoBox isDarkMode={isDarkMode}>
            Τα χιλιόμετρα της βάρδιας βγαίνουν από το κοντέρ της μηχανής που θα δηλώσετε.
          </InfoBox>
        ) : step === 'pick' ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <TouchableOpacity
              onPress={() => { setStep('choice'); setSelected(null); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Feather name="arrow-left" size={16} color={theme.accent} />
              <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '800' }}>
                Δεν είναι εταιρικό
              </Text>
            </TouchableOpacity>
          </View>
        ) : step === 'odometer' ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <TouchableOpacity
              onPress={() => { setStep('pick'); setKm(''); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Feather name="arrow-left" size={16} color={theme.accent} />
              <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '800' }}>
                Άλλο μηχανάκι
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {step === 'choice' ? renderChoice()
          : step === 'pick' ? renderPick()
          : step === 'odometer' ? renderOdometer()
          : renderDone()}

        {error ? (
          <View style={{ marginTop: 16 }}>
            <InfoBox isDarkMode={isDarkMode} icon="alert-triangle" tone="warn">
              {error}
            </InfoBox>
            <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={load}
                style={{
                  flex: 1, height: 46, borderRadius: 12,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: theme.accent,
                }}
              >
                <Text style={{ color: theme.accent, fontWeight: '900' }}>ΔΟΚΙΜΗ ΞΑΝΑ</Text>
              </TouchableOpacity>
              {isGate ? (
                <TouchableOpacity
                  onPress={onDone}
                  style={{
                    flex: 1, height: 46, borderRadius: 12,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: theme.border,
                  }}
                >
                  <Text style={{ color: theme.subtitle, fontWeight: '800' }}>ΣΥΝΕΧΕΙΑ</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {step === 'pick' && vehicles && vehicles.length > 0 ? (
        <View style={{ paddingBottom: 22, paddingTop: 6, backgroundColor: theme.background }}>
          <PrimaryButton
            isDarkMode={isDarkMode}
            icon="arrow-right"
            label="ΣΥΝΕΧΕΙΑ"
            disabled={!selected}
            onPress={() => {
              // Προσυμπληρωμένο με ό,τι ξέρουμε: στη συντριπτική πλειοψηφία των
              // περιπτώσεων το κοντέρ ΘΑ συμφωνεί, και ο διανομέας δεν πρέπει να
              // πληκτρολογεί έξι ψηφία με γάντια για να πει «ναι, σωστά».
              setKm(chosen && chosen.odometer_km !== null && chosen.odometer_km !== undefined
                ? String(Math.round(Number(chosen.odometer_km))) : '');
              setStep('odometer');
            }}
          />
        </View>
      ) : step === 'odometer' ? (
        <View style={{ paddingBottom: 22, paddingTop: 6, backgroundColor: theme.background }}>
          <PrimaryButton
            isDarkMode={isDarkMode}
            icon="check"
            label={saving ? 'ΑΠΟΘΗΚΕΥΣΗ…' : 'ΞΕΚΙΝΑΩ'}
            disabled={km === '' || saving}
            onPress={() => submit('company', selected, Number(km))}
          />
        </View>
      ) : step === 'done' ? (
        <View style={{ paddingBottom: 22, paddingTop: 6, backgroundColor: theme.background }}>
          <PrimaryButton isDarkMode={isDarkMode} icon="arrow-right" label="ΣΥΝΕΧΕΙΑ" onPress={onDone} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
