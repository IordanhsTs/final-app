import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, RefreshControl, Modal, Alert, Vibration, Linking } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useAudioPlayer } from 'expo-audio';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../../supabase';
import { getStyles } from '../styles/globalStyles';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

const notificationSound = require('../../assets/notification.mp3');

export default function StoreDashboard({ currentUser, setCurrentUser, isDarkMode, setIsDarkMode }) {
  const styles = getStyles(isDarkMode);
  
  // ΤΟ HOOK ΜΠΑΙΝΕΙ ΑΥΣΤΗΡΑ ΕΔΩ ΣΤΗΝ ΚΟΡΥΦΗ!
  const player = useAudioPlayer(notificationSound);

  const [activeOrders, setActiveOrders] = useState([]);
  
  const autocompleteRef = useRef(null); 
  const [streetNumber, setStreetNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash'); 
  const [comments, setComments] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  // States για Ιστορικό & Μενού
  const [menuVisible, setMenuVisible] = useState(false);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState(0); 
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('date');
  const [pickerTarget, setPickerTarget] = useState('start');
  const [historyData, setHistoryData] = useState([]);

  // Η συνάρτηση πλέον απλά πατάει το "Play"
  async function triggerAcceptNotification() {
    Vibration.vibrate([0, 500, 200, 500]);
    try {
      if (player) {
        player.play();
      }
    } catch (e) { 
      console.log("Audio Error στο Κατάστημα:", e); 
    }
  }

  useEffect(() => {
    fetchStoreOrders();
    
    const channel = supabase
      .channel('store_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${currentUser.id}` }, 
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new && payload.new.status === 'accepted') {
            // Μικρή προστασία: Αν χτυπάει πολλές φορές, ίσως η Supabase στέλνει διπλά updates.
            triggerAcceptNotification();
          }
          fetchStoreOrders();
        }
      ).subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [player]); // Προσθέτουμε το player στα dependencies

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
      .select('*, drivers(full_name)')
      .eq('status', 'completed').eq('store_id', currentUser.id)
      .gte('completed_at', start.toISOString())
      .lte('completed_at', end.toISOString());
    setHistoryData(data || []);
  }

  async function fetchStoreOrders() {
    setRefreshing(true);
    
    const { data: active } = await supabase
      .from('orders')
      .select(`*, drivers ( id, full_name, phone, latitude, longitude )`)
      .eq('store_id', currentUser.id)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    if (active) {
      const activeDriverIds = [...new Set(active.filter(o => o.status === 'accepted').map(o => o.driver_id))];
      let workloads = {};
      
      if (activeDriverIds.length > 0) {
        const { data: driverOrders } = await supabase
          .from('orders').select('driver_id').in('driver_id', activeDriverIds).eq('status', 'accepted');
          
        driverOrders?.forEach(order => { workloads[order.driver_id] = (workloads[order.driver_id] || 0) + 1; });
      }

      const enrichedOrders = active.map(order => ({ ...order, driver_workload: workloads[order.driver_id] || 0 }));
      setActiveOrders(enrichedOrders);
    }
    
    setRefreshing(false);
  }

  async function sendPushNotificationToDrivers(message) {
    const { data: drivers } = await supabase
      .from('drivers')
      .select('expo_push_token')
      .not('expo_push_token', 'is', null);

    if (drivers) {
      for (const driver of drivers) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: driver.expo_push_token,
            title: 'Νέα Παραγγελία!',
            body: message,
            sound: 'default',
            priority: 'high',
            android: {
              priority: 'high',
              sound: 'default',
              channelId: 'default' 
            }
          }),
        });
      }
    }
  }

  async function createOrder() {
    const typedStreet = autocompleteRef.current?.getAddressText() || '';
    let fullAddress = typedStreet || streetNumber ? `${typedStreet.trim()} ${streetNumber.trim()}`.trim() : 'Χωρίς Διεύθυνση';

    const { error } = await supabase.from('orders').insert([{
      store_id: currentUser.id, 
      address: fullAddress,
      payment_method: paymentMethod, 
      comments: comments.trim() || null, 
      status: 'pending'
    }]);
    
    if (error) {
      Alert.alert('Σφάλμα', error.message);
    } else { 
      await sendPushNotificationToDrivers('Υπάρχει νέα παραγγελία διαθέσιμη!');
      
      autocompleteRef.current?.setAddressText(''); 
      setStreetNumber(''); 
      setComments(''); 
      setPaymentMethod('cash'); 
      fetchStoreOrders(); 
    }
  }

  async function cancelOrder(orderId) {
    Alert.alert("Ακύρωση", "Είστε σίγουροι;", [
      { text: "Όχι", style: "cancel" },
      { text: "Ναι", style: "destructive", onPress: async () => {
          const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
          if (!error) fetchStoreOrders();
        } 
      }
    ]);
  }

  const handleCall = (phone, name) => {
    if (!phone) {
      Alert.alert("Σφάλμα", "Δεν υπάρχει διαθέσιμο τηλέφωνο.");
      return;
    }
    Alert.alert(
      "Κλήση",
      `Θέλετε να καλέσετε τον διανομέα:\n${name};\n(${phone})`,
      [
        { text: "Όχι", style: "cancel" },
        { text: "Ναι", onPress: () => Linking.openURL(`tel:${phone}`) }
      ]
    );
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

  const renderOrder = ({ item }) => {
    const isCompleted = item.status === 'completed';
    const createdTime = new Date(item.created_at);
    
    const pendingMins = Math.floor((new Date() - createdTime) / 60000);
    const acceptedMins = item.accepted_at ? Math.floor((new Date() - new Date(item.accepted_at)) / 60000) : 0;

    const tCreate = new Date(item.created_at);
    const tAccept = item.accepted_at ? new Date(item.accepted_at) : null;
    const tComplete = item.completed_at ? new Date(item.completed_at) : null;

    const totalMins = tComplete ? Math.floor((tComplete - tCreate) / 60000) : 0;
    const compPendingMins = tAccept ? Math.floor((tAccept - tCreate) / 60000) : totalMins;
    const compAcceptedMins = tComplete && tAccept ? Math.floor((tComplete - tAccept) / 60000) : 0;

    // Χρώματα χρόνου (Πράσινο μέχρι 9 λεπτά, Κόκκινο από 10 και πάνω)
    const isWarning = !isCompleted && pendingMins > 9;
    const timeColor = isWarning ? '#EF4444' : '#10B981';
    const timeBgColor = isWarning 
      ? (isDarkMode ? '#3a1e1e' : '#FFEBEE') 
      : (isDarkMode ? '#1e3a24' : '#E8F5E9');

    return (
      <View style={styles.orderCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text style={[styles.orderAddress, { flex: 1, marginRight: 8 }]}>{item.address}</Text>
          <View style={{ backgroundColor: timeBgColor, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, height: 30, justifyContent: 'center' }}>
            <Text style={{color: timeColor, fontWeight:'900', fontSize: 14}}>
              {isCompleted ? `⏱️ ${totalMins} λ.` : `${pendingMins} λ.`}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={{ backgroundColor: item.payment_method === 'cash' ? '#10B981' : '#208AEF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{fontWeight: '900', color: '#FFF', fontSize: 13, textAlign: 'center'}}>
              {item.payment_method === 'cash' ? '💵 ΜΕΤΡΗΤΑ' : '💳 ΚΑΡΤΑ'}
            </Text>
          </View>
        </View>
        {item.comments ? <Text style={styles.commentText}>💬 {item.comments}</Text> : null}

        {isCompleted ? (
          <View style={[styles.acceptedContainer, { backgroundColor: isDarkMode ? '#064E3B' : '#ECFDF5', borderColor: '#10B981' }]}>
            <Text style={{ color: '#10B981', fontWeight: '900', fontSize: 16 }}>
              ✔️ Παραδόθηκε σε {totalMins} λεπτά
            </Text>
            <Text style={{ color: isDarkMode ? '#A7F3D0' : '#047857', fontSize: 13, marginTop: 4, fontWeight: '600' }}>
              όπου τα {compPendingMins} ήταν pending και τα {compAcceptedMins} accepted
            </Text>
            <Text style={{ color: isDarkMode ? '#D1D5DB' : '#4B5563', marginTop: 10, fontSize: 14, fontWeight: '700' }}>
              🛵 Διανομέας: {item.drivers?.full_name || 'Άγνωστος'}
            </Text>
          </View>
        ) : (
          <>
            {item.status === 'pending' ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <Text style={styles.statusPending}>🔍 Αναζήτηση Διανομέα...</Text>
                <TouchableOpacity style={{ backgroundColor: '#E53935', padding: 8, borderRadius: 5 }} onPress={() => cancelOrder(item.id)}>
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Ακύρωση</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.acceptedContainer, { backgroundColor: isDarkMode ? '#1E3A8A' : '#EFF6FF', borderColor: '#3B82F6' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={[styles.statusAccepted, { color: isDarkMode ? '#93C5FD' : '#2563EB' }]}>🛵 Το πήρε ο: {item.drivers?.full_name} (πριν {acceptedMins} λ.)</Text>
                  {item.drivers?.phone ? (
                    <TouchableOpacity onPress={() => handleCall(item.drivers?.phone, item.drivers?.full_name)} style={{ marginLeft: 8, padding: 4 }}>
                      <Text style={{ fontSize: 18 }}>📞</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.workloadText}>Φόρτος: {item.driver_workload}</Text>
                {item.drivers?.latitude && (
                  <TouchableOpacity style={styles.mapBtn} onPress={() => { setSelectedDriver(item.drivers); setMapModalVisible(true); }}>
                    <Text style={styles.buttonTextWhite}>🗺️ Δες τον στον Χάρτη</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  // Υπολογισμοί Στατιστικών
  let totalOrders = historyData.length;
  let totalDeliveryMins = 0; let countWithTime = 0;
  let driverCounts = {};

  historyData.forEach(o => {
    if (o.accepted_at && o.completed_at) {
      totalDeliveryMins += (new Date(o.completed_at) - new Date(o.accepted_at)) / 60000;
      countWithTime++;
    }
    const dName = o.drivers?.full_name || 'Άγνωστος Διανομέας';
    driverCounts[dName] = (driverCounts[dName] || 0) + 1;
  });
  const avgTime = countWithTime > 0 ? (totalDeliveryMins / countWithTime).toFixed(1) : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomWidth: 4, borderBottomColor: '#8E44AD' }]}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Text style={styles.storeName} numberOfLines={1}>🏢 {currentUser.name}</Text>
        </View>
        
        <View style={{ flex: 1, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setIsDarkMode(!isDarkMode)}>
            <Text style={{ fontSize: 24 }}>{isDarkMode ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <TouchableOpacity onPress={() => setMenuVisible(true)}>
            <Text style={{ fontSize: 32, color: isDarkMode ? '#FFF' : '#000', fontWeight: 'bold' }}>☰</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.formCard}>
          <View style={{ zIndex: 999, flex: 0, width: '100%' }}>
            <GooglePlacesAutocomplete
              ref={autocompleteRef}
              placeholder="Αναζήτηση Οδού (π.χ. Τυρνάβου)..."
              onFail={(error) => Alert.alert('Σφάλμα Google', JSON.stringify(error))}
            query={{ key: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY, language: 'el', components: 'country:gr' }}
              styles={{ container: { flex: 0, marginBottom: 10, zIndex: 999 }, textInput: styles.inputSmall, listView: { position: 'absolute', top: 50, left: 0, right: 0, backgroundColor: isDarkMode ? '#333' : 'white', borderRadius: 5, elevation: 10, zIndex: 1000 } }}
              enablePoweredByContainer={false}
              textInputProps={{
                placeholderTextColor: '#888888',
              }}
            />
          </View>
          
          <TextInput style={styles.inputSmall} placeholder="Αριθμός (π.χ. 12)" placeholderTextColor="#888888" keyboardType="numeric" value={streetNumber} onChangeText={setStreetNumber} />
          
          <View style={styles.paymentToggleContainer}>
             <TouchableOpacity style={[styles.payBtn, isDarkMode && { backgroundColor: '#2C2C2C', borderColor: '#333' }, paymentMethod === 'cash' && styles.payBtnActiveCash]} onPress={() => setPaymentMethod('cash')}><Text style={[styles.payBtnText, paymentMethod === 'cash' && styles.buttonTextWhite]}>💵 Μετρητά</Text></TouchableOpacity>
             <TouchableOpacity style={[styles.payBtn, isDarkMode && { backgroundColor: '#2C2C2C', borderColor: '#333' }, paymentMethod === 'card' && styles.payBtnActiveCard]} onPress={() => setPaymentMethod('card')}><Text style={[styles.payBtnText, paymentMethod === 'card' && styles.buttonTextWhite]}>💳 Κάρτα</Text></TouchableOpacity>
          </View>
          
          <TextInput style={[styles.inputSmall, { height: 60, textAlignVertical: 'top' }]} placeholder="Σχόλια..." placeholderTextColor="#888888" multiline value={comments} onChangeText={setComments} />
          
          <TouchableOpacity style={styles.submitBtn} onPress={createOrder}>
            <Text style={styles.buttonTextWhite}>Αποστολή Παραγγελίας</Text>
          </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: isDarkMode ? '#1E1E1E' : '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: isDarkMode ? '#333' : '#E2E8F0', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: isDarkMode ? '#FFF' : '#333', textAlign: 'center' }}>Ενεργές Παραγγελίες ({activeOrders.length})</Text>
      </View>

      <FlatList 
        data={activeOrders} 
        renderItem={renderOrder} 
        keyExtractor={(item) => item.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchStoreOrders} />} 
        keyboardShouldPersistTaps="handled" 
      />

      <Modal visible={mapModalVisible} animationType="slide">
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={styles.closeModalBtn} onPress={() => setMapModalVisible(false)}><Text style={styles.buttonTextWhite}>Κλείσιμο Χάρτη</Text></TouchableOpacity>
          {selectedDriver && (
            <MapView style={{ flex: 1 }} initialRegion={{ latitude: selectedDriver.latitude, longitude: selectedDriver.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }}>
              <Marker coordinate={{ latitude: selectedDriver.latitude, longitude: selectedDriver.longitude }} title={selectedDriver.full_name} />
            </MapView>
          )}
        </View>
      </Modal>

      {/* Hamburger Menu Modal */}
      <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuContent}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setIsHistoryVisible(true); }}>
              <Text style={styles.menuItemText}>📜 Ιστορικό / Στατιστικά</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={async () => {
              await supabase.auth.signOut();
              setCurrentUser(null);
            }}>
              <Text style={[styles.menuItemText, { color: '#EF4444' }]}>🚪 Έξοδος</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* History & Stats Modal */}
      <Modal visible={isHistoryVisible} animationType="slide" onRequestClose={() => setIsHistoryVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Ιστορικό Καταστήματος</Text>
            <TouchableOpacity onPress={() => setIsHistoryVisible(false)}>
              <Text style={{ fontSize: 26, color: isDarkMode ? '#FFF' : '#000' }}>✖</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.filterRow}>
            {[{l:'Σήμερα', v:0}, {l:'3', v:3}, {l:'5', v:5}, {l:'7', v:7}, {l:'Custom', v:-1}].map(f => (
              <TouchableOpacity key={f.v} style={[styles.filterBtn, historyPeriod === f.v && styles.filterBtnActive, f.l.length === 1 ? { minWidth: 40, alignItems: 'center', justifyContent: 'center' } : null]} onPress={() => setHistoryPeriod(f.v)}>
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
            <View style={styles.statBox}><Text style={styles.statValue}>{totalOrders}</Text><Text style={styles.statLabel}>Παραγγελίες</Text></View>
            <View style={styles.statBox}><Text style={styles.statValue}>{avgTime}'</Text><Text style={styles.statLabel}>Μ.Ο. Χρόνου Διανομής</Text></View>
          </View>

          <Text style={[styles.modalTitle, {fontSize: 20, marginTop: 10, marginBottom: 10}]}>Ανά Διανομέα</Text>
          <FlatList
            data={Object.entries(driverCounts).sort((a,b) => b[1] - a[1])}
            keyExtractor={item => item[0]}
            renderItem={({item}) => (
              <View style={styles.tableRow}>
                <Text style={styles.tableCell}>🛵 {item[0]}</Text>
                <Text style={styles.tableCellBold}>{item[1]}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={{color: isDarkMode ? '#AAA' : '#666', textAlign:'center', marginTop:20}}>Καμία παραγγελία σε αυτό το διάστημα.</Text>}
          />
        </View>
      </Modal>

    </View>
  );
}