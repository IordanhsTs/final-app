import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { supabase } from '../../supabase';
import { Colors } from '../styles/globalStyles';
import { ScreenHeader, ScreenTitle, EmptyState } from './ScreenShell';
import { getLastReadAt, markAnnouncementsRead } from '../services/announcementsStore';
import { formatDay } from '../utils/week';

// ── Ανακοινώσεις κέντρου ────────────────────────────────────────────────────
// Ό,τι ακριβώς ζήτησε ο πελάτης: ημερομηνία, τίτλος, ελεύθερο κείμενο. Καμία
// αλληλεπίδραση, καμία απάντηση — είναι πίνακας ανακοινώσεων, όχι συνομιλία.
// (Τα επείγοντα μηνύματα προς διανομείς έχουν ήδη δικό τους δρόμο με ήχο και
// modal· εδώ μπαίνουν τα «άλλαξε ο κωδικός της πόρτας».)

export default function AnnouncementsScreen({ currentUser, isDarkMode, onBack, onRead }) {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Ποιες ήταν αδιάβαστες ΤΗ ΣΤΙΓΜΗ ΠΟΥ ΑΝΟΙΞΕ Η ΟΘΟΝΗ. Κρατιέται ξεχωριστά
  // επειδή σημειώνουμε αμέσως «διαβάστηκαν όλες» — χωρίς αυτό, η σήμανση «ΝΕΟ»
  // θα εξαφανιζόταν την ίδια στιγμή που εμφανίζεται.
  const [unreadSince, setUnreadSince] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lastRead = await getLastReadAt();
      setUnreadSince(lastRead);

      const { data } = await supabase.from('announcements')
        .select('id, title, body, pinned, created_at')
        .eq('is_active', true)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      setRows(data || []);

      // Διαβάστηκαν όλες μόλις ανοίξει η οθόνη — η κουκκίδα σβήνει επιστρέφοντας.
      await markAnnouncementsRead();
      if (onRead) onRead();
    } catch (e) {
      console.log('Announcements load error:', e);
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onRead]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 40 }}>
      <ScreenHeader isDarkMode={isDarkMode} onBack={onBack} driverName={currentUser.full_name} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 34 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 6, marginBottom: 16 }}>
          <Ionicons name="megaphone-outline" size={24} color={theme.accent} />
          <Text style={{ fontSize: 23, fontWeight: '900', color: theme.text, flexShrink: 1 }}>
            Ανακοινώσεις
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 40 }} />
        ) : !rows.length ? (
          <EmptyState
            isDarkMode={isDarkMode}
            icon="inbox"
            title="Καμία ανακοίνωση"
            subtitle="Ό,τι ανακοινώνει το κέντρο θα εμφανίζεται εδώ."
          />
        ) : (
          <View style={{ paddingHorizontal: 16 }}>
            {rows.map((a) => {
              const created = new Date(a.created_at);
              const isNew = unreadSince ? created > new Date(unreadSince) : true;

              return (
                <View key={a.id} style={{
                  backgroundColor: theme.surface, borderRadius: 16,
                  borderWidth: 1, borderColor: a.pinned ? theme.accent : theme.border,
                  marginBottom: 12, padding: 15,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Feather name="calendar" size={12} color={theme.subtitle} />
                    <Text style={{ fontSize: 12, color: theme.subtitle, fontWeight: '600' }}>
                      {formatDay(created)} {created.getFullYear()} · {created.getHours()}:{String(created.getMinutes()).padStart(2, '0')}
                    </Text>

                    {a.pinned ? (
                      <View style={{
                        paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
                        backgroundColor: isDarkMode ? 'rgba(212,168,83,0.16)' : 'rgba(197,160,102,0.18)',
                      }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '900', letterSpacing: 0.5, color: theme.accent }}>
                          ΣΗΜΑΝΤΙΚΟ
                        </Text>
                      </View>
                    ) : null}

                    {isNew ? (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: '#EF4444' }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '900', letterSpacing: 0.5, color: '#FFF' }}>ΝΕΟ</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={{ fontSize: 16.5, fontWeight: '900', color: theme.text, marginBottom: 7 }}>
                    {a.title}
                  </Text>
                  <Text style={{ fontSize: 14, lineHeight: 21, color: theme.subtitle }}>
                    {a.body}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
