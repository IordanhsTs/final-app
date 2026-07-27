import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, FlatList, ScrollView, RefreshControl, Vibration, Linking, Platform, AppState, Modal } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { formatKm, formatCountdown, orderDurations, minutesSinceCreated } from '../utils/orderInfo';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, clearDriverPresenceEverywhere, getTenantSchema, isReadOnly, onBackendChange } from '../../supabase';
import { getStyles } from '../styles/globalStyles';
import { Feather, Ionicons } from '@expo/vector-icons';

const notificationSound = require('../../assets/notification.mp3');
const alarmSound = require('../../assets/alarm.wav');
const messageSound = require('../../assets/message.wav');



export default function DriverDashboard({ currentUser, setCurrentUser, isDarkMode, setIsDarkMode }) {
  const styles = getStyles(isDarkMode);

  // ΤΑ HOOKS ΜΠΑΙΝΟΥΝ ΑΥΣΤΗΡΑ ΕΔΩ ΣΤΗΝ ΚΟΡΥΦΗ!
  // Τρεις ξεχωριστοί players — ένας ανά είδος ειδοποίησης (νέα παραγγελία / ανάθεση
  // /μετάθεση / μήνυμα κέντρου) — ο πελάτης θέλει να τους ξεχωρίζει με το αυτί.
  const player = useAudioPlayer(notificationSound);
  const alarmPlayer = useAudioPlayer(alarmSound);
  const messagePlayer = useAudioPlayer(messageSound);

  const [pendingOrders, setPendingOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  // Προγραμματισμένες: το κατάστημα τις έστειλε με καθυστέρηση. Ο διανομέας τις
  // ΒΛΕΠΕΙ με αντίστροφη μέτρηση αλλά δεν μπορεί να τις πάρει πριν λάχει η ώρα.
  const [scheduledOrders, setScheduledOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [refreshing, setRefreshing] = useState(false);
  // Ρολόι για τις αντίστροφες μετρήσεις (χτυπά ανά δευτερόλεπτο μόνο όταν χρειάζεται).
  const [now, setNow] = useState(new Date());

  // ── Συναγερμός ανάθεσης από τον διαχειριστή ──
  const [assignmentAlert, setAssignmentAlert] = useState(null);
  // Παραγγελίες που κρατούσε ήδη ο διανομέας στο προηγούμενο fetch — για να
  // ξεχωρίσουμε τη ΝΕΑ ανάθεση από τα υπόλοιπα updates.
  const knownMyOrderIds = useRef(null);
  // Παραγγελίες που πάτησε ΜΟΝΟΣ του «Αποδοχή»: δεν πρέπει να χτυπήσει συναγερμός.
  const selfAcceptedIds = useRef(new Set());
  const alarmTimers = useRef([]);
  // Ποιες ήταν προγραμματισμένες στο τελευταίο fetch. Χρειάζεται ως ref (και όχι
  // state) γιατί το διαβάζει ο realtime handler, που ζει σε effect με άδειο
  // dependency array — ένα state θα ήταν παγωμένο στην αρχική τιμή του.
  const scheduledIds = useRef(new Set());
  
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
  // 'summary' = στατιστικά + ανά κατάστημα (όπως πριν) · 'detailed' = μία γραμμή ανά παραγγελία.
  const [historyView, setHistoryView] = useState('summary');
  // Φίλτρο καταστημάτων: άδειο = ΟΛΑ. Το φιλτράρισμα γίνεται τοπικά ώστε οι
  // επιλογές να μη χάνονται και να μη χτυπάμε τη βάση σε κάθε πάτημα.
  const [storeFilter, setStoreFilter] = useState([]);
  
  // States για Custom Modal Επιβεβαίωσης (και για απλά ενημερωτικά μηνύματα — βλ. showAlert
  // παρακάτω· έτσι όλα τα μηνύματα προς τον χρήστη μοιράζονται το ίδιο styled modal αντί να
  // εναλλάσσονται με το native Alert.alert).
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', onConfirm: null, alertOnly: false, confirmLabel: 'Ναι' });

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

    // Απελευθέρωση των προγραμματισμένων που έφτασε η ώρα τους ('scheduled' →
    // 'pending'). Ατομικό UPDATE στη βάση — ακίνδυνο να το καλούν πολλοί μαζί.
    const releaseDue = async () => {
      try { await supabase.rpc('release_due_orders'); } catch (_) {}
    };
    releaseDue();
    const releaseTimer = setInterval(releaseDue, 15000);

    const channel = supabase
      .channel(`driver_orders_${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: getTenantSchema(), table: 'orders' }, (payload) => {
        // Προγραμματισμένη παραγγελία που μόλις «ωρίμασε»: ο πελάτης θέλει να ηχεί
        // σαν κανονική νέα παραγγελία ώστε να καταλάβει ο διανομέας ότι ήρθε.
        // Δεν κοιτάμε το payload.old — το realtime στέλνει εκεί μόνο το κλειδί.
        if (
          payload.eventType === 'UPDATE' &&
          payload.new?.status === 'pending' &&
          scheduledIds.current.has(payload.new.id)
        ) {
          scheduledIds.current.delete(payload.new.id);
          triggerNotification();
        }
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
          // ΣΥΝΕΧΟΜΕΝΟΣ ήχος μέχρι το «Το είδα (ΟΚ)» (αίτημα πελάτη): το μήνυμα
          // του κέντρου δεν πρέπει να περνά απαρατήρητο πάνω στη μηχανή. Δικός
          // του ήχος (messagePlayer), ξεχωριστός από παραγγελία/ανάθεση.
          startAlarm(0, messagePlayer);
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
      clearInterval(releaseTimer);
      if (notificationListener) notificationListener.remove();
      if (responseListener) responseListener.remove();
      supabase.removeChannel(channel);
      supabase.removeChannel(systemAlertChannel);
      supabase.removeChannel(driverChannel);
      appStateSubscription.remove();
    };
  }, []); // Αφαιρέσαμε το player από εδώ για να μην κλείνει η σύνδεση!

  // Ρολόι για τις αντίστροφες μετρήσεις: ανά δευτερόλεπτο ΜΟΝΟ όσο υπάρχει
  // προγραμματισμένη παραγγελία, αλλιώς ανά λεπτό (χρόνοι αναμονής).
  useEffect(() => {
    const everySecond = scheduledOrders.length > 0;
    const t = setInterval(() => setNow(new Date()), everySecond ? 1000 : 60000);
    return () => clearInterval(t);
  }, [scheduledOrders.length]);

  // ── Ηχητικοί συναγερμοί ────────────────────────────────────────────────────
  // Χρησιμοποιούμε το `loop` του expo-audio αντί για setInterval με seekTo: ο ήχος
  // επαναλαμβάνεται χωρίς κενά και σταματά ακαριαία, χωρίς να κυνηγάμε timers.
  //
  // Δύο σενάρια, όπως τα ζήτησε ο πελάτης:
  //   • ΑΝΑΘΕΣΗ από διαχειριστή → δυνατά και επαναλαμβανόμενα για 15", σταματά
  //     είτε με «Το είδα (ΟΚ)» είτε μόλις περάσουν τα 15".
  //   • ΜΗΝΥΜΑ από διαχειριστή → συνεχόμενα, μέχρι να πατηθεί το ΟΚ.
  const ASSIGNMENT_ALARM_MS = 15000;

  function clearAlarmTimers() {
    alarmTimers.current.forEach(clearTimeout);
    alarmTimers.current = [];
  }

  function stopAlarm() {
    clearAlarmTimers();
    Vibration.cancel();
    // Σταματάμε ΚΑΙ τους τρεις players (ό,τι κι αν έπαιζε) — δεν θέλουμε κάποιος
    // να μείνει να κάνει loop αν χτυπήσουν σχεδόν ταυτόχρονα δύο διαφορετικά events.
    [player, alarmPlayer, messagePlayer].forEach((p) => {
      try {
        if (p) { p.loop = false; p.pause(); }
      } catch (e) { console.log('Audio Error:', e); }
    });
  }

  // `autoStopMs = 0` σημαίνει «μέχρι να το σταματήσει ο χρήστης». `targetPlayer`
  // επιλέγει ΠΟΙΟΝ ήχο θα παίξει (η ανάθεση έχει δικό της, ξεχωριστό από το μήνυμα
  // κέντρου / νέα παραγγελία).
  function startAlarm(autoStopMs, targetPlayer = player) {
    clearAlarmTimers();
    Vibration.vibrate([0, 600, 400], true); // επαναλαμβανόμενη δόνηση
    try {
      if (targetPlayer) {
        targetPlayer.loop = true;
        targetPlayer.volume = 1.0;
        targetPlayer.seekTo(0);
        targetPlayer.play();
      }
    } catch (e) { console.log('Audio Error:', e); }

    if (autoStopMs > 0) {
      alarmTimers.current.push(setTimeout(stopAlarm, autoStopMs));
    }
  }

  // Απλή, μία φορά ειδοποίηση (χωρίς επανάληψη).
  function triggerNotification() {
    Vibration.vibrate([0, 500, 200, 500]);
    try {
      if (player) {
        player.loop = false;
        player.seekTo(0);
        player.play();
      }
    } catch (e) {
      console.log("Audio Error:", e);
    }
  }

  // Σταματάμε κάθε ήχο/δόνηση όταν φεύγει η οθόνη, ώστε να μη μείνει να χτυπά.
  useEffect(() => stopAlarm, []);

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
    const rows = data || [];
    setHistoryData(rows);
    // Αλλάζοντας διάστημα, καταστήματα που δεν υπάρχουν πια στα δεδομένα θα
    // έμεναν επιλεγμένα και θα έδειχναν κενή λίστα χωρίς προφανή λόγο.
    const availableIds = new Set(rows.map(o => o.store_id));
    setStoreFilter(prev => prev.filter(id => availableIds.has(id)));
  }

  async function fetchOrders() {
    setRefreshing(true);
    try {
      // Η διεύθυνση του καταστήματος μπαίνει στην κάρτα (μικρά γράμματα, κάτω):
      // ο διανομέας θέλει να ξέρει ΑΠΟ ΠΟΥ παραλαμβάνει, όχι μόνο το όνομα.
      const { data: storesList } = await supabase.from('stores').select('id, name, phone, address');
      const storesMap = {};
      if (storesList) storesList.forEach(s => { storesMap[s.id] = { name: s.name, phone: s.phone, address: s.address }; });

      // ΠΑΛΙΟΤΕΡΕΣ ΠΡΩΤΑ (ascending): η παραγγελία που περιμένει περισσότερο πρέπει
      // να είναι στην κορυφή — αλλιώς μια αργοπορημένη «θάβεται» από τις νέες.
      const { data: pending } = await supabase.from('orders').select('*').eq('status', 'pending').order('created_at', { ascending: true });
      const { data: mine } = await supabase.from('orders').select('*').eq('status', 'accepted').eq('driver_id', currentUser.id).order('created_at', { ascending: true });
      // Προγραμματισμένες: όσο πιο κοντά στην ώρα αποστολής, τόσο πιο πάνω.
      const { data: scheduled } = await supabase.from('orders').select('*').eq('status', 'scheduled').order('scheduled_at', { ascending: true });

      const withStore = (orders) => (orders || []).map(order => ({
        ...order,
        store_name: storesMap[order.store_id]?.name || 'Κεντρικό Κατάστημα',
        store_phone: storesMap[order.store_id]?.phone || null,
        store_address: storesMap[order.store_id]?.address || null,
      }));

      const mineMapped = withStore(mine);

      // ── Ανίχνευση ΝΕΑΣ ανάθεσης από τον διαχειριστή ──
      // Νέα παραγγελία στη λίστα μου που ΔΕΝ την πάτησα εγώ = μου την ανέθεσε ή
      // μου τη μετέθεσε ο διαχειριστής → δυνατός επαναλαμβανόμενος συναγερμός.
      if (knownMyOrderIds.current !== null) {
        const fresh = mineMapped.filter(
          o => !knownMyOrderIds.current.has(o.id) && !selfAcceptedIds.current.has(o.id)
        );
        if (fresh.length > 0) {
          setAssignmentAlert(fresh[0]);
          startAlarm(ASSIGNMENT_ALARM_MS, alarmPlayer);
        }
      }
      knownMyOrderIds.current = new Set(mineMapped.map(o => o.id));

      const scheduledMapped = withStore(scheduled);
      scheduledIds.current = new Set(scheduledMapped.map(o => o.id));

      setPendingOrders(withStore(pending));
      setMyOrders(mineMapped);
      setScheduledOrders(scheduledMapped);
    } catch (e) {
      console.log("Fetch Error:", e);
    } finally {
      setRefreshing(false);
    }
  }

  // Ενημερωτικό μήνυμα (μόνο ΟΚ) μέσα από το ίδιο styled modal που χρησιμοποιούν οι
  // επιβεβαιώσεις — αντί για το ασύμβατο-με-το-theme native Alert.alert.
  function showAlert(title, message) {
    setConfirmConfig({
      title,
      message,
      alertOnly: true,
      confirmLabel: 'ΟΚ',
      onConfirm: () => setConfirmModalVisible(false),
    });
    setConfirmModalVisible(true);
  }

  async function acceptOrder(orderId) {
    if (isReadOnly()) {
      showAlert('Εφεδρική λειτουργία', 'Το σύστημα τρέχει προσωρινά σε εφεδρική λειτουργία (μόνο ανάγνωση). Δοκιμάστε ξανά μόλις αποκατασταθεί το κύριο σύστημα.');
      return;
    }
    setConfirmConfig({
      title: "Αποδοχή Παραγγελίας",
      message: "Είστε σίγουρος πως θέλετε να κάνετε αποδοχή;",
      onConfirm: async () => {
        setConfirmModalVisible(false);
        // Σημειώνουμε ότι την πήραμε ΕΜΕΙΣ, ώστε να μη χτυπήσει ο συναγερμός
        // ανάθεσης όταν εμφανιστεί στη λίστα μας.
        selfAcceptedIds.current.add(orderId);

        const { data } = await supabase
          .from('orders')
          .update({ status: 'accepted', driver_id: currentUser.id, accepted_at: new Date().toISOString() })
          .eq('id', orderId)
          .eq('status', 'pending')
          .select();

        if (data && data.length > 0) {
          fetchOrders();
        } else {
          selfAcceptedIds.current.delete(orderId);
          showAlert('Αποτυχία', 'Η παραγγελία έγινε ήδη αποδεκτή.');
          fetchOrders();
        }
      }
    });
    setConfirmModalVisible(true);
  }

  // ΠΑΡΑΛΑΒΗ: το ενδιάμεσο στάδιο. Ο διανομέας φτάνει στο κατάστημα, φορτώνει και
  // το δηλώνει — μετά το ίδιο κουμπί γίνεται «ΠΑΡΑΔΟΣΗ».
  async function pickUpOrder(orderId) {
    if (isReadOnly()) {
      showAlert('Εφεδρική λειτουργία', 'Το σύστημα τρέχει προσωρινά σε εφεδρική λειτουργία (μόνο ανάγνωση). Δοκιμάστε ξανά μόλις αποκατασταθεί το κύριο σύστημα.');
      return;
    }
    setConfirmConfig({
      title: "Παραλαβή Παραγγελίας",
      message: "Επιβεβαιώνετε ότι παραλάβατε την παραγγελία από το κατάστημα;",
      confirmLabel: 'Παραλαβή',
      onConfirm: async () => {
        setConfirmModalVisible(false);
        await supabase.from('orders').update({ picked_up_at: new Date().toISOString() }).eq('id', orderId);
        fetchOrders();
      }
    });
    setConfirmModalVisible(true);
  }

  async function completeOrder(orderId) {
    if (isReadOnly()) {
      showAlert('Εφεδρική λειτουργία', 'Το σύστημα τρέχει προσωρινά σε εφεδρική λειτουργία (μόνο ανάγνωση). Δοκιμάστε ξανά μόλις αποκατασταθεί το κύριο σύστημα.');
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
      showAlert("Σφάλμα", "Δεν υπάρχει διαθέσιμο τηλέφωνο.");
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

  // Άνοιγμα πλοήγησης προς οποιαδήποτε διεύθυνση (κατάστημα ή πελάτη).
  const openNavigation = (destination, toStore) => {
    setConfirmConfig({
      title: 'Πλοήγηση',
      message: `Έναρξη πλοήγησης προς ${toStore ? 'το κατάστημα' : 'τον πελάτη'}:\n${destination}`,
      confirmLabel: 'Πλοήγηση',
      onConfirm: () => {
        setConfirmModalVisible(false);
        const full = `${destination}, ${city}, Ελλάδα`;
        Linking.openURL(Platform.select({
          ios: `maps:0,0?q=${full}`,
          android: `google.navigation:q=${full}`,
        }));
      },
    });
    setConfirmModalVisible(true);
  };

  const renderOrderItem = ({ item }) => {
    const isCompleted = item.status === 'completed';
    const isScheduled = item.status === 'scheduled';
    const mins = minutesSinceCreated(item, now);

    // Η αρίθμηση ξεκινά από το 1 ΑΝΑ ΟΜΑΔΑ (προγραμματισμένες / ενεργές /
    // αποδεκτές) και όχι συνεχόμενα — η λίστα «Ενεργές» δείχνει δύο ομάδες μαζί.
    const group = isScheduled
      ? scheduledOrders
      : item.status === 'pending' ? pendingOrders : myOrders;
    const displayNumber = group.findIndex(o => o.id === item.id) + 1;

    // ΤΟ «-1» ΔΙΟΡΘΩΘΗΚΕ ΕΔΩ: οι χρόνοι περνούν από το orderDurations, που δεν
    // επιστρέφει ποτέ αρνητικά (απόκλιση ρολογιού κινητού/server).
    const { activeMins, acceptedMins, totalMins } = orderDurations(item, now);

    // Πριν την παραλαβή πλοηγούμαστε στο ΚΑΤΑΣΤΗΜΑ, μετά στον ΠΕΛΑΤΗ.
    const pickedUp = !!item.picked_up_at;
    const navTarget = !pickedUp && item.store_address ? item.store_address : item.address;

    // Χρώματα χρόνου: Πράσινο μέχρι 9 λεπτά, Κόκκινο από 10 και πάνω. Ολοκληρωμένες πάντα πράσινες.
    const isWarning = !isCompleted && !isScheduled && mins > 9;
    const timeColor = isWarning ? '#EF4444' : '#10B981';
    const timeBgColor = isWarning
      ? (isDarkMode ? '#3a1e1e' : '#FFEBEE')
      : (isDarkMode ? '#1e3a24' : '#E8F5E9');

    const remainingMs = item.scheduled_at ? new Date(item.scheduled_at) - now : 0;
    const km = formatKm(item.distance_km);

    return (
      <View style={[styles.orderCard, isScheduled && { opacity: 0.9, borderStyle: 'dashed', borderWidth: 1, borderColor: isDarkMode ? '#444' : '#D1D5DB' }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#333' : '#E5E7EB', paddingBottom: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            {/* Αύξων αριθμός θέσης μέσα στη λίστα */}
            <View style={{ minWidth: 22, height: 22, borderRadius: 6, backgroundColor: isDarkMode ? '#2A2A2A' : '#EEF0F3', alignItems: 'center', justifyContent: 'center', marginRight: 8, paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: isDarkMode ? '#9CA3AF' : '#6B7280' }}>{displayNumber}</Text>
            </View>
            <Text style={{ fontWeight: '900', fontSize: 17, color: isDarkMode ? '#C5A066' : '#8A7347', flexShrink: 1, letterSpacing: 0.5 }} numberOfLines={1}>
              <Ionicons name="storefront-outline" size={16} color={isDarkMode ? '#C5A066' : '#8A7347'} /> {item.store_name}
            </Text>

            {/* Το τηλέφωνο ανήκει στο ΟΝΟΜΑ, γι' αυτό κάθεται δίπλα του και όχι
                στη δεξιά ομάδα: κολλητά στην πλοήγηση πατιόταν κατά λάθος. */}
            {item.store_phone ? (
              <TouchableOpacity onPress={() => handleCall(item.store_phone, item.store_name)} style={{ marginLeft: 8, padding: 6, backgroundColor: isDarkMode ? '#222' : '#F3F4F6', borderRadius: 12 }}>
                <Feather name="phone-call" size={18} color={isDarkMode ? '#EAD7B1' : '#121212'} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Δεξιά ομάδα: ΠΛΟΗΓΗΣΗ + χρόνος */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {!isScheduled && (
              <TouchableOpacity
                onPress={() => openNavigation(navTarget, !pickedUp && !!item.store_address)}
                style={{ marginLeft: 6, padding: 6, backgroundColor: isDarkMode ? '#222' : '#F3F4F6', borderRadius: 12 }}
                accessibilityLabel="Πλοήγηση"
              >
                <Feather name="navigation" size={18} color={isDarkMode ? '#EAD7B1' : '#121212'} />
              </TouchableOpacity>
            )}
            <View style={{ backgroundColor: isScheduled ? (isDarkMode ? '#262626' : '#F3F4F6') : timeBgColor, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, justifyContent: 'center', marginLeft: 6 }}>
              <Text style={{ color: isScheduled ? (isDarkMode ? '#9CA3AF' : '#6B7280') : timeColor, fontWeight: '900', fontSize: 13 }}>
                {isScheduled
                  ? formatCountdown(remainingMs)
                  : isCompleted
                    ? `${totalMins} λ.`
                    : `${mins} λ.`}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.orderAddress, { color: isDarkMode ? '#EAD7B1' : '#1F2937', fontSize: 17, marginBottom: 6 }]}>{item.address}</Text>

        {/* Διεύθυνση καταστήματος αποστολής — μικρά γράμματα, από κάτω */}
        {item.store_address ? (
          <Text style={{ fontSize: 12, color: isDarkMode ? '#8A8A8A' : '#6B7280', marginBottom: 8 }} numberOfLines={1}>
            <Feather name="corner-up-right" size={11} /> Από: {item.store_address}
          </Text>
        ) : null}

        {/* Μικρές πληροφοριακές ετικέτες: τρόπος πληρωμής + απόσταση */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: item.comments ? 10 : 4 }}>
          {item.payment_method ? (
            <View style={{ backgroundColor: item.payment_method === 'cash' ? '#10B981' : '#208AEF', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
              <Text style={{ fontWeight: '800', color: '#FFF', fontSize: 10, letterSpacing: 0.5 }}>
                {item.payment_method === 'cash' ? 'ΜΕΤΡΗΤΑ' : 'ΚΑΡΤΑ'}
              </Text>
            </View>
          ) : null}
          {km ? (
            <View style={{ backgroundColor: isDarkMode ? '#262626' : '#F3F4F6', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}>
              <Feather name="map-pin" size={10} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
              <Text style={{ fontWeight: '800', color: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 10, marginLeft: 3 }}>{km}</Text>
            </View>
          ) : null}
          {pickedUp && !isCompleted ? (
            <View style={{ backgroundColor: isDarkMode ? '#1e3a24' : '#E8F5E9', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
              <Text style={{ fontWeight: '800', color: '#10B981', fontSize: 10 }}>ΠΑΡΕΛΗΦΘΗ</Text>
            </View>
          ) : null}
        </View>

        {item.comments ? <Text style={[styles.commentText, { fontSize: 14, padding: 8, backgroundColor: isDarkMode ? '#222' : '#F3F4F6', color: isDarkMode ? '#A0A0A0' : '#4B5563' }]}><Feather name="message-square" size={12} /> {item.comments}</Text> : null}

        {/* Προγραμματισμένη: μόνο ενημέρωση, δεν γίνεται αποδοχή πριν την ώρα της */}
        {isScheduled && (
          <View style={{ marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: isDarkMode ? '#1C1C1C' : '#F9FAFB' }}>
            <Text style={{ fontSize: 13, color: isDarkMode ? '#9CA3AF' : '#6B7280', textAlign: 'center' }}>
              <Feather name="clock" size={12} /> Θα σταλεί σε {formatCountdown(remainingMs)}
            </Text>
          </View>
        )}

        {item.status === 'pending' && (
          <TouchableOpacity style={[styles.premiumButtonWrapper, { shadowColor: '#C5A066' }]} onPress={() => acceptOrder(item.id)}>
            <View style={[styles.premiumButtonBackground, { backgroundColor: '#C5A066' }]}>
              <Text style={[styles.premiumButtonText, { color: '#121212' }]}>ΑΠΟΔΟΧΗ</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ΕΝΑ κουμπί σε ΟΛΟ το πλάτος, σε δύο στάδια: πρώτα ΠΑΡΑΛΑΒΗ (φόρτωση
            από το κατάστημα) και μετά ΠΑΡΑΔΟΣΗ. Η πλοήγηση μετακόμισε πάνω. */}
        {item.status === 'accepted' && (
          <TouchableOpacity
            style={[styles.premiumButtonWrapper, { shadowColor: pickedUp ? '#10B981' : '#208AEF' }]}
            onPress={() => (pickedUp ? completeOrder(item.id) : pickUpOrder(item.id))}
          >
            <View style={[styles.premiumButtonBackground, { backgroundColor: pickedUp ? '#10B981' : '#208AEF' }]}>
              <Text style={[styles.premiumButtonText, { color: '#FFF' }]}>
                {pickedUp ? 'ΠΑΡΑΔΟΣΗ' : 'ΠΑΡΑΛΑΒΗ'}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {isCompleted && (
          <Text style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 13, marginTop: 12, fontStyle: 'italic', borderTopWidth: 1, borderTopColor: isDarkMode ? '#333' : '#E5E7EB', paddingTop: 10 }}>
            <Feather name="clock" size={12} /> Συνολικά: {totalMins} λ. (Ενεργή: {activeMins} λ. | Αποδεκτή: {acceptedMins} λ.)
          </Text>
        )}
      </View>
    );
  };

  // Καταστήματα που εμφανίζονται στο επιλεγμένο διάστημα — αυτά γίνονται τα
  // κουμπιά του φίλτρου (όχι όλα τα καταστήματα της εταιρίας).
  const historyStores = [];
  const seenStoreIds = new Set();
  historyData.forEach(o => {
    if (!o.store_id || seenStoreIds.has(o.store_id)) return;
    seenStoreIds.add(o.store_id);
    historyStores.push({ id: o.store_id, name: o.stores?.name || 'Άγνωστο Κατάστημα' });
  });
  historyStores.sort((a, b) => a.name.localeCompare(b.name, 'el'));

  const filteredHistory = storeFilter.length === 0
    ? historyData
    : historyData.filter(o => storeFilter.includes(o.store_id));

  const toggleStoreFilter = (id) =>
    setStoreFilter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Υπολογισμοί Στατιστικών
  let totalOrders = filteredHistory.length;
  let totalDeliveryMins = 0; let countWithTime = 0;
  let coffeeCount = 0; let foodCount = 0;
  let totalRevenue = 0;
  let totalKm = 0;
  let storeCounts = {};

  filteredHistory.forEach(o => {
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
    const d = parseFloat(o.distance_km);
    if (!isNaN(d)) totalKm += d;
  });
  const avgTime = countWithTime > 0 ? (totalDeliveryMins / countWithTime).toFixed(1) : 0;
  const formattedRevenue = totalRevenue.toFixed(2);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomWidth: 0, elevation: 5, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.1, shadowRadius: 5, backgroundColor: isDarkMode ? '#1A1A1A' : '#FFFFFF', zIndex: 10 }]}>
        {/* Οι δύο πλευρές έχουν ΙΔΙΟ πλάτος επίτηδες: αλλιώς ο κεντρικός τίτλος
            μετατοπίζεται οπτικά προς τη στενότερη πλευρά και δεν είναι πραγματικά
            «στη μέση» όπως ζητήθηκε. */}
        {/* ΑΡΙΣΤΕΡΑ: hamburger (το dark/light mode μετακόμισε ΜΕΣΑ στο μενού) */}
        <View style={{ width: 110, alignItems: 'flex-start' }}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} accessibilityLabel="Μενού">
            <View style={{ backgroundColor: isDarkMode ? '#333' : '#F0F0F0', padding: 8, paddingHorizontal: 12, borderRadius: 20 }}>
              <Feather name="menu" size={22} color={isDarkMode ? '#FFF' : '#000'} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ΚΕΝΤΡΟ: ο τίτλος */}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: '#C5A066', fontWeight: 'bold', letterSpacing: 1.5 }}>VERTEX DRIVER</Text>
        </View>

        {/* ΔΕΞΙΑ: ολόκληρο το όνομα του συνδεδεμένου διανομέα */}
        <View style={{ width: 110, alignItems: 'flex-end' }}>
          <Text
            style={[styles.driverName, { color: isDarkMode ? '#EAD7B1' : '#121212', fontSize: 13, textAlign: 'right' }]}
            numberOfLines={2}
          >
            {currentUser.full_name}
          </Text>
        </View>
      </View>

      {/* Το «Στίγμα» έφυγε από τον header (συγκρουόταν με το menu/όνομα) και
          κατέβηκε σε δική του διακριτική μπάρα κατάστασης. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 4, backgroundColor: isDarkMode ? '#141414' : '#F3F4F6' }}>
        <Feather name="map-pin" size={10} color={isDarkMode ? '#888' : '#777'} />
        <Text style={{ fontSize: 10, color: isDarkMode ? '#888' : '#777', marginLeft: 4 }}>
          Στίγμα: {lastLocationUpdate}
        </Text>
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

      {/* Στην καρτέλα «Ενεργές» μπαίνουν πρώτα οι προγραμματισμένες (με αντίστροφη
          μέτρηση, χωρίς κουμπί αποδοχής) και ακολουθούν οι κανονικές. Έτσι ο
          διανομέας βλέπει τι έρχεται και οργανώνεται. */}
      <FlatList
        data={activeTab === 'pending' ? [...scheduledOrders, ...pendingOrders] : myOrders}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrderItem}
        // Χωρίς αυτό η FlatList δεν ξαναζωγραφίζει τις γραμμές όταν χτυπά το ρολόι,
        // και οι χρόνοι/αντίστροφες μετρήσεις θα «πάγωναν».
        extraData={now}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchOrders} />}
      />

      {/* Hamburger Menu Modal */}
      <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuContent}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setIsHistoryVisible(true); }}>
              <Text style={styles.menuItemText}><Feather name="bar-chart-2" size={16} /> Ιστορικό / Στατιστικά</Text>
            </TouchableOpacity>
            {/* Το dark/light mode ζει πλέον εδώ μέσα (αίτημα πελάτη) — ο header
                κράτησε μόνο menu / τίτλο / όνομα. Το μενού μένει ανοιχτό ώστε να
                βλέπει αμέσως την αλλαγή. */}
            <TouchableOpacity style={styles.menuItem} onPress={() => setIsDarkMode(!isDarkMode)}>
              <Text style={styles.menuItemText}>
                <Feather name={isDarkMode ? 'sun' : 'moon'} size={16} /> {isDarkMode ? 'Φωτεινό θέμα' : 'Σκούρο θέμα'}
              </Text>
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

          {/* Φίλτρο ανά κατάστημα — οποιοσδήποτε συνδυασμός. Καμία επιλογή = όλα. */}
          {historyStores.length > 1 && (
            <View style={{ marginBottom: 14 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                <TouchableOpacity
                  style={[styles.filterBtn, storeFilter.length === 0 && styles.filterBtnActive]}
                  onPress={() => setStoreFilter([])}
                >
                  <Text style={[styles.filterBtnText, storeFilter.length === 0 && styles.filterBtnTextActive]}>Όλα</Text>
                </TouchableOpacity>
                {historyStores.map(s => {
                  const on = storeFilter.includes(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.filterBtn, on && styles.filterBtnActive]}
                      onPress={() => toggleStoreFilter(s.id)}
                    >
                      <Text style={[styles.filterBtnText, on && styles.filterBtnTextActive]}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
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
          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#208AEF' }]}>{totalKm.toFixed(1)}</Text>
              <Text style={styles.statLabel}>Συνολικά χλμ</Text>
            </View>
          </View>

          <View style={[styles.filterRow, { marginTop: 10 }]}>
            <TouchableOpacity
              style={[styles.filterBtn, { flex: 1, alignItems: 'center' }, historyView === 'summary' && styles.filterBtnActive]}
              onPress={() => setHistoryView('summary')}
            >
              <Text style={[styles.filterBtnText, historyView === 'summary' && styles.filterBtnTextActive]}>Ανά Κατάστημα</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterBtn, { flex: 1, alignItems: 'center' }, historyView === 'detailed' && styles.filterBtnActive]}
              onPress={() => setHistoryView('detailed')}
            >
              <Text style={[styles.filterBtnText, historyView === 'detailed' && styles.filterBtnTextActive]}>Αναλυτικό Ιστορικό</Text>
            </TouchableOpacity>
          </View>

          {historyView === 'summary' ? (
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
          ) : (
            <FlatList
              data={[...filteredHistory].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))}
              keyExtractor={item => item.id.toString()}
              renderItem={({ item }) => {
                const { acceptedMins } = orderDurations(item);
                const completed = item.completed_at ? new Date(item.completed_at) : null;
                const km = formatKm(item.distance_km);
                return (
                  <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#333' : '#E5E7EB' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={{ fontWeight: '800', fontSize: 15, color: isDarkMode ? '#EAD7B1' : '#1F2937', flexShrink: 1 }} numberOfLines={1}>
                        {item.stores?.name || 'Άγνωστο Κατάστημα'}
                      </Text>
                      {completed ? (
                        <Text style={{ fontSize: 12, color: isDarkMode ? '#9CA3AF' : '#6B7280' }}>
                          {completed.getDate()}/{completed.getMonth() + 1} {completed.getHours()}:{String(completed.getMinutes()).padStart(2, '0')}
                        </Text>
                      ) : null}
                    </View>

                    {/* Πού πήγε η παραγγελία — όχι μόνο από πού ήρθε */}
                    <Text style={{ fontSize: 13, color: isDarkMode ? '#C9C9C9' : '#374151', marginBottom: 6 }} numberOfLines={1}>
                      <Feather name="corner-down-right" size={11} /> {item.address}
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      {item.payment_method ? (
                        <View style={{ backgroundColor: item.payment_method === 'cash' ? '#10B981' : '#208AEF', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
                          <Text style={{ fontWeight: '800', color: '#FFF', fontSize: 10, letterSpacing: 0.5 }}>
                            {item.payment_method === 'cash' ? 'ΜΕΤΡΗΤΑ' : 'ΚΑΡΤΑ'}
                          </Text>
                        </View>
                      ) : null}
                      {km ? (
                        <View style={{ backgroundColor: isDarkMode ? '#262626' : '#F3F4F6', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}>
                          <Feather name="map-pin" size={10} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
                          <Text style={{ fontWeight: '800', color: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 10, marginLeft: 3 }}>{km}</Text>
                        </View>
                      ) : null}
                      <View style={{ backgroundColor: isDarkMode ? '#262626' : '#F3F4F6', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}>
                        <Feather name="clock" size={10} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
                        <Text style={{ fontWeight: '800', color: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 10, marginLeft: 3 }}>{acceptedMins} λ.</Text>
                      </View>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={{color: isDarkMode ? '#AAA' : '#666', textAlign:'center', marginTop:20}}>Καμία παραγγελία σε αυτό το διάστημα.</Text>}
            />
          )}
        </View>
      </Modal>

      {/* Custom Alert Modal για επιβεβαίωση ενεργειών */}
      <Modal visible={confirmModalVisible} transparent={true} animationType="fade" onRequestClose={() => setConfirmModalVisible(false)}>
        <View style={styles.alertModalOverlay}>
          <View style={styles.alertModalContainer}>
            <Text style={styles.alertModalTitle}>{confirmConfig.title}</Text>
            <Text style={styles.alertModalMessage}>{confirmConfig.message}</Text>
            <View style={styles.alertModalButtonContainer}>
              {!confirmConfig.alertOnly && (
                <TouchableOpacity style={styles.alertModalButtonCancel} onPress={() => setConfirmModalVisible(false)}>
                  <Text style={styles.alertModalButtonCancelText}>Όχι</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.alertModalButtonConfirm} onPress={confirmConfig.onConfirm}>
                <Text style={styles.alertModalButtonConfirmText}>{confirmConfig.confirmLabel || 'Ναι'}</Text>
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
              onPress={() => { stopAlarm(); setSystemAlert(null); }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Το είδα (ΟΚ)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── ΣΥΝΑΓΕΡΜΟΣ ΑΝΑΘΕΣΗΣ ΑΠΟ ΤΟΝ ΔΙΑΧΕΙΡΙΣΤΗ ───
          Χτυπά δυνατά και επαναλαμβανόμενα για 15" ώστε να μη χαθεί η ανάθεση.
          Σταματά είτε με το ΟΚ είτε μόλις περάσουν τα 15" — ο ήχος σταματά μόνος
          του, το παράθυρο όμως μένει μέχρι να το δει ο διανομέας. */}
      <Modal visible={!!assignmentAlert} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: isDarkMode ? '#1C1C1C' : '#FFFFFF',
            borderRadius: 24,
            padding: 24,
            borderTopWidth: 4,
            borderTopColor: '#EF4444',
            elevation: 10,
          }}>
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: isDarkMode ? '#F0EBE2' : '#1E1A14', marginBottom: 16 }}>
              <Feather name="bell" size={20} /> Νέα ανάθεση παραγγελίας
            </Text>
            <View style={{ backgroundColor: isDarkMode ? '#2A2520' : '#F4F0EB', padding: 16, borderRadius: 12, marginBottom: 20 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: isDarkMode ? '#C5A066' : '#8A7347', marginBottom: 4 }}>
                {assignmentAlert?.store_name}
              </Text>
              <Text style={{ fontSize: 16, color: isDarkMode ? '#F0EBE2' : '#1E1A14' }}>
                {assignmentAlert?.address}
              </Text>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#C5A066', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
              onPress={() => { stopAlarm(); setAssignmentAlert(null); setActiveTab('my_orders'); }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Το είδα (ΟΚ)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}