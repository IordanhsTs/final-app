import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { supabase, isReadOnly } from '../../supabase';
import { Colors } from '../styles/globalStyles';
import {
  ScreenHeader, ScreenTitle, InfoBox, WeekSwitcher, PrimaryButton,
} from './ScreenShell';
import {
  mondayOf, addDays, ymd, weekDates, formatWeekRange, GREEK_DAYS,
  hhmm, timeToDate, spanHours, crossesMidnight, formatHours,
} from '../utils/week';

// ── Δήλωση διαθεσιμότητας επόμενης εβδομάδας ────────────────────────────────
// Ο διανομέας δηλώνει ΤΙ ΘΕΛΕΙ· ο διαχειριστής αποφασίζει. Οι δύο έννοιες δεν
// ταυτίζονται ποτέ και η οθόνη το λέει ρητά (InfoBox) — αλλιώς ο διανομέας θα
// νόμιζε ότι μόλις κλείδωσε τη βάρδιά του και δεν θα κοίταζε το πρόγραμμα.
//
// ΓΙΑΤΙ ΑΝΟΙΓΕΙ ΣΤΗΝ ΕΠΟΜΕΝΗ ΕΒΔΟΜΑΔΑ: αυτή είναι η ροή του πελάτη — μέσα στην
// τρέχουσα εβδομάδα μαζεύονται οι δηλώσεις για την επόμενη. Η τρέχουσα είναι
// ένα βελάκι πίσω, για όποιον θέλει να δει τι είχε δηλώσει.

const DEFAULT_SLOT = { start: '17:00', end: '23:00' };

/** Κενή ημέρα — καμία δήλωση. */
const emptyDay = () => ({ enabled: false, allDay: false, slots: [{ ...DEFAULT_SLOT }] });

/** Οι γραμμές της βάσης → η δομή που ζωγραφίζει η οθόνη. */
function rowsToDays(rows, monday) {
  const days = {};
  weekDates(monday).forEach((d) => { days[ymd(d)] = emptyDay(); });

  (rows || []).forEach((r) => {
    const key = r.work_date;
    if (!days[key]) return;
    const day = days[key];
    if (!day.enabled) { day.enabled = true; day.slots = []; }
    if (r.all_day) {
      day.allDay = true;
      day.slots = [{ ...DEFAULT_SLOT }];
    } else {
      day.slots.push({ start: hhmm(r.start_time), end: hhmm(r.end_time) });
    }
  });

  // Ασφάλεια: ενεργή ημέρα χωρίς διάστημα δεν πρέπει να υπάρχει, αλλά αν
  // προκύψει (χειροκίνητη παρέμβαση στη βάση) η οθόνη δεν πρέπει να σπάσει.
  Object.values(days).forEach((d) => { if (!d.slots.length) d.slots = [{ ...DEFAULT_SLOT }]; });
  return days;
}

/** Η δομή της οθόνης → το jsonb που περιμένει το save_my_availability. */
function daysToSlots(days) {
  const out = [];
  Object.entries(days).forEach(([date, day]) => {
    if (!day.enabled) return;
    if (day.allDay) {
      out.push({ date, start: '00:00', end: '23:59', all_day: true });
      return;
    }
    day.slots.forEach((s) => out.push({ date, start: s.start, end: s.end, all_day: false }));
  });
  return out;
}

