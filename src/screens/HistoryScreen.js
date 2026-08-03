import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, ScrollView } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabase';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, ScreenTitle, EmptyState } from './ScreenShell';
import { formatKm, orderDurations } from '../utils/orderInfo';

// ── Ιστορικό & Στατιστικά ───────────────────────────────────────────────────
// ΙΔΙΑ ΔΕΔΟΜΕΝΑ, ΝΕΟ ΝΤΥΣΙΜΟ (αίτημα πελάτη 03/08/2026): κάθε νούμερο και κάθε
// φίλτρο έμεινε ακριβώς όπως ήταν· άλλαξε μόνο η εμφάνιση ώστε να μιλάει την
// ίδια γλώσσα με τις υπόλοιπες οθόνες — κεφαλίδα ScreenShell, κάρτες `surface`
// με στρογγυλεμένες γωνίες, χρυσές ενεργές επιλογές.
//
// Βγήκε από το DriverDashboard σε δικό του αρχείο: εκεί μέσα ήταν ~170 γραμμές
// JSX που δεν είχαν καμία σχέση με τη λίστα παραγγελιών.

// Ένα γράμμα ανά διάστημα (αίτημα πελάτη 03/08/2026): «Σ» για Σήμερα, ο αριθμός
// για τις ημέρες, «C» για το ελεύθερο διάστημα. Τα πλήρη ονόματα έσπαγαν σε δύο
// σειρές κουμπιών και έτρωγαν το μισό πάνω μέρος της οθόνης.
const PERIODS = [
  { v: 0, key: 'Σ', label: 'Σήμερα' },
  { v: 3, key: '3', label: '3 ημέρες' },
  { v: 5, key: '5', label: '5 ημέρες' },
  { v: 7, key: '7', label: '7 ημέρες' },
  { v: -1, key: 'C', label: 'Επιλογή' },
];

