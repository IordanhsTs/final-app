import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, Alert, Vibration, Linking, Platform, AppState, Modal } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, clearDriverPresenceEverywhere, getTenantSchema, isReadOnly, onBackendChange } from '../../supabase';
import { getStyles } from '../styles/globalStyles';
import { Feather, Ionicons } from '@expo/vector-icons';

const notificationSound = require('../../assets/notification.mp3');



export default function DriverDashboard({ currentUser, setCurrentUser, isDarkMode, setIsDarkMode }) {
  const styles = getStyles(isDarkMode);
  
  // ΤΟ HOOK ΜΠΑΙΝΕΙ ΑΥΣΤΗΡΑ ΕΔΩ ΣΤΗΝ ΚΟΡΥΦΗ!
  const player = useAudioPlayer(notificationSound);

  const [pendingOrders, setPendingOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [refreshing, setRefreshing] = useState(false);
  
  // States για Ιστορικό & Μενού
  const [menuVisible, setMenuVisible] = useState(false);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState(0); // 0=Σήμερα, 3, 5, 7, -1=Custom
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('date');
  const [pickerTarget, setPickerTarget] = useState('start');
  const [historyData, setHistoryData] = useState([]);
  
  // States για Custom Modal Επιβεβαίωσης
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', onConfirm: null });

  // State για μηνύματα από το Κέντρο Ελέγχου
  const [systemAlert, setSystemAlert] = useState(null);
  const [lastLocationUpdate, setLastLocationUpdate] = useState("Περιμένω στίγμα...");
  const [locationPermStatus, setLocationPermStatus] = useState('...');

  // READ-ONLY-ON-FAILOVER: μπάρα + κλείδωμα ενεργειών όταν τρέχουμε στο εφεδρικό
  // (standby). Ενημερώνεται σε κάθε αλλαγή backend (το switchTo δεν κάνει reload).
  const [readOnly, setReadOnly] = useState(isReadOnly());
  useEffect(() => {
    const off = onBackendChange(() => setReadOnly(isReadOnly()));
    return off;
  }, []);

  // MULTI-TENANT: η πόλη για το navigation deep-link έρχεται από τον companies
  // (όχι καρφωτή). Fallback «Φλώρινα» — σωστό για τον 1ο πελάτη + backward-compatible
  // όσο δεν υπάρχει hook/companies (τότε το query αποτυγχάνει σιωπηλά).
  const [city, setCity] = useState('Φλώρινα');
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.schema('public').from('companies')
          .select('city').eq('schema_name', getTenantSchema()).maybeSingle();
        if (data?.city) setCity(data.city);
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    fetchOrders();

    // Φόρτωση κατάστασης άδειας τοποθεσίας απευθείας από το OS (όχι cache)
    const checkPerms = async () => {
      const bgPerm = await Location.getBackgroundPermissionsAsync();
      setLocationPermStatus(bgPerm.status);
    };
    checkPerms();



    // Listeners για ανανέωση δεδομένων μέσω Push Notifications
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      fetchOrders();
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      fetchOrders(); // Όταν ο οδηγός κάνει tap την ειδοποίηση από Lock Screen / Background
    });

    const channel = supabase
      .channel(`driver_orders_${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: getTenantSchema(), table: 'orders' }, () => {
        // Μόνο ανανέωση UI — ο ήχος παίζεται αποκλειστικά μέσω FCM push notification
        fetchOrders();
      })
      .subscribe();

    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') fetchOrders(); 
    });

    // ─── ΛΗΨΗ ΜΗΝΥΜΑΤΩΝ ΑΠΟ ΚΕΝΤΡΟ ΕΛΕΓΧΟΥ (BROADCAST) ───
    const systemAlertChannel = supabase
      .channel('system_alerts')
      .on('broadcast', { event: 'admin_message' }, (payload) => {
        const data = payload.payload;
        if (!data) return;
        const targets = Array.isArray(data.target_ids) ? data.target_ids : [data.target_id];
        if (data.target_type === 'driver' && (targets.includes('all') || targets.includes(currentUser.id))) {
          setSystemAlert(data.message);
          triggerNotification();
        }
      })
      .subscribe();

    // ─── ΛΗΨΗ ΑΛΛΑΓΩΝ GPS ΣΕ ΠΡΑΓΜΑΤΙΚΟ ΧΡΟΝΟ ΓΙΑ MONITORING ───
    const driverChannel = supabase
      .channel(`driver_monitor_${currentUser.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: getTenantSchema(), table: 'drivers', filter: `id=eq.${currentUser.id}` }, (payload) => {
        if (payload.new.latitude && payload.new.longitude) {
          const now = new Date();
          setLastLocationUpdate(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`);
        }
      })
      .subscribe();

    return () => {
      if (notificationListener) notificationListener.remove();
      if (responseListener) responseListener.remove();
      supabase.removeChannel(channel); 
      supabase.removeChannel(systemAlertChannel);
      supabase.removeChannel(driverChannel);
      appStateSubscription.remove();
    };
  }, []); // Αφαιρέσαμε το player από εδώ για να μην κλείνει η σύνδεση!

  // Η συνάρτηση πλέον απλά πατάει το "Play"
  async function triggerNotification(isDirect = false) {
    if (isDirect) {
      // Συνεχόμενη δόνηση
      Vibration.vibrate([0, 500, 200], true);
      
      const playSound = () => {
        try {
          if (player) {
            player.seekTo(0);
            player.play();
          }
        } catch (e) { console.log("Audio Error:", e); }
      };

      playSound(); // Αρχικό παίξιμο
      
      let count = 0;
      const interval = setInterval(() => {
        playSound();
        count++;
        if (count >= 3) { // 3 επαναλήψεις * 1500ms = 4.5 δευτερόλεπτα
          clearInterval(interval);
          Vibration.cancel();
        }
      }, 1500);

      // Ασφάλεια τερματισμού στα 5 δευτερόλεπτα
      setTimeout(() => {
        clearInterval(interval);
        Vibration.cancel();
      }, 5000);
      
    } else {
      Vibration.vibrate([0, 500, 200, 500]);
      try {
        if (player) {
          player.seekTo(0); // Επαναφορά του ήχου στην αρχή
          player.play();
        }
      } catch (e) { 
        console.log("Audio Error:", e); 
      }
    }
  }

  useEffect(() => {
    if (isHistoryVisible) fetchHistory();
  }, [isHistoryVisible, historyPeriod, startDate, endDate]);

  async function fetchHistory() {
    let start = new Date(); let end = new Date();
    if (historyPeriod === 0) {
      start.setHours(0,0,0,0); end.setHours(23,59,59,999);
    } else if (historyPeriod > 0) {
      start.setDate(start.getDate() - historyPeriod); start.setHours(0,0,0,0); end.setHours(23,59,59,999);
    } else {
      start = startDate; end = endDate;
    }

    const { data } = await supabase.from('orders')
      .select('*, stores(name, delivery_fee)')
      .eq('status', 'completed').eq('driver_id', currentUser.id)
      .gte('completed_at', start.toISOString())
      .lte('completed_at', end.toISOString());
    setHistoryData(data || []);
  }

  async function fetchOrders() {
    setRefreshing(true);
    try {
      const { data: storesList } = await supabase.from('stores').select('id, name, phone');
      const storesMap = {};
      if (storesList) storesList.forEach(s => { storesMap[s.id] = { name: s.name, phone: s.phone }; });

      const { data: pending } = await supabase.from('orders').select('*').eq('status', 'pending').order('created_at', { ascending: false });
      const { data: mine } = await supabase.from('orders').select('*').eq('status', 'accepted').eq('driver_id', currentUser.id).order('created_at', { ascending: false });

      const mapStoreName = (orders) => (orders || []).map(order => ({
        ...order,
        store_name: storesMap[order.store_id]?.name || 'Κεντρικό Κατάστημα',
        store_phone: storesMap[order.store_id]?.phone || null
      }));

      setPendingOrders(mapStoreName(pending));
      setMyOrders(mapStoreName(mine));
    } catch (e) { 
      console.log("Fetch Error:", e); 
    } finally { 
      setRefreshing(false); 
    }
  }

  async function acceptOrder(orderId) {
    if (isReadOnly()) {
      Alert.alert('Εφεδρική λειτουργία', 'Το σύστημα τρέχει προσωρινά σε εφεδρική λειτουργία (μόνο ανάγνωση). Δοκιμάστε ξανά μόλις αποκατασταθεί το κύριο σύστημα.');
      return;
    }
    setConfirmConfig({
      title: "Αποδοχή Παραγγελίας",
      message: "Είστε σίγουρος πως θέλετε να κάνετε αποδοχή;",
      onConfirm: async () => {
        setConfirmModalVisible(false);
        const { data } = await supabase
          .from('orders')
          .update({ status: 'accepted', driver_id: currentUser.id, accepted_at: new Date().toISOString() })
          .eq('id', orderId)
          .eq('status', 'pending')
          .select();
  
        if (data && data.length > 0) {
          fetchOrders();
        } else {
          Alert.alert('Αποτυχία', 'Η παραγγελία έγινε ήδη αποδεκτή.');
          fetchOrders();
        }
      }
    });
    setConfirmModalVisible(true);
  }

  async function completeOrder(orderId) {
    if (isReadOnly()) {
      Alert.alert('Εφεδρική λειτουργία', 'Το σύστημα τρέχει προσωρινά σε εφεδρική λειτουργία (μόνο ανάγνωση). Δοκιμάστε ξανά μόλις αποκατασταθεί το κύριο σύστημα.');
      return;
    }
    setConfirmConfig({
      title: "Ολοκλήρωση Παραγγελίας",
      message: "Είστε σίγουρος πως η παραγγελία παραδόθηκε;",
      onConfirm: async () => {
        setConfirmModalVisible(false);
        await supabase.from('orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', orderId);
        fetchOrders();
      }
    });
    setConfirmModalVisible(true);
  }

  async function handleDriverLogout() {
    // Καθάρισμα σε ΟΛΑ τα backends (όχι μόνο στο ενεργό) ώστε να σταματήσουν
    // οι ειδοποιήσεις παραγγελιών από οποιοδήποτε σύστημα.
    await clearDriverPresenceEverywhere(currentUser.id);
    await supabase.removeAllChannels(); // FORCE KILL ALL LISTENERS
    await supabase.auth.signOut();
    setCurrentUser(null);
  }

  const handleCall = (phone, name) => {
    if (!phone) {
      Alert.alert("Σφάλμα", "Δεν υπάρχει διαθέσιμο τηλέφωνο.");
      return;
    }
    setConfirmConfig({
      title: "Κλήση",
      message: `Θέλετε να καλέσετε το κατάστημα:\n${name}\n(${phone})`,
      onConfirm: () => {
        setConfirmModalVisible(false);
        Linking.openURL(`tel:${phone}`);
      }
    });
    setConfirmModalVisible(true);
  };

  const handleDateChange = (event, selectedDate) => {
    setShowPicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;
    
    const isStart = pickerTarget === 'start';
    const currentDate = isStart ? startDate : endDate;
    
    if (pickerMode === 'date') {
      const newD = new Date(currentDate); newD.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      if (isStart) setStartDate(newD); else setEndDate(newD);
      setTimeout(() => { setPickerMode('time'); setShowPicker(true); }, 100);
    } else {
      const newD = new Date(currentDate); newD.setHours(selectedDate.getHours(), selectedDate.getMinutes());
      if (isStart) setStartDate(newD); else setEndDate(newD);
      setPickerMode('date');
    }
  };

  const renderOrderItem = ({ item }) => {
    const isCompleted = item.status === 'completed';
    const mins = Math.floor((new Date() - new Date(item.created_at)) / 60000);
    
    const tCreate = new Date(item.created_at);
    const tAccept = item.accepted_at ? new Date(item.accepted_at) : null;
    const tComplete = item.completed_at ? new Date(item.completed_at) : null;
    
    const totalMins = tComplete ? Math.floor((tComplete - tCreate) / 60000) : mins;
    const deliveryMins = tComplete && tAccept ? Math.floor((tComplete - tAccept) / 60000) : 0;
    const pendingMins = tAccept ? Math.floor((tAccept - tCreate) / 60000) : totalMins;

    // Χρώματα χρόνου: Πράσινο μέχρι 9 λεπτά, Κόκκινο από 10 και πάνω. Ολοκληρωμένες πάντα πράσινες.
    const isWarning = !isCompleted && mins > 9;
    const timeColor = isWarning ? '#EF4444' : '#10B981';
    const timeBgColor = isWarning 
      ? (isDarkMode ? '#3a1e1e' : '#FFEBEE') 
      : (isDarkMode ? '#1e3a24' : '#E8F5E9');

    return (
      <View style={styles.orderCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#333' : '#E5E7EB', paddingBottom: 12 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontWeight: '900', fontSize: 18, color: isDarkMode ? '#C5A066' : '#8A7347', flexShrink: 1, letterSpacing: 0.5 }} numberOfLines={1}>
              <Ionicons name="storefront-outline" size={16} color={isDarkMode ? '#C5A066' : '#8A7347'} /> {item.store_name}
            </Text>
            {item.store_phone ? (
              <TouchableOpacity onPress={() => handleCall(item.store_phone, item.store_name)} style={{ marginLeft: 8, padding: 6, backgroundColor: isDarkMode ? '#222' : '#F3F4F6', borderRadius: 12 }}>
                <Feather name="phone-call" size={18} color={isDarkMode ? '#EAD7B1' : '#121212'} />
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={{ backgroundColor: timeBgColor, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, justifyContent: 'center', marginLeft: 8 }}>
            <Text style={{color: timeColor, fontWeight:'900', fontSize: 13}}>
              {isCompleted ? <Text><Feather name="clock" size={12} /> {totalMins} λ.</Text> : `${mins} λ.`}
            </Text>
          </View>
        </View>

        <Text style={[styles.orderAddress, { color: isDarkMode ? '#EAD7B1' : '#1F2937', fontSize: 17, marginBottom: 12 }]}>{item.address}</Text>
        
        {item.payment_method ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: item.comments ? 12 : 4 }}>
            <View style={{ backgroundColor: item.payment_method === 'cash' ? '#10B981' : '#208AEF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, justifyContent: 'center', alignItems: 'center', shadowColor: item.payment_method === 'cash' ? '#10B981' : '#208AEF', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: {width: 0, height: 2} }}>
              <Text style={{fontWeight: '900', color: '#FFF', fontSize: 12, textAlign: 'center', letterSpacing: 1}}>
                {item.payment_method === 'cash' ? <><Feather name="dollar-sign" size={12} color="#FFF" /> ΜΕΤΡΗΤΑ</> : <><Feather name="credit-card" size={12} color="#FFF" /> ΚΑΡΤΑ</>}
              </Text>
            </View>
          </View>
        ) : null}
        
        {item.comments ? <Text style={[styles.commentText, { fontSize: 14, padding: 8, backgroundColor: isDarkMode ? '#222' : '#F3F4F6', color: isDarkMode ? '#A0A0A0' : '#4B5563' }]}><Feather name="message-square" size={12} /> {item.comments}</Text> : null}
        
        {item.status === 'pending' && (
          <TouchableOpacity style={[styles.premiumButtonWrapper, { shadowColor: '#C5A066' }]} onPress={() => acceptOrder(item.id)}>
            <View style={[styles.premiumButtonBackground, { backgroundColor: '#C5A066' }]}>
              <Text style={[styles.premiumButtonText, { color: '#121212' }]}>ΑΠΟΔΟΧΗ</Text>
            </View>
          </TouchableOpacity>
        )}
        
        {item.status === 'accepted' && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 15, gap: 10 }}>
            <TouchableOpacity 
              style={[styles.premiumButtonWrapper, { flex: 1, marginTop: 0, shadowColor: isDarkMode ? '#000' : '#CCC' }]} 
              onPress={() => {
                const fullDestination = `${item.address}, ${city}, Ελλάδα`;
                Linking.openURL(Platform.select({
                  ios: `maps:0,0?q=${fullDestination}`,
                  android: `google.navigation:q=${fullDestination}`
                }));
              }}
            >
              <View style={[styles.premiumButtonBackground, { backgroundColor: isDarkMode ? '#333333' : '#E5E7EB' }]}>
                <Text style={[styles.premiumButtonText, { color: isDarkMode ? '#EAD7B1' : '#374151' }]}><Feather name="navigation" size={14} /> ΠΛΟΗΓΗΣΗ</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.premiumButtonWrapper, { flex: 1, marginTop: 0, shadowColor: '#10B981' }]} 
              onPress={() => completeOrder(item.id)}
            >
              <View style={[styles.premiumButtonBackground, { backgroundColor: '#10B981' }]}>
                <Text style={[styles.premiumButtonText, { color: '#FFF' }]}><Feather name="check-circle" size={14} /> ΠΑΡΑΔΟΣΗ</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {isCompleted && (
          <Text style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 13, marginTop: 12, fontStyle: 'italic', borderTopWidth: 1, borderTopColor: isDarkMode ? '#333' : '#E5E7EB', paddingTop: 10 }}>
            <Feather name="clock" size={12} /> Συνολικά: {totalMins} λ. (Αναμονή: {pendingMins} λ. | Διανομή: {deliveryMins} λ.)
          </Text>
        )}
      </View>
    );
  };

  // Υπολογισμοί Στατιστικών
  let totalOrders = historyData.length;
  let totalDeliveryMins = 0; let countWithTime = 0;
  let coffeeCount = 0; let foodCount = 0;
  let totalRevenue = 0;
  let storeCounts = {};

  historyData.forEach(o => {
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
      totalRevenue += Math.max(0, fee - 0.5); // Σε περίπτωση κάποιας άλλης χρέωσης, απλά αφαιρούμε τα 50 λεπτά της εταιρείας
    }
    const sName = o.stores?.name || 'Άγνωστο Κατάστημα';
    storeCounts[sName] = (storeCounts[sName] || 0) + 1;
  });
  const avgTime = countWithTime > 0 ? (totalDeliveryMins / countWithTime).toFixed(1) : 0;
  const formattedRevenue = totalRevenue.toFixed(2);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomWidth: 0, elevation: 5, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.1, shadowRadius: 5, backgroundColor: isDarkMode ? '#1A1A1A' : '#FFFFFF', zIndex: 10 }]}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Text style={{ fontSize: 10, color: '#C5A066', fontWeight: 'bold', letterSpacing: 1 }}>VERTEX DRIVER</Text>
          <Text style={[styles.driverName, { color: isDarkMode ? '#EAD7B1' : '#121212', fontSize: 18 }]} numberOfLines={1}>{currentUser.full_name}</Text>
          <Text style={{ fontSize: 10, color: isDarkMode ? '#888' : '#777', marginTop: 2 }}><Feather name="map-pin" size={10} /> Στίγμα: {lastLocationUpdate}</Text>
        </View>
        
        <View style={{ flex: 1, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setIsDarkMode(!isDarkMode)}>
            <View style={{ backgroundColor: isDarkMode ? '#333' : '#F0F0F0', padding: 8, borderRadius: 20 }}>
              <Feather name={isDarkMode ? 'sun' : 'moon'} size={20} color={isDarkMode ? '#EAD7B1' : '#121212'} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <TouchableOpacity onPress={() => setMenuVisible(true)}>
            <View style={{ backgroundColor: isDarkMode ? '#333' : '#F0F0F0', padding: 8, paddingHorizontal: 12, borderRadius: 20 }}>
              <Feather name="menu" size={22} color={isDarkMode ? '#FFF' : '#000'} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* READ-ONLY-ON-FAILOVER: μπάρα όταν τρέχουμε στο εφεδρικό (standby) */}
      {readOnly && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: isDarkMode ? 'rgba(251,191,36,0.12)' : '#FFFBEB', borderBottomWidth: 1, borderBottomColor: isDarkMode ? 'rgba(251,191,36,0.25)' : '#FDE68A' }}>
          <Feather name="alert-triangle" size={14} color={isDarkMode ? '#FBBF24' : '#B45309'} style={{ marginRight: 6 }} />
          <Text style={{ color: isDarkMode ? '#FBBF24' : '#B45309', fontSize: 12, fontWeight: '700', textAlign: 'center', flexShrink: 1 }}>
            Εφεδρική λειτουργία — προσωρινά μόνο ανάγνωση
          </Text>
        </View>
      )}

      <View style={[styles.tabContainer, { backgroundColor: isDarkMode ? '#121212' : '#F8F9FA', padding: 12, borderBottomWidth: 0 }]}>
        <View style={{ flexDirection: 'row', backgroundColor: isDarkMode ? '#1A1A1A' : '#E9ECEF', borderRadius: 16, padding: 4, flex: 1, borderWidth: 1, borderColor: isDarkMode ? '#333' : '#DEE2E6' }}>
          <TouchableOpacity style={[styles.tab, activeTab === 'pending' && (isDarkMode ? styles.tabActiveDarkDriver : styles.tabActiveLightDriver)]} onPress={() => setActiveTab('pending')}>
            <Text style={[styles.tabText, { fontSize: 13, fontWeight: '600' }, activeTab === 'pending' && styles.tabTextActiveDriver]}>ΕΝΕΡΓΕΣ ({pendingOrders.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'my_orders' && (isDarkMode ? styles.tabActiveDarkDriver : styles.tabActiveLightDriver)]} onPress={() => setActiveTab('my_orders')}>
            <Text style={[styles.tabText, { fontSize: 13, fontWeight: '600' }, activeTab === 'my_orders' && styles.tabTextActiveDriver]}>ΑΠΟΔΕΚΤΕΣ ({myOrders.length})</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList 
        data={activeTab === 'pending' ? pendingOrders : myOrders} 
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrderItem} 
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchOrders} />} 
      />

      {/* Hamburger Menu Modal */}
      <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuContent}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setIsHistoryVisible(true); }}>
              <Text style={styles.menuItemText}><Feather name="bar-chart-2" size={16} /> Ιστορικό / Στατιστικά</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleDriverLogout}>
              <Text style={[styles.menuItemText, { color: '#EF4444' }]}><Feather name="log-out" size={16} /> Έξοδος</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* History & Stats Modal */}
      <Modal visible={isHistoryVisible} animationType="slide" onRequestClose={() => setIsHistoryVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Ιστορικό</Text>
            <TouchableOpacity onPress={() => setIsHistoryVisible(false)}>
              <Feather name="x" size={26} color={isDarkMode ? '#FFF' : '#000'} />
            </TouchableOpacity>
          </View>

          <View style={styles.filterRow}>
            {[{l:'Σήμερα', v:0}, {l:'3', v:3}, {l:'5', v:5}, {l:'7', v:7}, {l:'Custom', v:-1}].map(f => (
              <TouchableOpacity 
                key={f.v} 
                style={[
                  styles.filterBtn, 
                  historyPeriod === f.v && styles.filterBtnActive,
                  f.l.length === 1 ? { minWidth: 40, alignItems: 'center', justifyContent: 'center' } : null
                ]} 
                onPress={() => setHistoryPeriod(f.v)}
              >
                <Text style={[styles.filterBtnText, historyPeriod === f.v && styles.filterBtnTextActive]}>{f.l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {historyPeriod === -1 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 10 }}>
              <TouchableOpacity style={[styles.inputSmall, {flex:1, marginBottom: 0}]} onPress={() => { setPickerTarget('start'); setPickerMode('date'); setShowPicker(true); }}>
                <Text style={{color: isDarkMode ? '#FFF' : '#000', fontSize: 13}}>Από: {startDate.getDate()}/{startDate.getMonth()+1} {startDate.getHours()}:{String(startDate.getMinutes()).padStart(2,'0')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.inputSmall, {flex:1, marginBottom: 0}]} onPress={() => { setPickerTarget('end'); setPickerMode('date'); setShowPicker(true); }}>
                <Text style={{color: isDarkMode ? '#FFF' : '#000', fontSize: 13}}>Έως: {endDate.getDate()}/{endDate.getMonth()+1} {endDate.getHours()}:{String(endDate.getMinutes()).padStart(2,'0')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {showPicker && (
            <DateTimePicker value={pickerTarget === 'start' ? startDate : endDate} mode={pickerMode} is24Hour={true} display="default" onChange={handleDateChange} />
          )}

          <View style={styles.statRow}>
            <View style={[styles.statBox, { backgroundColor: isDarkMode ? '#1e3a24' : '#E8F5E9', borderColor: '#10B981' }]}><Text style={[styles.statValue, { color: '#10B981', fontSize: 28 }]}>{formattedRevenue}€</Text><Text style={styles.statLabel}>Συνολικό Κέρδος</Text></View>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statBox}><Text style={styles.statValue}>{totalOrders}</Text><Text style={styles.statLabel}>Παραγγελίες</Text></View>
            <View style={styles.statBox}><Text style={styles.statValue}>{avgTime}'</Text><Text style={styles.statLabel}>Μ.Ο. Διανομής</Text></View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statBox}><Text style={[styles.statValue, {color:'#E53935'}]}>{foodCount}</Text><Text style={styles.statLabel}>Φαγητά (1.30€)</Text></View>
            <View style={styles.statBox}><Text style={[styles.statValue, {color:'#8E44AD'}]}>{coffeeCount}</Text><Text style={styles.statLabel}>Καφέδες (1.00€)</Text></View>
          </View>

          <Text style={[styles.modalTitle, {fontSize: 20, marginTop: 10, marginBottom: 10}]}>Ανά Κατάστημα</Text>
          <FlatList
            data={Object.entries(storeCounts).sort((a,b) => b[1] - a[1])}
            keyExtractor={item => item[0]}
            renderItem={({item}) => (
              <View style={styles.tableRow}>
                <Text style={styles.tableCell}>{item[0]}</Text>
                <Text style={styles.tableCellBold}>{item[1]}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={{color: isDarkMode ? '#AAA' : '#666', textAlign:'center', marginTop:20}}>Καμία παραγγελία σε αυτό το διάστημα.</Text>}
          />
        </View>
      </Modal>

      {/* Custom Alert Modal για επιβεβαίωση ενεργειών */}
      <Modal visible={confirmModalVisible} transparent={true} animationType="fade" onRequestClose={() => setConfirmModalVisible(false)}>
        <View style={styles.alertModalOverlay}>
          <View style={styles.alertModalContainer}>
            <Text style={styles.alertModalTitle}>{confirmConfig.title}</Text>
            <Text style={styles.alertModalMessage}>{confirmConfig.message}</Text>
            <View style={styles.alertModalButtonContainer}>
              <TouchableOpacity style={styles.alertModalButtonCancel} onPress={() => setConfirmModalVisible(false)}>
                <Text style={styles.alertModalButtonCancelText}>Όχι</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.alertModalButtonConfirm} onPress={confirmConfig.onConfirm}>
                <Text style={styles.alertModalButtonConfirmText}>Ναι</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── MODAL ΕΙΔΟΠΟΙΗΣΗΣ ΚΕΝΤΡΟΥ ΕΛΕΓΧΟΥ ─── */}
      <Modal visible={!!systemAlert} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: isDarkMode ? '#1C1C1C' : '#FFFFFF',
            borderRadius: 24,
            padding: 24,
            borderTopWidth: 4,
            borderTopColor: '#C5A066',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
            elevation: 10
          }}>
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: isDarkMode ? '#F0EBE2' : '#1E1A14', marginBottom: 16 }}>
              <Feather name="bell" size={20} color={isDarkMode ? '#F0EBE2' : '#1E1A14'} /> Νέο Μήνυμα από Κέντρο
            </Text>
            <View style={{ backgroundColor: isDarkMode ? '#2A2520' : '#F4F0EB', padding: 16, borderRadius: 12, marginBottom: 20 }}>
              <Text style={{ fontSize: 16, color: isDarkMode ? '#F0EBE2' : '#1E1A14', lineHeight: 24 }}>
                {systemAlert}
              </Text>
            </View>
            <TouchableOpacity
              style={{
                backgroundColor: '#C5A066',
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center'
              }}
              onPress={() => setSystemAlert(null)}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Το είδα (ΟΚ)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}