export default function AvailabilityScreen({ currentUser, isDarkMode, onBack }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  const [monday, setMonday] = useState(() => addDays(mondayOf(new Date()), 7));
  const [days, setDays] = useState(() => rowsToDays([], addDays(mondayOf(new Date()), 7)));
  const [expanded, setExpanded] = useState(null);   // ποια ημέρα δείχνει τις επιλογές της
  const [picker, setPicker] = useState(null);       // { date, index, field }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(null);
  const [publishedAt, setPublishedAt] = useState(null);
  const [deadline, setDeadline] = useState({ dow: 4, time: '22:00' });
  const [feedback, setFeedback] = useState(null);   // { ok: boolean, text: string }

  const locked = !!publishedAt;

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    // Αλλάζοντας εβδομάδα, μια ανοιχτή ημέρα ή ένας ανοιχτός time picker θα
    // έδειχναν σε γραμμή που δεν υπάρχει πια στα νέα δεδομένα.
    setExpanded(null);
    setPicker(null);
    try {
      const weekKey = ymd(monday);
      const [avail, week, sched, settings] = await Promise.all([
        supabase.from('driver_availability')
          .select('work_date, start_time, end_time, all_day')
          .eq('driver_id', currentUser.id).eq('week_start', weekKey)
          .order('work_date').order('start_time'),
        supabase.from('driver_availability_weeks')
          .select('submitted_at, updated_at')
          .eq('driver_id', currentUser.id).eq('week_start', weekKey).maybeSingle(),
        supabase.from('schedule_weeks')
          .select('published_at').eq('week_start', weekKey).maybeSingle(),
        supabase.from('schedule_settings')
          .select('deadline_dow, deadline_time').maybeSingle(),
      ]);

      setDays(rowsToDays(avail.data, monday));
      setSubmittedAt(week.data?.updated_at || week.data?.submitted_at || null);
      setPublishedAt(sched.data?.published_at || null);
      if (settings.data) {
        setDeadline({ dow: settings.data.deadline_dow, time: hhmm(settings.data.deadline_time) });
      }
    } catch (e) {
      console.log('Availability load error:', e);
      setFeedback({ ok: false, text: 'Δεν φορτώθηκε η διαθεσιμότητα. Έλεγξε τη σύνδεση.' });
    } finally {
      setLoading(false);
    }
  }, [monday, currentUser.id]);

  useEffect(() => { load(); }, [load]);

  // ── Επεξεργασία ημέρας ────────────────────────────────────────────────────
  const patchDay = (date, patch) => {
    setFeedback(null);
    setDays((prev) => ({ ...prev, [date]: { ...prev[date], ...patch } }));
  };

  const patchSlot = (date, index, patch) => {
    setFeedback(null);
    setDays((prev) => {
      const slots = prev[date].slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...prev, [date]: { ...prev[date], slots } };
    });
  };

  // ΣΠΑΣΤΟ ΩΡΑΡΙΟ: το «+» του πελάτη. Το νέο διάστημα ξεκινά μετά το τέλος του
  // προηγούμενου, αλλιώς ο διανομέας θα έβρισκε δύο ταυτόσημες γραμμές και θα
  // έπρεπε να αλλάξει και τις τέσσερις ώρες με το χέρι.
  const addSlot = (date) => {
    setFeedback(null);
    setDays((prev) => {
      const day = prev[date];
      const last = day.slots[day.slots.length - 1];
      // Το φράγμα στις 21:00 δεν είναι αισθητικό: χωρίς αυτό, ένα πρώτο ωράριο
      // που τελειώνει 23:00 θα έδινε δεύτερο «23:00 – 23:00», που το απορρίπτει
      // και ο έλεγχος αποστολής και η ίδια η βάση.
      const startHour = Math.min(21, (Number(String(last.end).slice(0, 2)) || 0) + 2);
      const pad = (h) => String(h).padStart(2, '0');
      const next = { start: `${pad(startHour)}:00`, end: `${pad(Math.min(23, startHour + 4))}:00` };
      return { ...prev, [date]: { ...day, slots: [...day.slots, next] } };
    });
  };

  const removeSlot = (date, index) => {
    setFeedback(null);
    setDays((prev) => {
      const slots = prev[date].slots.filter((_, i) => i !== index);
      return { ...prev, [date]: { ...prev[date], slots: slots.length ? slots : [{ ...DEFAULT_SLOT }] } };
    });
  };

  const onPickTime = (event, selected) => {
    const target = picker;
    setPicker(null);
    if (event.type === 'dismissed' || !selected || !target) return;
    const value = hhmm(selected);
    patchSlot(target.date, target.index, { [target.field]: value });
  };

  // ── Αντιγραφή προηγούμενης εβδομάδας ──────────────────────────────────────
  async function copyPreviousWeek() {
    const prevKey = ymd(addDays(monday, -7));
    const { data, error } = await supabase.from('driver_availability')
      .select('work_date, start_time, end_time, all_day')
      .eq('driver_id', currentUser.id).eq('week_start', prevKey)
      .order('work_date').order('start_time');

    if (error) {
      setFeedback({ ok: false, text: 'Δεν διαβάστηκε η προηγούμενη εβδομάδα.' });
      return;
    }
    if (!data || !data.length) {
      setFeedback({ ok: false, text: 'Δεν υπάρχει δήλωση στην προηγούμενη εβδομάδα.' });
      return;
    }

    // Μετατόπιση κατά 7 ημέρες: η Τρίτη της περασμένης γίνεται Τρίτη αυτής.
    const shifted = data.map((r) => ({
      ...r,
      work_date: ymd(addDays(new Date(`${r.work_date}T00:00:00`), 7)),
    }));
    setDays(rowsToDays(shifted, monday));
    setFeedback({ ok: true, text: 'Αντιγράφηκε. Έλεγξε τις ώρες και πάτησε αποστολή.' });
  }

  // ── Αποστολή ──────────────────────────────────────────────────────────────
  async function submit() {
    if (isReadOnly()) {
      setFeedback({ ok: false, text: 'Εφεδρική λειτουργία — δοκίμασε ξανά σε λίγο.' });
      return;
    }

    const slots = daysToSlots(days);

    // Μηδενικό διάστημα: το απορρίπτει και η βάση (constraint), αλλά ένα
    // μήνυμα στα ελληνικά είναι πιο χρήσιμο από ένα σφάλμα Postgres.
    const zero = slots.find((s) => s.start === s.end);
    if (zero) {
      setFeedback({ ok: false, text: 'Υπάρχει διάστημα με ίδια ώρα έναρξης και λήξης.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc('save_my_availability', {
      p_week_start: ymd(monday),
      p_slots: slots,
    });
    setSaving(false);

    if (error) {
      console.log('save_my_availability error:', error);
      setFeedback({ ok: false, text: error.message || 'Η αποστολή απέτυχε.' });
      return;
    }
    setSubmittedAt(new Date().toISOString());
    setFeedback({
      ok: true,
      text: slots.length
        ? 'Η διαθεσιμότητά σου στάλθηκε. Μπορείς να την αλλάξεις όποτε θέλεις.'
        : 'Καταχωρήθηκε ότι δεν είσαι διαθέσιμος αυτή την εβδομάδα.',
    });
  }

  // ── Σύνολο ────────────────────────────────────────────────────────────────
  const activeDays = Object.values(days).filter((d) => d.enabled);
  const flexibleDays = activeDays.filter((d) => d.allDay).length;
  const totalHours = activeDays
    .filter((d) => !d.allDay)
    .reduce((sum, d) => sum + d.slots.reduce((s, sl) => s + spanHours(sl.start, sl.end), 0), 0);

  let summary;
  if (!activeDays.length) summary = 'Δεν έχεις δηλώσει καμία ημέρα';
  else if (flexibleDays) summary = `Ευέλικτη διαθεσιμότητα · ${activeDays.length} ημέρες`;
  else summary = `${formatHours(totalHours)} σε ${activeDays.length} ${activeDays.length === 1 ? 'ημέρα' : 'ημέρες'}`;

  // ── Δομικά στοιχεία ───────────────────────────────────────────────────────
  const timeField = {
    borderWidth: 1, borderColor: theme.accent, borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 8, minWidth: 62, alignItems: 'center',
    backgroundColor: isDarkMode ? 'rgba(212,168,83,0.06)' : 'rgba(197,160,102,0.07)',
  };

  const renderTimeField = (date, index, field, value) => (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 10, color: theme.subtitle, marginBottom: 3 }}>
        {field === 'start' ? 'Από' : 'Έως'}
      </Text>
      <TouchableOpacity
        disabled={locked}
        onPress={() => setPicker({ date, index, field })}
        style={timeField}
      >
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>{value}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSlotRow = (date, slot, index, day) => {
    const overnight = crossesMidnight(slot.start, slot.end);
    const isExtra = index > 0;

    return (
      <View key={index} style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5,
        marginTop: isExtra ? 10 : 0,
      }}>
        {isExtra ? (
          <Text style={{ fontSize: 11, color: theme.subtitle, marginRight: 'auto', fontWeight: '700' }}>
            2ο ωράριο
          </Text>
        ) : null}

        {renderTimeField(date, index, 'start', slot.start)}
        <Text style={{ color: theme.subtitle, marginTop: 14 }}>–</Text>
        {renderTimeField(date, index, 'end', slot.end)}

        {/* «+1» όταν το ωράριο κλείνει μετά τα μεσάνυχτα — χωρίς αυτό, το
            «17:00 – 01:00» διαβάζεται ως λάθος καταχώρηση. */}
        {overnight ? (
          <Text style={{ fontSize: 10, fontWeight: '900', color: theme.accent, marginTop: 14 }}>+1</Text>
        ) : null}

        {locked ? null : isExtra ? (
          <TouchableOpacity
            onPress={() => removeSlot(date, index)}
            style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}
            accessibilityLabel="Αφαίρεση ωραρίου"
          >
            <Feather name="trash-2" size={17} color="#EF4444" />
          </TouchableOpacity>
        ) : (
          // ΤΟ «+» ΤΟΥ ΠΕΛΑΤΗ: σπαστό ωράριο («Τρίτη 7-2 και 7-11»). Εμφανίζεται
          // μόνο στην πρώτη γραμμή — τα επιπλέον ωράρια προστίθενται από εκεί.
          <TouchableOpacity
            onPress={() => addSlot(date)}
            disabled={day.slots.length >= 3}
            style={{
              width: 30, height: 30, borderRadius: 15, marginTop: 14,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: isDarkMode ? 'rgba(212,168,83,0.14)' : 'rgba(197,160,102,0.16)',
              opacity: day.slots.length >= 3 ? 0.35 : 1,
            }}
            accessibilityLabel="Προσθήκη σπαστού ωραρίου"
          >
            <Feather name="plus" size={17} color={theme.accent} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderDay = (date, index) => {
    const day = days[date] || emptyDay();
    const open = expanded === date;

    return (
      <View key={date} style={{
        backgroundColor: theme.surface, borderRadius: 14,
        borderWidth: 1, borderColor: open ? theme.accent : theme.border,
        marginBottom: 8, paddingVertical: 10, paddingHorizontal: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* ΟΝΟΜΑ ΚΑΙ ΔΙΑΚΟΠΤΗΣ ΣΕ ΣΤΗΛΗ (αίτημα πελάτη 03/08/2026): στη μία
              σειρά, ημέρα + διακόπτης + δύο ώρες + «+» + βελάκι δεν χωρούσαν
              στο πλάτος της οθόνης, οπότε ο διακόπτης καθόταν πάνω στο πρώτο
              πεδίο ώρας. Δεξιά τα πράγματα μένουν όπως ήταν. */}
          <View style={{ width: 82 }}>
            <TouchableOpacity
              onPress={() => setExpanded(open ? null : date)}
              disabled={!day.enabled || locked}
              accessibilityLabel={`Επιλογές ${GREEK_DAYS[index]}`}
            >
              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14.5 }}>{GREEK_DAYS[index]}</Text>
            </TouchableOpacity>

            <Switch
              value={day.enabled}
              disabled={locked}
              onValueChange={(v) => {
                patchDay(date, { enabled: v });
                if (!v && expanded === date) setExpanded(null);
              }}
              trackColor={{ false: '#6B7280', true: theme.accent }}
              thumbColor="#FFFFFF"
              style={{ alignSelf: 'flex-start', marginTop: 4 }}
            />
          </View>

          {day.enabled ? (
            day.allDay ? (
              <Text style={{ flex: 1, textAlign: 'right', color: theme.accent, fontWeight: '800', fontSize: 13 }}>
                Όλη την ημέρα
              </Text>
            ) : (
              <View style={{ flex: 1 }}>{renderSlotRow(date, day.slots[0], 0, day)}</View>
            )
          ) : (
            <Text style={{ flex: 1, textAlign: 'right', color: theme.subtitle, fontSize: 13.5 }}>
              Μη διαθέσιμος
            </Text>
          )}

          {day.enabled && !locked ? (
            <TouchableOpacity
              onPress={() => setExpanded(open ? null : date)}
              style={{ width: 22, alignItems: 'flex-end' }}
            >
              <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.subtitle} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Επιπλέον ωράρια της ίδιας ημέρας (σπαστό). Το paddingRight αντιγράφει
            τη στήλη του βελακιού, ώστε οι ώρες του 2ου ωραρίου να πέφτουν
            ακριβώς κάτω από τις ώρες του 1ου. */}
        {day.enabled && !day.allDay && day.slots.length > 1 ? (
          <View style={{ paddingRight: locked ? 0 : 30 }}>
            {day.slots.slice(1).map((slot, i) => renderSlotRow(date, slot, i + 1, day))}
          </View>
        ) : null}

        {/* Ανοιγμένη ημέρα: συγκεκριμένες ώρες ή ολόκληρη η ημέρα */}
        {open && day.enabled && !locked ? (
          <View style={{ marginTop: 12 }}>
            <View style={{
              flexDirection: 'row', backgroundColor: theme.toggleBg,
              borderRadius: 12, padding: 4, gap: 4,
            }}>
              {[
                { key: false, label: 'ΣΥΓΚΕΚΡΙΜΕΝΕΣ ΩΡΕΣ' },
                { key: true, label: 'ΟΛΗ ΤΗΝ ΗΜΕΡΑ' },
              ].map((opt) => {
                const on = day.allDay === opt.key;
                return (
                  <TouchableOpacity
                    key={String(opt.key)}
                    onPress={() => patchDay(date, { allDay: opt.key })}
                    style={{
                      flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center',
                      flexDirection: 'row', justifyContent: 'center', gap: 5,
                      backgroundColor: on ? theme.accent : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 11, fontWeight: '900', letterSpacing: 0.4,
                      color: on ? (isDarkMode ? '#0B1020' : '#1E1A14') : theme.subtitle,
                    }}>
                      {opt.label}
                    </Text>
                    {opt.key ? (
                      <Feather name="sun" size={12} color={on ? (isDarkMode ? '#0B1020' : '#1E1A14') : theme.subtitle} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ fontSize: 11.5, color: theme.subtitle, textAlign: 'center', marginTop: 7 }}>
              {day.allDay ? 'Βάλε με όποτε χρειαστεί' : 'Πάτησε τις ώρες για να τις αλλάξεις'}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 40 }}>
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={currentUser.full_name} />

      <ScrollView contentContainerStyle={{ paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
        <ScreenTitle isDarkMode={isDarkMode} icon="calendar">Διαθεσιμότητα εβδομάδας</ScreenTitle>

        <WeekSwitcher
          isDarkMode={isDarkMode}
          label={formatWeekRange(monday)}
          badge={submittedAt ? `Δηλώθηκε ${new Date(submittedAt).toLocaleDateString('el-GR')}` : 'Δεν έχει δηλωθεί'}
          onPrev={() => setMonday(addDays(monday, -7))}
          onNext={() => setMonday(addDays(monday, 7))}
        />

        {/* Η προθεσμία είναι ΥΠΕΝΘΥΜΙΣΗ, δεν κλειδώνει: ο πελάτης ζήτησε ρητά να
            μπορεί ο διανομέας να αλλάζει όσες φορές θέλει. Το πραγματικό
            κλείδωμα είναι η ανακοίνωση του προγράμματος. */}
        {!locked ? (
          <View style={{ alignItems: 'center', marginBottom: 10 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              borderWidth: 1, borderColor: theme.accent, borderRadius: 12,
              paddingVertical: 8, paddingHorizontal: 14,
            }}>
              <Feather name="clock" size={15} color={theme.accent} />
              <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>
                Υποβολή έως {GREEK_DAYS[(deadline.dow || 4) - 1]} {deadline.time}
              </Text>
            </View>
          </View>
        ) : null}

        {!locked ? (
          <TouchableOpacity
            onPress={copyPreviousWeek}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 14 }}
          >
            <Feather name="copy" size={14} color={theme.subtitle} />
            <Text style={{ color: theme.subtitle, fontSize: 13 }}>Αντιγραφή προηγούμενης εβδομάδας</Text>
          </TouchableOpacity>
        ) : null}

        {feedback ? (
          <InfoBox
            isDarkMode={isDarkMode}
            icon={feedback.ok ? 'check-circle' : 'alert-circle'}
            tone={feedback.ok ? 'accent' : 'warn'}
          >
            {feedback.text}
          </InfoBox>
        ) : null}

        {/* Το «οι ώρες ενδέχεται να τροποποιηθούν» έφυγε με αίτημα του πελάτη
            (03/08/2026): έπιανε ολόκληρο πλαίσιο για μια πληροφορία που ο
            διανομέας τη βλέπει έτσι κι αλλιώς στο «Το πρόγραμμά μου». Το
            μήνυμα του κλειδώματος μένει — αυτό εξηγεί γιατί δεν πατιέται
            τίποτα. */}
        {locked ? (
          <InfoBox isDarkMode={isDarkMode} icon="lock" tone="warn">
            Το πρόγραμμα αυτής της εβδομάδας ανακοινώθηκε, οπότε η δήλωση κλείδωσε.
            Για αλλαγή, επικοινώνησε με το κέντρο.
          </InfoBox>
        ) : null}

        {loading ? (
          <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <Text style={{ fontSize: 12, color: theme.subtitle, paddingHorizontal: 16, marginBottom: 8 }}>
              <Feather name="info" size={11} color={theme.subtitle} />{'  '}
              Πάτησε σε μία ημέρα για επιλογή ωρών ή ολόκληρης ημέρας
            </Text>

            <View style={{ paddingHorizontal: 16 }}>
              {weekDates(monday).map((d, i) => renderDay(ymd(d), i))}
            </View>

            {/* ── Σύνολο ─────────────────────────────────────────────────── */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              marginHorizontal: 16, marginTop: 8, marginBottom: 18,
              backgroundColor: theme.surface, borderRadius: 16,
              borderWidth: 1, borderColor: theme.border, padding: 14,
            }}>
              <View style={{
                width: 38, height: 38, borderRadius: 19,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: isDarkMode ? 'rgba(212,168,83,0.12)' : 'rgba(197,160,102,0.14)',
              }}>
                <Feather name="clock" size={18} color={theme.accent} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontSize: 11.5, color: theme.subtitle, fontWeight: '600' }}>
                  Σύνολο διαθεσιμότητας
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: theme.text, marginTop: 2 }}>
                  {summary}
                </Text>
              </View>
            </View>

            {!locked ? (
              <>
                <PrimaryButton
                  isDarkMode={isDarkMode}
                  icon="send"
                  label={saving ? 'Αποστολή…' : 'Αποστολή διαθεσιμότητας'}
                  onPress={submit}
                  disabled={saving}
                />
                <Text style={{ fontSize: 12, color: theme.subtitle, textAlign: 'center', marginTop: 10 }}>
                  Μπορείς να κάνεις αλλαγές μέχρι να ανακοινωθεί το πρόγραμμα
                </Text>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {picker && days[picker.date]?.slots?.[picker.index] ? (
        <DateTimePicker
          value={timeToDate(days[picker.date].slots[picker.index][picker.field])}
          mode="time"
          is24Hour
          display="default"
          onChange={onPickTime}
        />
      ) : null}
    </View>
  );
}