export default function HistoryScreen({ currentUser, isDarkMode, onBack }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  const [historyPeriod, setHistoryPeriod] = useState(0); // 0=Σήμερα, 3, 5, 7, -1=Custom
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('date');
  const [pickerTarget, setPickerTarget] = useState('start');
  const [historyData, setHistoryData] = useState([]);
  // 'summary' = ανά κατάστημα · 'detailed' = μία γραμμή ανά παραγγελία.
  const [historyView, setHistoryView] = useState('summary');
  // Φίλτρο καταστημάτων: άδειο = ΟΛΑ. Το φιλτράρισμα γίνεται τοπικά ώστε οι
  // επιλογές να μη χάνονται και να μη χτυπάμε τη βάση σε κάθε πάτημα.
  const [storeFilter, setStoreFilter] = useState([]);

  useEffect(() => { fetchHistory(); }, [historyPeriod, startDate, endDate]);

  async function fetchHistory() {
    let start = new Date(); let end = new Date();
    if (historyPeriod === 0) {
      start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
    } else if (historyPeriod > 0) {
      start.setDate(start.getDate() - historyPeriod); start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
    } else {
      start = startDate; end = endDate;
    }

    const { data } = await supabase.from('orders')
      .select('*, stores(name, delivery_fee)')
      .eq('status', 'completed').eq('driver_id', currentUser.id)
      .gte('completed_at', start.toISOString())
      .lte('completed_at', end.toISOString());
    const rows = data || [];
    setHistoryData(rows);
    // Αλλάζοντας διάστημα, καταστήματα που δεν υπάρχουν πια στα δεδομένα θα
    // έμεναν επιλεγμένα και θα έδειχναν κενή λίστα χωρίς προφανή λόγο.
    const availableIds = new Set(rows.map((o) => o.store_id));
    setStoreFilter((prev) => prev.filter((id) => availableIds.has(id)));
  }

  const handleDateChange = (event, selectedDate) => {
    setShowPicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;

    const isStart = pickerTarget === 'start';
    const currentDate = isStart ? startDate : endDate;

    if (pickerMode === 'date') {
      const newD = new Date(currentDate);
      newD.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      if (isStart) setStartDate(newD); else setEndDate(newD);
      setTimeout(() => { setPickerMode('time'); setShowPicker(true); }, 100);
    } else {
      const newD = new Date(currentDate);
      newD.setHours(selectedDate.getHours(), selectedDate.getMinutes());
      if (isStart) setStartDate(newD); else setEndDate(newD);
      setPickerMode('date');
    }
  };

  // ── Παράγωγα ──────────────────────────────────────────────────────────────
  const historyStores = [];
  const seenStoreIds = new Set();
  historyData.forEach((o) => {
    if (!o.store_id || seenStoreIds.has(o.store_id)) return;
    seenStoreIds.add(o.store_id);
    historyStores.push({ id: o.store_id, name: o.stores?.name || 'Άγνωστο Κατάστημα' });
  });
  historyStores.sort((a, b) => a.name.localeCompare(b.name, 'el'));

  const filteredHistory = storeFilter.length === 0
    ? historyData
    : historyData.filter((o) => storeFilter.includes(o.store_id));

  const toggleStoreFilter = (id) =>
    setStoreFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  let totalDeliveryMins = 0; let countWithTime = 0;
  let coffeeCount = 0; let foodCount = 0;
  let totalRevenue = 0;
  let totalKm = 0;
  const storeCounts = {};

  filteredHistory.forEach((o) => {
    if (o.accepted_at && o.completed_at) {
      totalDeliveryMins += (new Date(o.completed_at) - new Date(o.accepted_at)) / 60000;
      countWithTime++;
    }
    const fee = parseFloat(o.stores?.delivery_fee);
    if (fee === 1.5) {
      coffeeCount++;
      totalRevenue += 1.0;
    } else if (fee === 1.8) {
      foodCount++;
      totalRevenue += 1.3;
    } else if (!isNaN(fee)) {
      totalRevenue += Math.max(0, fee - 0.5); // άλλη χρέωση: αφαιρούμε τα 50 λεπτά της εταιρείας
    }
    const sName = o.stores?.name || 'Άγνωστο Κατάστημα';
    storeCounts[sName] = (storeCounts[sName] || 0) + 1;
    const d = parseFloat(o.distance_km);
    if (!isNaN(d)) totalKm += d;
  });

  const totalOrders = filteredHistory.length;
  const avgTime = countWithTime > 0 ? (totalDeliveryMins / countWithTime).toFixed(1) : 0;
  const formattedRevenue = totalRevenue.toFixed(2);

  // ── Κοινά στυλ ────────────────────────────────────────────────────────────
  const card = {
    backgroundColor: theme.surface, borderRadius: 16,
    borderWidth: 1, borderColor: theme.border,
  };

  const pill = (active) => ({
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: active ? theme.accent : theme.surface,
    borderWidth: 1, borderColor: active ? theme.accent : theme.border,
  });

  const pillText = (active) => ({
    fontSize: 13, fontWeight: active ? '900' : '600',
    color: active ? (isDarkMode ? '#0B1020' : '#1E1A14') : theme.text,
  });

  const statBox = (value, label, color) => (
    <View key={label} style={[card, { flex: 1, padding: 14, alignItems: 'center' }]}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: color || theme.accent }}>{value}</Text>
      <Text style={{ fontSize: 12, color: theme.subtitle, textAlign: 'center', fontWeight: '700', marginTop: 4 }}>
        {label}
      </Text>
    </View>
  );

  const header = (
    <View>
      <ScreenTitle isDarkMode={isDarkMode} icon="pie-chart">Ιστορικό & Στατιστικά</ScreenTitle>

      {/* ── Διάστημα ──────────────────────────────────────────────────────── */}
      {/* Πέντε κύκλοι σε μία σειρά. Δίπλα τους μένει το όνομα της ενεργής
          επιλογής, ώστε να μη χρειάζεται να μαντέψει κανείς τι σημαίνει το
          γράμμα την πρώτη φορά. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 12 }}>
        {PERIODS.map((f) => {
          const on = historyPeriod === f.v;
          return (
            <TouchableOpacity
              key={f.v}
              onPress={() => setHistoryPeriod(f.v)}
              accessibilityLabel={f.label}
              style={{
                width: 42, height: 42, borderRadius: 21,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? theme.accent : theme.surface,
                borderWidth: 1, borderColor: on ? theme.accent : theme.border,
              }}
            >
              <Text style={{
                fontSize: 16, fontWeight: '900',
                color: on ? (isDarkMode ? '#0B1020' : '#1E1A14') : theme.text,
              }}>
                {f.key}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text
          style={{ flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: theme.subtitle }}
          numberOfLines={1}
        >
          {PERIODS.find((f) => f.v === historyPeriod)?.label}
        </Text>
      </View>

      {historyPeriod === -1 && (
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 }}>
          {[
            { label: 'Από', date: startDate, target: 'start' },
            { label: 'Έως', date: endDate, target: 'end' },
          ].map((f) => (
            <TouchableOpacity
              key={f.target}
              style={[card, { flex: 1, padding: 12 }]}
              onPress={() => { setPickerTarget(f.target); setPickerMode('date'); setShowPicker(true); }}
            >
              <Text style={{ fontSize: 10.5, color: theme.subtitle, fontWeight: '700', marginBottom: 3 }}>{f.label}</Text>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '800' }}>
                {f.date.getDate()}/{f.date.getMonth() + 1} {f.date.getHours()}:{String(f.date.getMinutes()).padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showPicker && (
        <DateTimePicker
          value={pickerTarget === 'start' ? startDate : endDate}
          mode={pickerMode}
          is24Hour
          display="default"
          onChange={handleDateChange}
        />
      )}

      {/* ── Φίλτρο καταστημάτων ───────────────────────────────────────────── */}
      {historyStores.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 14 }}
        >
          <TouchableOpacity style={pill(storeFilter.length === 0)} onPress={() => setStoreFilter([])}>
            <Text style={pillText(storeFilter.length === 0)}>Όλα</Text>
          </TouchableOpacity>
          {historyStores.map((s) => {
            const on = storeFilter.includes(s.id);
            return (
              <TouchableOpacity key={s.id} style={pill(on)} onPress={() => toggleStoreFilter(s.id)}>
                <Text style={pillText(on)}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Κέρδος: το νούμερο που κοιτάει πρώτο ο διανομέας ───────────────── */}
      <View style={[card, {
        marginHorizontal: 16, marginBottom: 10, padding: 18, alignItems: 'center',
        borderColor: theme.accent,
        backgroundColor: isDarkMode ? 'rgba(212,168,83,0.07)' : 'rgba(197,160,102,0.08)',
      }]}>
        <Text style={{ fontSize: 11.5, color: theme.subtitle, fontWeight: '700', letterSpacing: 0.8 }}>
          ΣΥΝΟΛΙΚΟ ΚΕΡΔΟΣ
        </Text>
        <Text style={{ fontSize: 36, fontWeight: '900', color: theme.accent, marginTop: 4 }}>
          {formattedRevenue}€
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 }}>
        {statBox(totalOrders, 'Παραγγελίες')}
        {statBox(`${avgTime}'`, 'Μ.Ο. Διανομής')}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 }}>
        {statBox(foodCount, 'Φαγητά (1.30€)', '#E53935')}
        {statBox(coffeeCount, 'Καφέδες (1.00€)', '#8E44AD')}
        {statBox(totalKm.toFixed(1), 'Συνολικά χλμ', '#208AEF')}
      </View>

      {/* ── Τρόπος προβολής ───────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 14,
        backgroundColor: theme.toggleBg, borderRadius: 14, padding: 4, gap: 4,
      }}>
        {[
          { key: 'summary', label: 'Ανά κατάστημα' },
          { key: 'detailed', label: 'Αναλυτικά' },
        ].map((v) => {
          const on = historyView === v.key;
          return (
            <TouchableOpacity
              key={v.key}
              onPress={() => setHistoryView(v.key)}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center',
                backgroundColor: on ? theme.accent : 'transparent',
              }}
            >
              <Text style={{
                fontSize: 13, fontWeight: '900',
                color: on ? (isDarkMode ? '#0B1020' : '#1E1A14') : theme.subtitle,
              }}>
                {v.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const summaryRows = Object.entries(storeCounts).sort((a, b) => b[1] - a[1]);
  const detailedRows = [...filteredHistory].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  const renderSummaryRow = ({ item }) => (
    <View style={[card, {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginHorizontal: 16, marginBottom: 8, paddingVertical: 14, paddingHorizontal: 15,
    }]}>
      <Text style={{ color: theme.text, fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{item[0]}</Text>
      <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '900' }}>{item[1]}</Text>
    </View>
  );

  const renderDetailedRow = ({ item }) => {
    const { acceptedMins } = orderDurations(item);
    const completed = item.completed_at ? new Date(item.completed_at) : null;
    const km = formatKm(item.distance_km);
    const chip = {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: theme.toggleBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    };

    return (
      <View style={[card, { marginHorizontal: 16, marginBottom: 8, padding: 14 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ fontWeight: '900', fontSize: 15, color: theme.text, flexShrink: 1 }} numberOfLines={1}>
            {item.stores?.name || 'Άγνωστο Κατάστημα'}
          </Text>
          {completed ? (
            <Text style={{ fontSize: 12, color: theme.subtitle }}>
              {completed.getDate()}/{completed.getMonth() + 1} {completed.getHours()}:{String(completed.getMinutes()).padStart(2, '0')}
            </Text>
          ) : null}
        </View>

        <Text style={{ fontSize: 13, color: theme.subtitle, marginBottom: 8 }} numberOfLines={1}>
          <Feather name="corner-down-right" size={11} color={theme.subtitle} /> {item.address}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {item.payment_method ? (
            <View style={{
              paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
              backgroundColor: item.payment_method === 'cash' ? '#10B981' : '#208AEF',
            }}>
              <Text style={{ fontWeight: '900', color: '#FFF', fontSize: 10, letterSpacing: 0.5 }}>
                {item.payment_method === 'cash' ? 'ΜΕΤΡΗΤΑ' : 'ΚΑΡΤΑ'}
              </Text>
            </View>
          ) : null}
          {km ? (
            <View style={chip}>
              <Feather name="map-pin" size={10} color={theme.subtitle} />
              <Text style={{ fontWeight: '800', color: theme.subtitle, fontSize: 10 }}>{km}</Text>
            </View>
          ) : null}
          <View style={chip}>
            <Feather name="clock" size={10} color={theme.subtitle} />
            <Text style={{ fontWeight: '800', color: theme.subtitle, fontSize: 10 }}>{acceptedMins} λ.</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 40 }}>
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={currentUser.full_name} />

      <FlatList
        data={historyView === 'summary' ? summaryRows : detailedRows}
        keyExtractor={(item) => (historyView === 'summary' ? item[0] : String(item.id))}
        renderItem={historyView === 'summary' ? renderSummaryRow : renderDetailedRow}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 34 }}
        ListEmptyComponent={
          <EmptyState
            isDarkMode={isDarkMode}
            icon="inbox"
            title="Καμία παραγγελία"
            subtitle="Δεν υπάρχουν ολοκληρωμένες παραγγελίες σε αυτό το διάστημα."
          />
        }
      />
    </View>
  );
}
