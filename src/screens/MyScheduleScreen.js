import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabase';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, ScreenTitle, WeekSwitcher, EmptyState, InfoBox } from './ScreenShell';
import {
  mondayOf, addDays, ymd, weekDates, formatWeekRange, formatDay,
  GREEK_DAYS, hhmm, spanHours, crossesMidnight, formatHours,
} from '../utils/week';

// ── Το τελικό πρόγραμμα, όπως το βλέπει ο διανομέας ─────────────────────────
// Δύο πράγματα ζήτησε ο πελάτης: ΠΟΤΕ δουλεύω και ΜΕ ΠΟΙΟΥΣ. Γι' αυτό κάθε
// ημέρα δείχνει πρώτα τη δική μου βάρδια (χρυσή, ξεχωριστή) και από κάτω τους
// συναδέλφους — και στα ρεπό, γιατί «ποιος δουλεύει σήμερα» είναι χρήσιμο
// ακόμη κι όταν δεν δουλεύω εγώ.
//
// Το RPC published_week_schedule επιστρέφει ΜΟΝΟ δημοσιευμένες εβδομάδες: το
// προσχέδιο του διαχειριστή δεν διαρρέει ποτέ στα κινητά.

export default function MyScheduleScreen({ currentUser, isDarkMode, onBack }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [rows, setRows] = useState([]);
  const [publishedAt, setPublishedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Το «αν η τρέχουσα δεν έχει βγει, δείξε την επόμενη» επιτρέπεται ΜΙΑ φορά:
  // αλλιώς θα ακύρωνε κάθε πάτημα του βέλους πίσω.
  const autoJumped = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const weekKey = ymd(monday);
      const [schedule, week] = await Promise.all([
        supabase.rpc('published_week_schedule', { p_week_start: weekKey }),
        supabase.from('schedule_weeks').select('published_at').eq('week_start', weekKey).maybeSingle(),
      ]);

      setRows(schedule.data || []);
      setPublishedAt(week.data?.published_at || null);

      // Ο διαχειριστής βγάζει το πρόγραμμα Σάββατο/Κυριακή για την ΕΠΟΜΕΝΗ
      // εβδομάδα. Όποιος ανοίξει την οθόνη τότε θα έβρισκε άδεια τρέχουσα
      // εβδομάδα και θα νόμιζε ότι δεν βγήκε πρόγραμμα.
      if (!autoJumped.current && !week.data?.published_at) {
        autoJumped.current = true;
        const nextKey = ymd(addDays(monday, 7));
        const { data: next } = await supabase.from('schedule_weeks')
          .select('published_at').eq('week_start', nextKey).maybeSingle();
        if (next?.published_at) {
          setMonday((m) => addDays(m, 7));
          return;
        }
      }
    } catch (e) {
      console.log('Schedule load error:', e);
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monday]);

  useEffect(() => { load(); }, [load]);

  // ── Ομαδοποίηση ανά ημέρα ─────────────────────────────────────────────────
  const byDate = {};
  rows.forEach((r) => {
    if (!byDate[r.work_date]) byDate[r.work_date] = { mine: [], others: {} };
    const slot = { start: hhmm(r.start_time), end: hhmm(r.end_time) };
    if (r.driver_id === currentUser.id) {
      byDate[r.work_date].mine.push(slot);
    } else {
      if (!byDate[r.work_date].others[r.driver_id]) {
        byDate[r.work_date].others[r.driver_id] = { name: r.full_name, slots: [] };
      }
      byDate[r.work_date].others[r.driver_id].slots.push(slot);
    }
  });

  const myDays = Object.values(byDate).filter((d) => d.mine.length).length;
  const myHours = Object.values(byDate).reduce(
    (sum, d) => sum + d.mine.reduce((s, sl) => s + spanHours(sl.start, sl.end), 0), 0);

  const slotLabel = (sl) => `${sl.start} – ${sl.end}${crossesMidnight(sl.start, sl.end) ? ' (+1)' : ''}`;

  const renderDay = (date, index) => {
    const day = byDate[date] || { mine: [], others: {} };
    const colleagues = Object.values(day.others);
    const working = day.mine.length > 0;

    return (
      <View key={date} style={{
        backgroundColor: theme.surface, borderRadius: 16,
        borderWidth: 1, borderColor: working ? theme.accent : theme.border,
        marginBottom: 10, padding: 14,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '900', fontSize: 15.5 }}>{GREEK_DAYS[index]}</Text>
            <Text style={{ color: theme.subtitle, fontSize: 12, marginTop: 2 }}>
              {formatDay(new Date(`${date}T00:00:00`))}
            </Text>
          </View>

          <View style={{
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9,
            backgroundColor: working
              ? (isDarkMode ? 'rgba(212,168,83,0.16)' : 'rgba(197,160,102,0.18)')
              : theme.toggleBg,
          }}>
            <Text style={{
              fontSize: 11, fontWeight: '900', letterSpacing: 0.6,
              color: working ? theme.accent : theme.subtitle,
            }}>
              {working ? 'ΒΑΡΔΙΑ' : 'ΡΕΠΟ'}
            </Text>
          </View>
        </View>

        {working ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: colleagues.length ? 12 : 0 }}>
            {day.mine.map((sl, i) => (
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center', gap: 7,
                paddingVertical: 9, paddingHorizontal: 12, borderRadius: 11,
                backgroundColor: theme.accent,
              }}>
                <Feather name="clock" size={14} color={isDarkMode ? '#0B1020' : '#1E1A14'} />
                <Text style={{ color: isDarkMode ? '#0B1020' : '#1E1A14', fontWeight: '900', fontSize: 14 }}>
                  {slotLabel(sl)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {colleagues.length ? (
          <>
            <Text style={{ fontSize: 10.5, fontWeight: '900', letterSpacing: 1, color: theme.subtitle, marginBottom: 7 }}>
              {working ? 'ΜΑΖΙ ΣΟΥ' : 'ΔΟΥΛΕΥΟΥΝ'}
            </Text>
            {colleagues.map((c, i) => (
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, paddingVertical: 5,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                  <Feather name="user" size={13} color={theme.subtitle} />
                  <Text style={{ color: theme.text, fontSize: 13.5, flexShrink: 1 }} numberOfLines={1}>
                    {c.name}
                  </Text>
                </View>
                <Text style={{ color: theme.subtitle, fontSize: 12.5, fontWeight: '700' }}>
                  {c.slots.map(slotLabel).join(' · ')}
                </Text>
              </View>
            ))}
          </>
        ) : !working ? (
          <Text style={{ color: theme.subtitle, fontSize: 13 }}>Κανείς δεν έχει προγραμματιστεί.</Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 40 }}>
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={currentUser.full_name} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 34 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <ScreenTitle isDarkMode={isDarkMode} icon="clipboard">Το πρόγραμμά μου</ScreenTitle>

        <WeekSwitcher
          isDarkMode={isDarkMode}
          label={formatWeekRange(monday)}
          badge={publishedAt
            ? `Ανακοινώθηκε ${new Date(publishedAt).toLocaleDateString('el-GR')}`
            : 'Δεν έχει ανακοινωθεί'}
          onPrev={() => setMonday(addDays(monday, -7))}
          onNext={() => setMonday(addDays(monday, 7))}
        />

        {loading ? (
          <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 40 }} />
        ) : !publishedAt ? (
          <>
            <EmptyState
              isDarkMode={isDarkMode}
              icon="calendar"
              title="Δεν έχει ανακοινωθεί πρόγραμμα"
              subtitle="Μόλις η διαχείριση καταρτίσει το πρόγραμμα της εβδομάδας, θα το βρεις εδώ."
            />
            <InfoBox isDarkMode={isDarkMode} icon="edit-3">
              Στο μεταξύ, δήλωσε τη διαθεσιμότητά σου από το μενού «Διαθεσιμότητα εβδομάδας».
            </InfoBox>
          </>
        ) : (
          <>
            {/* ── Η εβδομάδα μου με μια ματιά ─────────────────────────────── */}
            <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 14 }}>
              {[
                { icon: 'calendar', label: 'Ημέρες', value: String(myDays) },
                { icon: 'clock', label: 'Ώρες', value: myHours > 0 ? formatHours(myHours) : '—' },
              ].map((s) => (
                <View key={s.label} style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9,
                  backgroundColor: theme.surface, borderRadius: 14,
                  borderWidth: 1, borderColor: theme.border, padding: 12,
                }}>
                  <Feather name={s.icon} size={17} color={theme.accent} />
                  <View style={{ flexShrink: 1 }}>
                    <Text style={{ fontSize: 10.5, color: theme.subtitle, fontWeight: '700' }}>{s.label}</Text>
                    <Text style={{ fontSize: 15, color: theme.text, fontWeight: '900', marginTop: 1 }} numberOfLines={1}>
                      {s.value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={{ paddingHorizontal: 16 }}>
              {weekDates(monday).map((d, i) => renderDay(ymd(d), i))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
