import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, Vibration, Linking, Platform, AppState, Modal, Image, Animated, Easing } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { formatKm, formatCountdown, orderDurations, minutesSinceCreated } from '../utils/orderInfo';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, clearDriverPresenceEverywhere, getTenantSchema, isReadOnly, onBackendChange, hardSignOut } from '../../supabase';
import { getStyles, Colors, CardColors } from '../styles/globalStyles';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getLastReadAt } from '../services/announcementsStore';
import DriverMenu from './DriverMenu';
import HistoryScreen from './HistoryScreen';
import AvailabilityScreen from './AvailabilityScreen';
import MyScheduleScreen from './MyScheduleScreen';
import AnnouncementsScreen from './AnnouncementsScreen';
import DriverBroadcastScreen from './DriverBroadcastScreen';
import SupportScreen from './SupportScreen';
import VehicleSelectScreen from './VehicleSelectScreen';

const notificationSound = require('../../assets/notification.mp3');
const alarmSound = require('../../assets/assignment.wav');
const messageSound = require('../../assets/message.wav');

const emptyOrdersDark = require('../../assets/empty_orders_dark.png');
const emptyOrdersLight = require('../../assets/empty_orders_light.png');

// ── Πλαίσιο «σήμερα»: ολοκληρωμένες / χιλιόμετρα / ώρες βάρδιας ──────────────
// Μετά από τόση σιωπή ο server κλείνει ΜΟΝΟΣ του τη βάρδια (c_shift_idle_s,
// migration 0013). Το κρατάμε ίδιο εδώ ώστε ο μετρητής «Ενεργός» να μη συνεχίζει
// να τρέχει στην οθόνη για μια βάρδια που η βάση θεωρεί ήδη τελειωμένη.
const SHIFT_IDLE_MS = 30 * 60 * 1000;

/**
 * Χιλιόμετρα και χρόνος βάρδιας ΜΕΣΑ στο σημερινό 24ωρο (τοπική ώρα — η συσκευή
 * του διανομέα είναι στην Ελλάδα, άρα ταυτίζεται με το Europe/Athens της αναφοράς).
 *
 * ΟΙ ΩΡΕΣ ΕΙΝΑΙ ΑΚΡΙΒΕΙΣ: κρατάμε την τομή κάθε βάρδιας με το [μεσάνυχτα, τώρα].
 *
 * ΤΑ ΧΙΛΙΟΜΕΤΡΑ ΣΕ ΒΑΡΔΙΑ ΠΟΥ ΠΕΡΝΑΕΙ ΤΑ ΜΕΣΑΝΥΧΤΑ ΜΟΙΡΑΖΟΝΤΑΙ ΚΑΤ' ΑΝΑΛΟΓΙΑ
 * ΧΡΟΝΟΥ, γιατί δεν γίνεται αλλιώς: ο χιλιομετρητής κρατά ΕΝΑ σωρευτικό νούμερο
 * ανά βάρδια (`driver_shifts.distance_m`) και δεν υπάρχει πουθενά ιστορικό
 * στιγμάτων για να κοπεί στα μεσάνυχτα. Όταν η βάρδια ξεκινά και τελειώνει την
 * ίδια μέρα — η συντριπτική πλειοψηφία — ο συντελεστής είναι 1, δηλαδή το νούμερο
 * είναι ακριβές. Η προσέγγιση αφορά ΜΟΝΟ αυτό το κουτάκι: η χρέωση καυσίμων
 * διαβάζει τη βάρδια ολόκληρη από το `driver_distance_report()` και δεν αγγίζεται.
 */
export function todayShiftTotals(shifts, now) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const t0 = dayStart.getTime();
  const tNow = now.getTime();

  let meters = 0;
  let seconds = 0;

  (shifts || []).forEach((s) => {
    const start = new Date(s.started_at).getTime();
    if (!Number.isFinite(start)) return;
    const lastSeen = s.last_ping_at ? new Date(s.last_ping_at).getTime() : start;
    // Ανοιχτή βάρδια: μετράει μέχρι ΤΩΡΑ μόνο όσο φτάνουν στίγματα. Αν το κινητό
    // σιωπήσει (κλειστή εφαρμογή, άδεια μπαταρία), σταματάμε στο τελευταίο στίγμα
    // — ακριβώς εκεί που θα την κλείσει και ο server. Αλλιώς ο μετρητής θα
    // «δούλευε» όλη νύχτα με σβηστό τηλέφωνο.
    const end = s.ended_at
      ? new Date(s.ended_at).getTime()
      : (tNow - lastSeen <= SHIFT_IDLE_MS ? tNow : lastSeen);

    const total = Math.max(end - start, 0);
    // Math.min(end, tNow): φράχτης για ρολόι server/συσκευής που πάει μπροστά.
    const overlap = Math.max(Math.min(end, tNow) - Math.max(start, t0), 0);
    if (overlap <= 0) return;

    seconds += overlap / 1000;
    meters += (Number(s.distance_m) || 0) * (total > 0 ? overlap / total : 0);
  });

  return { meters, seconds };
}

/** «0,0 km» — όπως στο σχέδιο του πελάτη (η κάρτα παραγγελίας γράφει «χλμ»). */
function formatShiftKm(meters) {
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** «00:00» — ώρες:λεπτά στη βάρδια. Μεγαλώνει πέρα από τις 24 αν χρειαστεί. */
function formatShiftClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** «21:07» — η ώρα που στάλθηκε μια ανακοίνωση συναδέλφου. */
function formatClockTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function DriverDashboard({ currentUser, setCurrentUser, isDarkMode, setIsDarkMode }) {
  const styles = getStyles(isDarkMode);
  // Οι σκούρες επιφάνειες (header, μπάρες, modals) παίρνουν χρώμα από την παλέτα
  // αντί για καρφωτά greys — αλλιώς έμεναν μαύρες πάνω στο νέο navy φόντο.
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  // ΤΑ HOOKS ΜΠΑΙΝΟΥΝ ΑΥΣΤΗΡΑ ΕΔΩ ΣΤΗΝ ΚΟΡΥΦΗ!
  // Τρεις ξεχωριστοί players — ένας ανά είδος ειδοποίησης (νέα παραγγελία / ανάθεση
  // /μετάθεση / μήνυμα κέντρου) — ο πελάτης θέλει να τους ξεχωρίζει με το αυτί.
  const player = useAudioPlayer(notificationSound);
  const alarmPlayer = useAudioPlayer(alarmSound);
  const messagePlayer = useAudioPlayer(messageSound);
  // ΤΕΤΑΡΤΟΣ player με το ΙΔΙΟ αρχείο ήχου, αποκλειστικά για την ανακοίνωση
  // συναδέλφου. Ο πελάτης ζήτησε τον ήχο των μηνυμάτων — αλλά ο messagePlayer
  // μπορεί εκείνη τη στιγμή να κάνει loop για μήνυμα του κέντρου (που επιμένει
  // μέχρι το «ΟΚ»). Αν τον μοιραζόμασταν, ένα seekTo(0) εδώ θα έκοβε εκείνον
  // τον συναγερμό στη μέση. Ξεχωριστός player = μηδενική παρεμβολή.
  const colleaguePlayer = useAudioPlayer(messageSound);

  const [pendingOrders, setPendingOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  // Προγραμματισμένες: το κατάστημα τις έστειλε με καθυστέρηση. Ο διανομέας τις
  // ΒΛΕΠΕΙ με αντίστροφη μέτρηση αλλά δεν μπορεί να τις πάρει πριν λάχει η ώρα.
  const [scheduledOrders, setScheduledOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [refreshing, setRefreshing] = useState(false);
  // ── Πλαίσιο «σήμερα» στο τέλος της λίστας ──
  // Κρατάμε τις ΓΡΑΜΜΕΣ των βαρδιών, όχι έτοιμα σύνολα: έτσι το «Ενεργός»
  // προχωράει μόνο του σε κάθε χτύπο του ρολογιού παρακάτω, χωρίς νέο ερώτημα.
  const [todayShifts, setTodayShifts] = useState([]);
  const [todayCompleted, setTodayCompleted] = useState(0);
  // Ρολόι για τις αντίστροφες μετρήσεις (χτυπά ανά δευτερόλεπτο μόνο όταν χρειάζεται).
  const [now, setNow] = useState(new Date());

  // ── Συναγερμός ανάθεσης από τον διαχειριστή ──
  const [assignmentAlert, setAssignmentAlert] = useState(null);
  // Παραγγελίες που κρατούσε ήδη ο διανομέας στο προηγούμενο fetch — για να
  // ξεχωρίσουμε τη ΝΕΑ ανάθεση από τα υπόλοιπα updates.
  const knownMyOrderIds = useRef(null);
  // Παραγγελίες που πάτησε ΜΟΝΟΣ του «Αποδοχή»: δεν πρέπει να χτυπήσει συναγερμός.
  const selfAcceptedIds = useRef(new Set());
  // Αναθέσεις που έφτασαν ως PUSH με την εφαρμογή κλειστή/στο background. Με κλειστή
  // εφαρμογή ο ήχος του OS παίζει ΜΙΑ φορά και ο 15δευτερος συναγερμός δεν προλαβαίνει
  // να χτυπήσει ποτέ (στο πρώτο fetch το knownMyOrderIds είναι null, οπότε σκόπιμα δεν
  // ηχεί για να μη «ξυπνήσει» σε κάθε άνοιγμα). Κρατάμε λοιπόν ποιες ήρθαν με push,
  // ώστε να μετρήσουν ως ΝΕΕΣ μόλις ανοίξει η εφαρμογή και να χτυπήσει κανονικά.
  const assignedByPushIds = useRef(new Set());
  // Ποιες από αυτές ΕΧΟΥΝ ΗΔΗ ΗΧΗΣΕΙ στη συσκευή μέσω του push (κανάλι Android).
  // Χωρίς αυτό, ο in-app συναγερμός ξεκινούσε ΠΑΝΩ στον ήχο του push που έπαιζε
  // ακόμα — ο διανομέας άκουγε τον ίδιο 20δευτερο ήχο δύο φορές παράλληλα μόλις
  // άνοιγε το κινητό (αναφορά πελάτη 30/07/2026).
  const pushAlreadySoundedIds = useRef(new Set());
  // Το επόμενο fetchOrders δεν επιτρέπεται να ηχήσει: μόλις επιστρέψαμε στο
  // προσκήνιο, άρα ό,τι βρούμε «νέο» το έχει ήδη αναγγείλει το push.
  const suppressAlarmOnNextFetch = useRef(false);
  const alarmTimers = useRef([]);
  // Ποιες ήταν προγραμματισμένες στο τελευταίο fetch. Χρειάζεται ως ref (και όχι
  // state) γιατί το διαβάζει ο realtime handler, που ζει σε effect με άδειο
  // dependency array — ένα state θα ήταν παγωμένο στην αρχική τιμή του.
  const scheduledIds = useRef(new Set());
  
  // ── Μενού & οθόνες ────────────────────────────────────────────────────────
  // Η εφαρμογή δεν έχει router: οι οθόνες του μενού ανοίγουν ως full-screen
  // Modal πάνω από τη λίστα παραγγελιών. Το `activeScreen` κρατά ποια.
  // «Αρχική» δεν είναι οθόνη — είναι το κλείσιμο όλων (activeScreen = null).
  const [menuVisible, setMenuVisible] = useState(false);
  const [activeScreen, setActiveScreen] = useState(null);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);

  // States για Custom Modal Επιβεβαίωσης (και για απλά ενημερωτικά μηνύματα — βλ. showAlert
  // παρακάτω· έτσι όλα τα μηνύματα προς τον χρήστη μοιράζονται το ίδιο styled modal αντί να
  // εναλλάσσονται με το native Alert.alert).
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', onConfirm: null, alertOnly: false, confirmLabel: 'Ναι' });

  // State για μηνύματα από το Κέντρο Ελέγχου
  const [systemAlert, setSystemAlert] = useState(null);

  // ── Ανακοινώσεις μεταξύ διανομέων (αίτημα πελάτη 08/08/2026) ───────────────
  // ΟΥΡΑ και όχι μία τιμή: αν δύο συνάδελφοι μιλήσουν σχεδόν ταυτόχρονα, η
  // δεύτερη ανακοίνωση θα έσβηνε την πρώτη πριν προλάβει να τη διαβάσει κανείς.
  // Δείχνουμε την πρώτη, το «ΟΚ» την πετάει και εμφανίζεται η επόμενη.
  const [driverBroadcasts, setDriverBroadcasts] = useState([]);
  // Η ίδια ανακοίνωση ταξιδεύει από ΔΥΟ δρόμους (Realtime broadcast για ανοιχτή
  // εφαρμογή, FCM push για κλειδωμένη οθόνη). Κρατάμε ποιες έχουμε ήδη δει ώστε
  // να μη δείξουμε — και κυρίως να μην ηχήσουμε — την ίδια δύο φορές.
  const seenBroadcastIds = useRef(new Set());
  // Το κανάλι μέσω του οποίου ΣΤΕΛΝΕΙ ο διανομέας. Το Realtime απαιτεί να είσαι
  // subscribed για να κάνεις broadcast, οπότε στέλνουμε από το ίδιο κανάλι που
  // ήδη ακούει παρακάτω — δεύτερο κανάλι με το ίδιο topic θα ήταν διπλή σύνδεση.
  const broadcastChannel = useRef(null);
  const [lastLocationUpdate, setLastLocationUpdate] = useState("Περιμένω στίγμα...");
  const [locationPermStatus, setLocationPermStatus] = useState('...');
  // Πράσινη/κόκκινη κουκκίδα δίπλα στο «Στίγμα»: πράσινη όσο φτάνουν φρέσκα GPS
  // updates (το native service στέλνει κάθε 10"), κόκκινη αν περάσει το όριο
  // χωρίς νέο — σημάδι ότι κάτι κόλλησε (άδεια τοποθεσίας, νεκρό service, δίκτυο).
  const [locationOk, setLocationOk] = useState(false);
  const lastLocationUpdateAt = useRef(0);

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

  // Συγχρονίζει το «Στίγμα» με την ΑΛΗΘΕΙΑ της βάσης (`drivers.last_seen`,
  // trigger `trg_driver_last_seen` — ενημερώνεται σε ΚΑΘΕ update της γραμμής)
  // αντί να περιμένει μόνο το realtime κανάλι `driver_monitor_*` παρακάτω.
  //
  // ΓΙΑΤΙ ΧΡΕΙΑΖΕΤΑΙ: το native GPS service συνεχίζει να στέλνει στίγματα ΚΑΙ
  // με νεκρό/παγωμένο το JS (βλ. sessionStore) — αλλά το Realtime websocket
  // ΔΕΝ αναπληρώνει events που χάθηκαν όσο ήταν αποσυνδεδεμένο (κλειδωμένη
  // οθόνη, Doze, εναλλαγή εφαρμογής). Χωρίς αυτό, κάθε επιστροφή στο
  // προσκήνιο έδειχνε ψευδώς «χωρίς σήμα» μέχρι να φτάσει το επόμενο φυσικό
  // στίγμα — αυτό είναι το «στην αρχή πράσινο, μετά σκουραίνει» που ανέφερε ο
  // πελάτης 04/08/2026, ενώ το GPS δούλευε κανονικά όλη την ώρα.
  async function refreshLocationStatus() {
    try {
      const { data } = await supabase
        .from('drivers')
        .select('last_seen')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (!data?.last_seen) return;
      const seen = new Date(data.last_seen);
      lastLocationUpdateAt.current = seen.getTime();
      setLocationOk(Date.now() - seen.getTime() <= 30000);
      setLastLocationUpdate(`${seen.getHours()}:${String(seen.getMinutes()).padStart(2, '0')}:${String(seen.getSeconds()).padStart(2, '0')}`);
    } catch (e) {
      console.log('Location status error:', e);
    }
  }

  useEffect(() => {
    fetchOrders();
    refreshLocationStatus();

    // Φόρτωση κατάστασης άδειας τοποθεσίας απευθείας από το OS (όχι cache)
    const checkPerms = async () => {
      const bgPerm = await Location.getBackgroundPermissionsAsync();
      setLocationPermStatus(bgPerm.status);
    };
    checkPerms();



    // Μια ανάθεση/μετάθεση που ήρθε ως push πρέπει να χτυπήσει τον κανονικό
    // 20δευτερο συναγερμό μόλις ανοίξει η εφαρμογή. Τα 'reassign_away'/'cancel'
    // ΔΕΝ μπαίνουν εδώ επίτηδες: η παραγγελία φεύγει από τη λίστα του, δεν έρχεται
    // — δεν έχει νόημα να τον υποδεχτεί συναγερμός ανάθεσης όταν ανοίξει.
    // ΠΟΙΟΣ ΗΧΕΙ, ΤΟ ANDROID Ή ΕΜΕΙΣ — ο κανόνας που κρίνει τα πάντα εδώ:
    //
    // Το FCM payload της send-assignment-notification περιέχει μπλοκ
    // `notification`, οπότε ΟΤΑΝ Η ΕΦΑΡΜΟΓΗ ΔΕΝ ΕΙΝΑΙ ΜΠΡΟΣΤΑ το Android
    // εμφανίζει και ηχεί την ειδοποίηση ΜΟΝΟ ΤΟΥ (κανάλι assignments_urgent_v3,
    // assignment.wav, 20"). Ο κώδικάς μας δεν συμμετέχει καθόλου.
    // Ο handler του App.js (shouldPlaySound:false) ισχύει ΜΟΝΟ σε foreground.
    //
    // Άρα: ο in-app συναγερμός επιτρέπεται ΜΟΝΟ αν η εφαρμογή ήταν πραγματικά
    // μπροστά τη στιγμή που ήρθε το push. Κάθε άλλη περίπτωση έχει ήδη ηχήσει
    // από το λειτουργικό και ένας δεύτερος ήχος θα έπεφτε ΠΑΝΩ του.
    const rememberAssignmentPush = (notification, alreadySounded) => {
      const data = notification?.request?.content?.data;
      if (!data) return;
      if ((data.kind === 'assign' || data.kind === 'reassign') && data.orderId) {
        assignedByPushIds.current.add(String(data.orderId));
        if (alreadySounded) pushAlreadySoundedIds.current.add(String(data.orderId));
      }
    };

    // Ανακοίνωση συναδέλφου που ήρθε ως push. Όλα τα στοιχεία (όνομα, ώρα,
    // κείμενο) ταξιδεύουν μέσα στο `data` του FCM — δεν υπάρχει πίνακας να
    // ρωτήσουμε, το μήνυμα δεν αποθηκεύεται πουθενά.
    const readDriverBroadcastPush = (notification, alreadySounded) => {
      const data = notification?.request?.content?.data;
      if (!data || data.kind !== 'driver_broadcast') return;
      receiveDriverBroadcast({
        id: data.broadcastId,
        sender_id: data.senderId,
        sender_name: data.sender,
        message: data.message,
        sent_at: data.sentAt,
      }, alreadySounded);
    };

    // Listeners για ανανέωση δεδομένων μέσω Push Notifications
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      // Ο listener χτυπά και σε background (η εφαρμογή ζει ακόμα). ΤΟΤΕ όμως το
      // Android έχει ήδη ηχήσει. Το AppState είναι το μόνο αξιόπιστο κριτήριο —
      // δεν εξαρτάται από ανάγνωση της μπάρας ειδοποιήσεων ούτε από το OEM.
      rememberAssignmentPush(notification, AppState.currentState !== 'active');
      readDriverBroadcastPush(notification, AppState.currentState !== 'active');
      fetchOrders();
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      // Tap στην ειδοποίηση ⇒ ήταν ορατή ⇒ το κανάλι ΕΠΑΙΞΕ τον ήχο.
      rememberAssignmentPush(response?.notification, true);
      readDriverBroadcastPush(response?.notification, true);
      fetchOrders();
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
      if (nextAppState === 'active') {
        // ΔΕΥΤΕΡΗ ΓΡΑΜΜΗ ΑΜΥΝΑΣ. Ο διανομέας ανοίγει την εφαρμογή από το εικονίδιο
        // (όχι με tap στην ειδοποίηση): κανένας listener δεν χτυπά, αλλά η ανάθεση
        // εμφανίζεται ως «νέα» σε αυτό ακριβώς το fetch και θα ξεκινούσε συναγερμό
        // — ενώ ο ήχος του Android παίζει ΑΚΟΜΑ. Ό,τι ανακαλύπτεται με την
        // επιστροφή στο προσκήνιο συνοδεύτηκε ήδη από push, οπότε μένει σιωπηλό.
        // Δεν εξαρτάται από το orderId του payload — δουλεύει ό,τι κι αν στείλει
        // το FCM.
        suppressAlarmOnNextFetch.current = true;
        fetchOrders();
        // Ίδιος λόγος: το realtime κανάλι GPS χάνει ό,τι συνέβη όσο ήμασταν
        // στο παρασκήνιο, οπότε ρωτάμε ΑΠΕΥΘΕΙΑΣ τη βάση για το πραγματικό
        // last_seen αντί να περιμένουμε το επόμενο φυσικό στίγμα.
        refreshLocationStatus();
      }
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

    // ─── ΑΝΑΚΟΙΝΩΣΕΙΣ ΜΕΤΑΞΥ ΔΙΑΝΟΜΕΩΝ (BROADCAST) ───
    // Ξεχωριστό κανάλι από το 'system_alerts' του κέντρου: άλλος αποστολέας,
    // άλλη συμπεριφορά (ένας ήχος αντί για συναγερμό που επιμένει) — και έτσι
    // δεν ακούνε τα καταστήματα, που είναι κι αυτά συνδρομητές στο system_alerts.
    // Το ΙΔΙΟ κανάλι χρησιμεύει και για την ΑΠΟΣΤΟΛΗ (βλ. sendDriverBroadcast):
    // το Realtime απαιτεί ενεργή συνδρομή για να επιτρέψει broadcast.
    const driverBroadcastChannel = supabase
      .channel('driver_broadcasts')
      .on('broadcast', { event: 'driver_message' }, (payload) => {
        // Το websocket ζει και στο παρασκήνιο: αν φτάσει από εκεί, τον ήχο τον
        // έχει ήδη αναλάβει το push του λειτουργικού.
        receiveDriverBroadcast(payload.payload, AppState.currentState !== 'active');
      })
      .subscribe();
    broadcastChannel.current = driverBroadcastChannel;

    // ─── ΛΗΨΗ ΑΛΛΑΓΩΝ GPS ΣΕ ΠΡΑΓΜΑΤΙΚΟ ΧΡΟΝΟ ΓΙΑ MONITORING ───
    const driverChannel = supabase
      .channel(`driver_monitor_${currentUser.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: getTenantSchema(), table: 'drivers', filter: `id=eq.${currentUser.id}` }, (payload) => {
        if (payload.new.latitude && payload.new.longitude) {
          const now = new Date();
          lastLocationUpdateAt.current = now.getTime();
          setLocationOk(true);
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
      supabase.removeChannel(driverBroadcastChannel);
      broadcastChannel.current = null;
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

  // Τα χιλιόμετρα και οι ώρες αλλάζουν συνέχεια ΧΩΡΙΣ να συμβαίνει τίποτα με τις
  // παραγγελίες, οπότε θέλουν δικό τους ρολόι αντί να κρεμαστούν στο fetchOrders
  // (που τρέχει σε κάθε realtime event και θα διπλασίαζε τα ερωτήματα χωρίς λόγο).
  // Το λεπτό αρκεί: και τα τρία νούμερα δείχνουν χοντρές μονάδες — τεμάχια,
  // δέκατα του χιλιομέτρου, λεπτά. Πιάνει και τη μετάβαση των μεσανυχτών.
  useEffect(() => {
    fetchTodayStats();
    const t = setInterval(fetchTodayStats, 60000);
    return () => clearInterval(t);
  }, []);

  // Ελέγχει ανεξάρτητα (κάθε 5") αν το τελευταίο GPS update είναι ακόμα φρέσκο —
  // ξεχωριστό από το ρολόι πάνω, που σε ήσυχες στιγμές χτυπά μόνο ανά λεπτό και
  // θα άργαγε πολύ να δείξει «κόκκινο» αν κολλήσει το στίγμα.
  useEffect(() => {
    const STALE_MS = 30000;
    const t = setInterval(() => {
      const last = lastLocationUpdateAt.current;
      setLocationOk(!!last && Date.now() - last <= STALE_MS);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Κουκκίδα «Στίγμα» στον header (αίτημα πελάτη 04/08/2026) ───────────────
  // Έφυγε η ξεχωριστή μπάρα κάτω από τον header (κατέβασμα όλης της οθόνης
  // κατά μία σειρά) — μένει μόνο μια μικρή κουκκίδα δίπλα στο «VERTEX DRIVER»,
  // με την αναλυτική ώρα να μετακόμισε στο πλαϊνό μενού. ΑΝΑΒΟΣΒΗΝΕΙ κόκκινη
  // όσο δεν έχει σήμα — μόνιμα κόκκινη θα περνούσε απαρατήρητη σε μια γωνία
  // τόσο μικρή· σταθερή πράσινη όταν όλα καλά, γιατί εκεί δεν χρειάζεται να
  // τραβήξει το βλέμμα.
  const gpsBlink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (locationOk) {
      gpsBlink.stopAnimation();
      gpsBlink.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(gpsBlink, { toValue: 0.15, duration: 500, useNativeDriver: true }),
        Animated.timing(gpsBlink, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [locationOk, gpsBlink]);

  // ── Παλμοί «διαθεσιμότητας» στην άδεια λίστα ───────────────────────────────
  // Τρεις ομόκεντροι κύκλοι που ξεδιπλώνονται από το στίγμα του διανομέα. Είναι
  // ΣΚΕΤΟΙ ΚΥΚΛΟΙ (Animated.View + borderRadius), όχι SVG: το react-native-svg
  // θα απαιτούσε νέο native build, ενώ έτσι όλο το εφέ φεύγει με eas update.
  // Ο χάρτης από κάτω παραμένει PNG.
  const pulses = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  // ΤΡΕΧΕΙ ΜΟΝΟ ΟΣΟ ΦΑΙΝΕΤΑΙ ΤΟ ΑΔΕΙΟ ΠΛΑΙΣΙΟ. Η εφαρμογή ζει όλη τη βάρδια στο
  // κινητό του διανομέα — δεν αφήνουμε animation να γυρίζει από κάτω ενώ η οθόνη
  // δείχνει παραγγελίες.
  const showingEmpty = activeTab === 'pending'
    ? (pendingOrders.length + scheduledOrders.length) === 0
    : myOrders.length === 0;

  useEffect(() => {
    if (!showingEmpty) return;
    // Το Animated.loop μηδενίζει μόνο του την τιμή σε κάθε επανάληψη, οπότε το
    // stagger μπαίνει ΜΙΑ φορά στην εκκίνηση (αν έμπαινε μέσα στο loop ως delay,
    // θα ξαναπερίμενε σε κάθε κύκλο και οι παλμοί θα «κόμπιαζαν»).
    const loops = pulses.map((v) => Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 3600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    ));
    const timers = loops.map((l, i) => setTimeout(() => l.start(), i * 1200));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
      pulses.forEach((v) => v.setValue(0));
    };
  }, [showingEmpty]);

  // ── Ηχητικοί συναγερμοί ────────────────────────────────────────────────────
  // Χρησιμοποιούμε το `loop` του expo-audio αντί για setInterval με seekTo: ο ήχος
  // επαναλαμβάνεται χωρίς κενά και σταματά ακαριαία, χωρίς να κυνηγάμε timers.
  //
  // Δύο σενάρια, όπως τα ζήτησε ο πελάτης:
  //   • ΑΝΑΘΕΣΗ από διαχειριστή → δυνατά και επαναλαμβανόμενα για 20", σταματά
  //     είτε με «Το είδα (ΟΚ)» είτε μόλις περάσουν τα 20".
  //   • ΜΗΝΥΜΑ από διαχειριστή → συνεχόμενα, μέχρι να πατηθεί το ΟΚ.
  //
  // Τα 20" ταιριάζουν σκόπιμα με τη διάρκεια του assignment.wav, ώστε ο διανομέας
  // να ακούει το ίδιο πράγμα είτε είναι ανοιχτή η εφαρμογή είτε όχι.
  const ASSIGNMENT_ALARM_MS = 20000;

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
    // ΚΑΙ ΤΟΝ ΗΧΟ ΤΟΥ ΛΕΙΤΟΥΡΓΙΚΟΥ. Τα παραπάνω σταματούν μόνο ό,τι παίζει η
    // ΕΦΑΡΜΟΓΗ. Ο ήχος του push τον παίζει το Android μέσω του καναλιού
    // (assignment.wav, 20") και ζει εντελώς έξω από το expo-audio — γι' αυτό ο
    // διανομέας πατούσε «Το είδα (ΟΚ)» και ο ήχος συνέχιζε. Το μόνο χερούλι
    // πάνω του είναι η ακύρωση της ίδιας της ειδοποίησης.
    Notifications.dismissAllNotificationsAsync().catch(() => {});
  }

  // `autoStopMs = 0` σημαίνει «μέχρι να το σταματήσει ο χρήστης». `targetPlayer`
  // επιλέγει ΠΟΙΟΝ ήχο θα παίξει (η ανάθεση έχει δικό της, ξεχωριστό από το μήνυμα
  // κέντρου / νέα παραγγελία).
  function startAlarm(autoStopMs, targetPlayer = player) {
    clearAlarmTimers();
    Vibration.vibrate([0, 600, 400], true); // επαναλαμβανόμενη δόνηση
    try {
      if (targetPlayer) {
        // LOOP ΜΟΝΟ όπου χρειάζεται πραγματικά: στο μήνυμα κέντρου (autoStopMs = 0),
        // που πρέπει να επιμένει μέχρι το «ΟΚ». Η ανάθεση έχει αρχείο 20" και
        // παράθυρο 20", άρα το loop δεν πρόσθετε τίποτα — πρόσθετε όμως ρίσκο: αν
        // το χρονόμετρο χανόταν ή μετατίθετο (δεύτερο startAlarm στο 19ο δευτ.),
        // ο ήχος δεν είχε τίποτα να τον σταματήσει και «βαρούσε» ασταμάτητα.
        // Χωρίς loop, μία ανάγνωση του αρχείου είναι φυσικό όριο.
        targetPlayer.loop = autoStopMs === 0;
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

  // ── Ανακοινώσεις μεταξύ διανομέων ──────────────────────────────────────────
  // Ο πελάτης το ζήτησε ρητά «όπως το απλό μήνυμα της διαγραφής παραγγελίας»:
  // ΜΙΑ φορά ο ήχος των μηνυμάτων, τίποτα που να επιμένει. Ο 20δευτερος
  // συναγερμός και το loop του μηνύματος κέντρου είναι για «σταμάτα ό,τι κάνεις» —
  // ένα «πάω για βενζίνη» δεν είναι αυτό, και αν χτυπούσε έτσι θα σταματούσαν
  // όλοι οι διανομείς στον δρόμο για μια πληροφορία.
  function playColleagueChime() {
    Vibration.vibrate([0, 400, 200, 400]); // μία φορά — ΟΧΙ repeat
    try {
      if (colleaguePlayer) {
        colleaguePlayer.loop = false;
        colleaguePlayer.volume = 1.0;
        colleaguePlayer.seekTo(0);
        colleaguePlayer.play();
      }
    } catch (e) { console.log('Audio Error:', e); }
  }

  /**
   * Μία είσοδος για τις δύο διαδρομές (Realtime broadcast + FCM push). Κόβει
   * διπλότυπα και αγνοεί ό,τι έστειλε ο ίδιος ο διανομέας.
   *
   * `alreadySounded`: ΤΟ ΑΝΤΙΣΤΟΙΧΟ ΤΟΥ pushAlreadySoundedIds ΤΗΣ ΑΝΑΘΕΣΗΣ.
   * Με την εφαρμογή εκτός προσκηνίου τον ήχο τον παίζει το ίδιο το Android από
   * το κανάλι messages_urgent_v1, εντελώς έξω από το expo-audio. Αν ο διανομέας
   * πατήσει αμέσως την ειδοποίηση, η εφαρμογή γίνεται 'active' ΕΝΩ ο ήχος του
   * λειτουργικού παίζει ακόμα — και ένας δεύτερος από εδώ θα έπεφτε πάνω του.
   * Αυτό ακριβώς ήταν το διπλό χτύπημα που ανέφερε ο πελάτης στις αναθέσεις
   * (30/07/2026), γι' αυτό το κριτήριο δεν είναι μόνο το AppState.
   */
  function receiveDriverBroadcast(raw, alreadySounded = false) {
    if (!raw || !raw.message) return;
    if (raw.sender_id && String(raw.sender_id) === String(currentUser.id)) return;

    const id = String(raw.id || `${raw.sender_name}-${raw.sent_at}`);
    if (seenBroadcastIds.current.has(id)) return;
    seenBroadcastIds.current.add(id);
    // Το Set δεν αδειάζει μόνο του και η εφαρμογή ζει όλη τη βάρδια: κρατάμε τα
    // τελευταία 50 ids, όσα χρειάζονται για το dedup των δύο διαδρομών.
    if (seenBroadcastIds.current.size > 50) {
      seenBroadcastIds.current.delete(seenBroadcastIds.current.values().next().value);
    }

    setDriverBroadcasts((queue) => [...queue, {
      id,
      sender: raw.sender_name || 'Συνάδελφος',
      message: String(raw.message),
      // Αν λείψει η ώρα αποστολής, η ώρα λήψης είναι πρακτικά η ίδια (το push
      // ταξιδεύει σε δευτερόλεπτα) — καλύτερα από κενό πεδίο.
      sentAt: raw.sent_at || new Date().toISOString(),
    }]);

    if (!alreadySounded && AppState.currentState === 'active') playColleagueChime();
  }

  /**
   * Αποστολή ανακοίνωσης προς τους υπόλοιπους. ΔΥΟ διαδρομές επίτηδες:
   *   • Realtime broadcast → φτάνει ακαριαία σε όποιον έχει ανοιχτή την εφαρμογή.
   *   • Edge function (FCM) → φτάνει με κλειδωμένη/κλειστή οθόνη, δηλαδή στην
   *     κανονική περίπτωση ενός διανομέα που οδηγεί.
   * Καμία από τις δύο δεν γράφει γραμμή σε πίνακα: το μήνυμα δεν αποθηκεύεται.
   */
  async function sendDriverBroadcast(text) {
    const message = String(text || '').trim();
    if (!message) return { liveOk: false, pushed: 0, pushError: null };

    const payload = {
      // Το ίδιο id ταξιδεύει και στις δύο διαδρομές — από αυτό αναγνωρίζει ο
      // παραλήπτης ότι πρόκειται για την ΙΔΙΑ ανακοίνωση.
      id: `${currentUser.id}-${Date.now()}`,
      sender_id: currentUser.id,
      sender_name: currentUser.full_name,
      message,
      sent_at: new Date().toISOString(),
    };

    let liveOk = false;
    try {
      const ch = broadcastChannel.current;
      if (ch) {
        const res = await ch.send({ type: 'broadcast', event: 'driver_message', payload });
        liveOk = res === 'ok';
      }
    } catch (e) {
      console.log('Broadcast (realtime) error:', e);
    }

    let pushed = 0;
    let pushError = null;
    try {
      const { data, error } = await supabase.functions.invoke('send-driver-broadcast', {
        body: { broadcastId: payload.id, message, sentAt: payload.sent_at },
      });
      if (error) pushError = error;
      else pushed = Number(data?.sent) || 0;
    } catch (e) {
      pushError = e;
    }
    if (pushError) console.log('Broadcast (push) error:', pushError);

    return { liveOk, pushed, pushError };
  }

  // ── Κόκκινη κουκκίδα ανακοινώσεων ─────────────────────────────────────────
  // Οι ανακοινώσεις ΔΕΝ στέλνουν push (απόφαση 03/08/2026), οπότε η μόνη
  // ένδειξη είναι αυτός ο μετρητής. Ερώτημα HEAD (κατεβάζει μόνο το πλήθος),
  // μία φορά στο άνοιγμα και μετά σε κάθε κλείσιμο της οθόνης ανακοινώσεων.
  async function refreshAnnouncementBadge() {
    try {
      const lastRead = await getLastReadAt();
      let q = supabase.from('announcements')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);
      if (lastRead) q = q.gt('created_at', lastRead);
      const { count } = await q;
      setUnreadAnnouncements(count || 0);
    } catch (e) {
      console.log('Announcements badge error:', e);
    }
  }

  useEffect(() => { refreshAnnouncementBadge(); }, []);

  async function fetchOrders() {
    setRefreshing(true);
    try {
      // Η διεύθυνση του καταστήματος μπαίνει στην κάρτα, στη γραμμή της παράδοσης
      // («Κοντοπούλου 4 → διεύθυνση πελάτη»): ο διανομέας θέλει να ξέρει ΑΠΟ ΠΟΥ
      // παραλαμβάνει, όχι μόνο το όνομα. Είναι ΚΑΘΑΡΑ ΓΙΑ ΤΑ ΜΑΤΙΑ — η πλοήγηση
      // πάει πάντα στον πελάτη, οπότε οι συντεταγμένες του καταστήματος δεν
      // χρειάζονται εδώ (βλ. openNavigation).
      const { data: storesList } = await supabase.from('stores').select('id, name, phone, address');
      const storesMap = {};
      if (storesList) storesList.forEach(s => {
        storesMap[s.id] = { name: s.name, phone: s.phone, address: s.address };
      });

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
      // Δύο δρόμοι να θεωρηθεί «νέα»:
      //   • ήρθε ως push όσο ήμασταν κλειστοί (assignedByPushIds) — ισχύει ΚΑΙ στο
      //     πρώτο fetch, γι' αυτό ελέγχεται έξω από το knownMyOrderIds guard·
      //   • εμφανίστηκε στη λίστα ενώ η εφαρμογή ήταν ήδη ανοιχτή.
      const fresh = mineMapped.filter((o) => {
        if (selfAcceptedIds.current.has(o.id)) return false;
        if (assignedByPushIds.current.has(String(o.id))) return true;
        return knownMyOrderIds.current !== null && !knownMyOrderIds.current.has(o.id);
      });

      // ΚΑΤΑΝΑΛΩΝΕΤΑΙ ΠΑΝΤΑ, ακόμα κι όταν δεν βρέθηκε τίποτα νέο: αν το
      // κρατούσαμε μέχρι να υπάρξει `fresh`, θα έμενε αναμμένο και θα έπνιγε
      // έναν επόμενο, γνήσιο συναγερμό ώρες αργότερα.
      const justResumed = suppressAlarmOnNextFetch.current;
      suppressAlarmOnNextFetch.current = false;

      if (fresh.length > 0) {
        // ΜΙΑ ΦΟΡΑ Ο ΗΧΟΣ. Τρεις διαδρομές, ηχεί ΜΟΝΟ η πρώτη:
        //   • push με την εφαρμογή ΜΠΡΟΣΤΑ → ο handler το σιώπησε → ηχεί ο in-app
        //   • tap στην ειδοποίηση          → ήταν ορατή, ήχησε    → σιωπή
        //   • άνοιγμα από το εικονίδιο     → ήχησε όσο λείπαμε    → σιωπή
        // Η οπτική ειδοποίηση (setAssignmentAlert) μπαίνει ΠΑΝΤΑ — αλλιώς ο
        // διανομέας δεν θα ήξερε ποια παραγγελία του ανατέθηκε.
        const announcedByOs =
          justResumed || fresh.some(o => pushAlreadySoundedIds.current.has(String(o.id)));

        fresh.forEach(o => {
          assignedByPushIds.current.delete(String(o.id));
          pushAlreadySoundedIds.current.delete(String(o.id));
        });
        setAssignmentAlert(fresh[0]);
        if (!announcedByOs) startAlarm(ASSIGNMENT_ALARM_MS, alarmPlayer);
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

  // Τα τρία νούμερα του πλαισίου «σήμερα». Δύο ερωτήματα παράλληλα, μία φορά το
  // λεπτό — φτηνά και τα δύο (το πρώτο είναι HEAD request, κατεβάζει μόνο το
  // πλήθος· το δεύτερο 4 στήλες από ελάχιστες γραμμές).
  async function fetchTodayStats() {
    try {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);

      const [completed, shifts] = await Promise.all([
        supabase.from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('driver_id', currentUser.id)
          .eq('status', 'completed')
          .gte('completed_at', dayStart.toISOString()),
        // ΧΩΡΙΣ φίλτρο ημερομηνίας εδώ: ποιο κομμάτι κάθε βάρδιας πέφτει μέσα στο
        // σημερινό 24ωρο το κρίνει το todayShiftTotals — μια βάρδια μπορεί να
        // ξεκίνησε χθες βράδυ και να τρέχει ακόμα. Οι 30 τελευταίες τις καλύπτουν
        // άνετα: η βάρδια κλείνει μετά από 30' σιωπής, οπότε ούτε με προβληματικό
        // GPS δεν βγαίνουν τόσες σε μία μέρα.
        supabase.from('driver_shifts')
          .select('started_at, ended_at, last_ping_at, distance_m')
          .eq('driver_id', currentUser.id)
          .order('started_at', { ascending: false })
          .limit(30),
      ]);

      setTodayCompleted(completed.count || 0);
      setTodayShifts(shifts.data || []);
    } catch (e) {
      console.log("Stats Error:", e);
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
        // Χωρίς αυτό ο μετρητής «Σύνολο σήμερα» θα άργαγε ως ένα λεπτό να ανέβει
        // — ακριβώς τη στιγμή που ο διανομέας κοιτάζει αν μέτρησε η παράδοση.
        fetchTodayStats();
      }
    });
    setConfirmModalVisible(true);
  }

  async function handleDriverLogout() {
    // Καθάρισμα σε ΟΛΑ τα backends (όχι μόνο στο ενεργό) ώστε να σταματήσουν
    // οι ειδοποιήσεις παραγγελιών από οποιοδήποτε σύστημα.
    await clearDriverPresenceEverywhere(currentUser.id);
    await supabase.removeAllChannels(); // FORCE KILL ALL LISTENERS
    // hardSignOut: σβήνει ΚΑΙ τα tokens του native service (αλλιώς θα «ανάσταιναν»
    // τη σύνδεση στο επόμενο άνοιγμα) ΚΑΙ το τοπικό session, ακόμη κι αν το
    // αίτημα προς τον server αποτύχει λόγω δικτύου.
    await hardSignOut({ global: true });
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

  // Άνοιγμα πλοήγησης προς τη διεύθυνση της παραγγελίας — πάντα τον πελάτη,
  // πριν και μετά την παραλαβή (βλ. navTarget στο renderOrderItem).
  //
  // ΣΥΝΤΕΤΑΓΜΕΝΕΣ ΠΡΩΤΑ (30/07/2026). Πριν, στέλναμε ΜΟΝΟ κείμενο και το Google
  // Maps το γεωκωδικοποιούσε από την αρχή — αγνοώντας το σημείο που είχε ήδη
  // υπολογίσει η εφαρμογή και πάνω στο οποίο ΧΡΕΩΘΗΚΕ η παραγγελία. Δύο συνέπειες:
  //   • ο διανομέας μπορούσε να οδηγηθεί αλλού από εκεί που μετρήθηκε η απόσταση
  //   • διευθύνσεις-καταστήματα («Coffee Train, 7ης Νοεμβρίου») δεν βρίσκονταν
  //     καθόλου, γιατί ως ελεύθερο κείμενο δεν αντιστοιχούν σε διεύθυνση
  // Με συντεταγμένες η πλοήγηση δείχνει ΑΚΡΙΒΩΣ το σημείο της χρέωσης.
  // Το κείμενο μένει ως fallback για παλιές παραγγελίες χωρίς lat/lon.
  const openNavigation = (destination, lat, lon) => {
    const hasCoords = typeof lat === 'number' && typeof lon === 'number';
    setConfirmConfig({
      title: 'Πλοήγηση',
      message: `Έναρξη πλοήγησης προς τον πελάτη:\n${destination}`,
      confirmLabel: 'Πλοήγηση',
      onConfirm: () => {
        setConfirmModalVisible(false);
        const url = hasCoords
          ? Platform.select({
              ios: `maps:0,0?q=${encodeURIComponent(destination)}@${lat},${lon}`,
              android: `google.navigation:q=${lat},${lon}`,
            })
          : Platform.select({
              ios: `maps:0,0?q=${encodeURIComponent(`${destination}, ${city}, Ελλάδα`)}`,
              android: `google.navigation:q=${encodeURIComponent(`${destination}, ${city}, Ελλάδα`)}`,
            });
        Linking.openURL(url);
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

    const pickedUp = !!item.picked_up_at;

    // Η ΠΛΟΗΓΗΣΗ ΠΑΕΙ ΠΑΝΤΑ ΣΤΟΝ ΠΕΛΑΤΗ (απόφαση πελάτη 08/08/2026).
    //
    // Παλιά ήταν `!pickedUp && !!store_address ? κατάστημα : πελάτης`, δηλαδή
    // πριν την παραλαβή πλοηγούσε στο μαγαζί. Στην πράξη δεν ενεργοποιήθηκε
    // ποτέ, γιατί το `stores.address` ήταν κενό σε ΟΛΑ τα καταστήματα — και
    // μόλις αρχίσουμε να το συμπληρώνουμε (για να φαίνεται στην κάρτα) η
    // πλοήγηση θα άλλαζε προορισμό από μόνη της, χωρίς να το ζητήσει κανείς.
    // Ο διανομέας ξέρει πού είναι τα μαγαζιά· αυτό που θέλει από το κουμπί
    // είναι η διεύθυνση της παραγγελίας. Άρα ο προορισμός ΔΕΝ εξαρτάται πια
    // από το αν έχει καταχωρηθεί διεύθυνση καταστήματος.
    const navTarget = item.address;
    const navLat = item.latitude;
    const navLon = item.longitude;

    // Χρώματα χρόνου: Πράσινο μέχρι 9 λεπτά, Κόκκινο από 10 και πάνω. Ολοκληρωμένες πάντα πράσινες.
    // Πλέον ΔΕΝ εξαρτώνται από το θέμα — η κάρτα είναι άσπρη και στα δύο.
    const isWarning = !isCompleted && !isScheduled && mins > 9;
    const timeColor = isWarning ? CardColors.warnText : CardColors.okText;
    const timeBgColor = isWarning ? CardColors.warnBg : CardColors.okBg;

    const remainingMs = item.scheduled_at ? new Date(item.scheduled_at) - now : 0;
    const km = formatKm(item.distance_km);

    // Στρογγυλό κουμπί ενέργειας (τηλέφωνο / πλοήγηση) όπως στο mockup. Μίκρυνε
    // από 38 σε 34 όταν όλα μπήκαν σε μία γραμμή — αλλιώς η σειρά ψήλωνε άσκοπα.
    const roundBtn = { width: 34, height: 34, borderRadius: 17, backgroundColor: CardColors.iconBg, alignItems: 'center', justifyContent: 'center' };

    return (
      <View style={[styles.orderCard, isScheduled && { opacity: 0.92, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB' }]}>
        {/* ── ΠΑΡΑΛΑΒΗ: όνομα καταστήματος ──
            Η διεύθυνση του καταστήματος ΔΕΝ είναι πια εδώ (κάτω από το όνομα):
            μετακινήθηκε στη γραμμή της παράδοσης ως «κατάστημα → πελάτης»
            (αίτημα πελάτη 08/08/2026), ώστε το «από πού» και το «πού» να
            διαβάζονται μαζί χωρίς η κάρτα να ψηλώνει κατά μία σειρά. */}
        {/* ΟΛΑ ΣΕ ΜΙΑ ΓΡΑΜΜΗ (αίτημα πελάτη 02/08/2026): τηλέφωνο κολλητά στο
            όνομα, πλοήγηση + χρόνος μαζί δεξιά. Πριν, τα δύο κουμπιά και ο χρόνος
            ήταν δύο ξεχωριστές σειρές δεξιά και ψήλωναν την κάρτα.
            Η πλοήγηση δοκιμάστηκε και στο κέντρο (space-between) αλλά έμοιαζε
            ξεκάρφωτη — χωρίς γείτονα δεν διαβαζόταν ως ομάδα. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: CardColors.divider, paddingBottom: 12 }}>
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* Αύξων αριθμός θέσης μέσα στη λίστα */}
              <View style={{ minWidth: 24, height: 24, borderRadius: 8, backgroundColor: CardColors.numberBg, alignItems: 'center', justifyContent: 'center', marginRight: 9, paddingHorizontal: 5 }}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: CardColors.numberText }}>{displayNumber}</Text>
              </View>
              <Text style={{ fontWeight: '900', fontSize: 18, color: CardColors.text, flexShrink: 1, letterSpacing: 0.2 }} numberOfLines={1}>
                <Ionicons name="storefront-outline" size={17} color={CardColors.gold} /> {item.store_name}
              </Text>
              {item.store_phone ? (
                <TouchableOpacity
                  onPress={() => handleCall(item.store_phone, item.store_name)}
                  style={[roundBtn, { marginLeft: 8 }]}
                  accessibilityLabel="Κλήση καταστήματος"
                >
                  <Feather name="phone-call" size={16} color={CardColors.icon} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {!isScheduled && (
              <TouchableOpacity
                onPress={() => openNavigation(navTarget, navLat, navLon)}
                style={roundBtn}
                accessibilityLabel="Πλοήγηση"
              >
                <Feather name="navigation" size={16} color={CardColors.icon} />
              </TouchableOpacity>
            )}

            <View style={{ backgroundColor: isScheduled ? CardColors.chipBg : timeBgColor, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 10 }}>
              <Text style={{ color: isScheduled ? CardColors.chipText : timeColor, fontWeight: '900', fontSize: 13 }}>
                {isScheduled
                  ? formatCountdown(remainingMs)
                  : isCompleted
                    ? `${totalMins} λ.`
                    : `${mins} λ.`}
              </Text>
            </View>
          </View>
        </View>

        {/* ── ΠΑΡΑΔΟΣΗ ──
            Η ετικέτα και οι μικρές πληροφορίες (τρόπος πληρωμής / απόσταση /
            ΠΑΡΕΛΗΦΘΗ) μοιράζονται ΤΗΝ ΙΔΙΑ γραμμή — αίτημα πελάτη 31/07/2026:
            έτσι η κάρτα χαμηλώνει κατά μία ολόκληρη σειρά και χωράνε
            περισσότερες παραγγελίες στην οθόνη. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
          <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: CardColors.faint }}>ΠΑΡΑΔΟΣΗ</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, flexShrink: 1 }}>
            {item.payment_method ? (
              <View style={{
                backgroundColor: item.payment_method === 'cash' ? CardColors.okBg : CardColors.cardBg,
                paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7,
              }}>
                <Text style={{ fontWeight: '900', color: item.payment_method === 'cash' ? CardColors.okText : CardColors.cardText, fontSize: 9, letterSpacing: 0.5 }}>
                  {item.payment_method === 'cash' ? 'ΜΕΤΡΗΤΑ' : 'ΚΑΡΤΑ'}
                </Text>
              </View>
            ) : null}
            {km ? (
              <View style={{ backgroundColor: CardColors.chipBg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}>
                <Feather name="map-pin" size={10} color={CardColors.chipText} />
                <Text style={{ fontWeight: '900', color: CardColors.chipText, fontSize: 10, marginLeft: 3 }}>{km}</Text>
              </View>
            ) : null}
            {pickedUp && !isCompleted ? (
              <View style={{ backgroundColor: CardColors.okBg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ fontWeight: '900', color: CardColors.okText, fontSize: 10 }}>ΠΑΡΕΛΗΦΘΗ</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Διεύθυνση καταστήματος σε ΔΙΚΗ ΤΗΣ, μικρή/ξεθωριασμένη γραμμή, χωρίς «→»
            (αίτημα πελάτη 08/08/2026 — το μονογραμμο layout της ίδιας μέρας βγήκε
            ακόμα πιο συμπυκνωμένο). Η διεύθυνση παράδοσης μένει η κύρια, μεγάλη
            πληροφορία της κάρτας. Καταστήματα χωρίς καταχωρημένη διεύθυνση: δεν
            εμφανίζεται καθόλου η πρώτη γραμμή. */}
        {item.store_address ? (
          <Text style={{ fontSize: 12, fontWeight: '700', color: CardColors.muted, marginBottom: 2 }}>
            <Feather name="map-pin" size={11} color={CardColors.muted} />{' '}
            {item.store_address}
          </Text>
        ) : null}
        <Text style={[styles.orderAddress, { color: CardColors.text, fontSize: 18, marginBottom: 0 }]}>
          <Feather name="map-pin" size={15} color={CardColors.text} />{' '}
          {item.address}
        </Text>

        {item.comments ? (
          <View style={{ marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: CardColors.chipBg }}>
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1.2, color: CardColors.faint, marginBottom: 4 }}>
              <Feather name="message-square" size={10} color={CardColors.faint} /> ΣΧΟΛΙΑ
            </Text>
            <Text style={{ fontSize: 14, color: CardColors.muted }}>{item.comments}</Text>
          </View>
        ) : null}

        {/* Προγραμματισμένη: μόνο ενημέρωση, δεν γίνεται αποδοχή πριν την ώρα της */}
        {isScheduled && (
          <View style={{ marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: CardColors.chipBg }}>
            <Text style={{ fontSize: 13, color: CardColors.muted, textAlign: 'center' }}>
              <Feather name="clock" size={12} color={CardColors.muted} /> Θα σταλεί σε {formatCountdown(remainingMs)}
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
          <Text style={{ color: CardColors.muted, fontSize: 13, marginTop: 12, fontStyle: 'italic', borderTopWidth: 1, borderTopColor: CardColors.divider, paddingTop: 10 }}>
            <Feather name="clock" size={12} color={CardColors.muted} /> Συνολικά: {totalMins} λ. (Ενεργή: {activeMins} λ. | Αποδεκτή: {acceptedMins} λ.)
          </Text>
        )}
      </View>
    );
  };

  // ── Καρτέλα ΕΝΕΡΓΕΣ / ΑΠΟΔΕΚΤΕΣ ────────────────────────────────────────────
  // Η ενεργή έχει GRADIENT, όχι επίπεδο χρώμα (mockup πελάτη): μια χρυσή λάμψη
  // από πάνω αριστερά που σβήνει διαγώνια, μέσα στο ίδιο χρυσό περίγραμμα.
  //
  // ΓΙΑΤΙ ΕΠΙΤΡΕΠΕΤΑΙ ΜΕ OTA: το expo-linear-gradient είναι native module, αλλά
  // μπήκε στο package.json στις 19/06/2026 ενώ το τελευταίο production build
  // τελείωσε 31/07/2026 — άρα το autolinking το έχει ήδη περάσει στο APK
  // (expo.modules.lineargradient.LinearGradientModule). Δεν χρειάζεται νέο build.
  function renderTab(key, icon, label, direction) {
    const on = activeTab === key;
    const row = { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, paddingHorizontal: 8, borderRadius: 12 };
    const inner = (
      <>
        {/* Ίδιος λόγος με το tabTextActiveDriver: μαύρο εικονίδιο στο φωτεινό
            θέμα, χρυσό μένει μόνο στο σκούρο — αλλιώς θα «χανόταν» δίπλα σε
            μαύρο κείμενο πάνω στο ίδιο χρυσό gradient περίγραμμα. */}
        <Feather name={icon} size={15} color={on ? (isDarkMode ? theme.accent : theme.text) : theme.subtitle} />
        <Text style={[styles.tabText, { fontSize: 13, fontWeight: '600' }, on && styles.tabTextActiveDriver]}>{label}</Text>
      </>
    );

    // Το περίγραμμα του επιλεγμένου tab δεν είναι ομοιόμορφο: μένει συμπαγές στην
    // «έξω» πλευρά (μακριά από το άλλο tab) και σβήνει σταδιακά προς την πλευρά
    // του άλλου tab — τεχνική από το σημείο αναφοράς του πελάτη (31/07/2026).
    // Υλοποιείται με ΔΥΟ εμφωλευμένα LinearGradient: το εξωτερικό ζωγραφίζει το
    // gradient περίγραμμα, το εσωτερικό (μικρότερο κατά 1px γύρω-γύρω μέσω του
    // padding) καλύπτει τα πάντα εκτός από αυτόν τον λεπτό δακτύλιο.
    const solidBorder = isDarkMode ? 'rgba(212,168,83,0.5)' : 'rgba(197,160,102,0.5)';
    const fadeBorder = isDarkMode ? 'rgba(212,168,83,0)' : 'rgba(197,160,102,0)';
    const borderColors = direction === 'right' ? [fadeBorder, solidBorder] : [solidBorder, fadeBorder];

    return (
      <TouchableOpacity key={key} style={{ flex: 1 }} activeOpacity={0.85} onPress={() => setActiveTab(key)}>
        {on ? (
          <LinearGradient
            colors={borderColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ borderRadius: 13, padding: 1 }}
          >
            <LinearGradient
              colors={isDarkMode
                ? ['rgba(212,168,83,0.24)', 'rgba(212,168,83,0.05)']
                : ['rgba(197,160,102,0.30)', 'rgba(197,160,102,0.06)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[row, { borderRadius: 12 }]}
            >
              {inner}
            </LinearGradient>
          </LinearGradient>
        ) : (
          <View style={row}>{inner}</View>
        )}
      </TouchableOpacity>
    );
  }

  // ── Άδεια λίστα: «σε αναμονή πάνω στον χάρτη» (02/08/2026) ─────────────────
  // Το μήνυμα δεν είναι «δεν έχεις τίποτα» αλλά «είσαι online, το κέντρο σε
  // βλέπει»: αφαιρετικό οδικό δίκτυο που σβήνει προς τις άκρες, με το στίγμα του
  // διανομέα στο κέντρο να εκπέμπει παλμούς.
  //
  // ΥΒΡΙΔΙΟ, και τα δύο κομμάτια περνούν με eas update (χωρίς νέο native build):
  //   • ο χάρτης είναι PNG (πολύπλοκα σχήματα — με Views είχε βγει κακό, βλ.
  //     προηγούμενη απόπειρα)· δύο εκδοχές, γιατί είναι διάφανο και τα χρώματα
  //     είναι καλιμπραρισμένα ανά φόντο (navy vs άσπρη κάρτα)
  //   • οι παλμοί είναι Animated.View — σκέτοι κύκλοι, ό,τι ακριβώς κάνει καλά
  //     το borderRadius, χωρίς να χρειάζεται react-native-svg
  //
  // Επιστρέφει ΣΤΟΙΧΕΙΟ (όχι component) ώστε να μη γίνεται remount σε κάθε render.
  const ILLUSTRATION = 236;
  const PULSE = 45; // ίδια ακτίνα με τον κύκλο-αφετηρία του χάρτη

  // Το κείμενο τίτλου/υπότιτλου διαφέρει σε μήκος ανάμεσα στις δύο καρτέλες
  // (ο υπότιτλος των «Αποδεκτών» είναι αισθητά μακρύτερος) και χωρίς σταθερό
  // ύψος γι' αυτά τα δύο, η κάρτα άλλαζε μέγεθος όταν ο διανομέας πήγαινε από τη
  // μία καρτέλα στην άλλη — αίτημα πελάτη 04/08/2026 να μη «χοροπηδάει».
  const EMPTY_TITLE_H = 44; // 2 γραμμές στα 22 lineHeight
  const EMPTY_SUBTITLE_H = 38; // 2 γραμμές στα 19 lineHeight

  function renderEmptyOrders() {
    const isPending = activeTab === 'pending';

    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28 }}>
        <View style={{
          width: '100%', maxWidth: 380, alignItems: 'center',
          backgroundColor: theme.surface,
          borderRadius: 22, borderWidth: 1, borderColor: theme.border,
          paddingVertical: 32, paddingHorizontal: 20,
        }}>
          <View style={{ width: ILLUSTRATION, height: ILLUSTRATION, maxWidth: '100%', marginBottom: 12 }}>
            <Image
              source={isDarkMode ? emptyOrdersDark : emptyOrdersLight}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />

            {/* Οι παλμοί ΠΑΝΩ από τον χάρτη: από κάτω θα τους έκοβαν τα σκούρα
                τετράγωνα και θα έμοιαζαν σπασμένοι. Το πέρασμα πάνω από την
                καρφίτσα είναι χρυσό-πάνω-σε-χρυσό στο 50%, δηλαδή αόρατο. */}
            {pulses.map((v, i) => (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: (ILLUSTRATION - PULSE) / 2,
                  left: (ILLUSTRATION - PULSE) / 2,
                  width: PULSE, height: PULSE, borderRadius: PULSE / 2,
                  borderWidth: 1.8, borderColor: theme.accent,
                  opacity: v.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.5, 0] }),
                  transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 4.3] }) }],
                }}
              />
            ))}
          </View>

          <View style={{ minHeight: EMPTY_TITLE_H, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '900', color: theme.text, textAlign: 'center', lineHeight: 22 }} numberOfLines={2}>
              {isPending ? 'Δεν υπάρχουν ενεργές παραγγελίες' : 'Δεν έχετε αποδεκτές παραγγελίες'}
            </Text>
          </View>
          <View style={{ minHeight: EMPTY_SUBTITLE_H, justifyContent: 'center', marginTop: 8 }}>
            <Text style={{ fontSize: 13, color: theme.subtitle, textAlign: 'center', lineHeight: 19 }} numberOfLines={2}>
              {isPending
                ? 'Οι νέες παραγγελίες θα εμφανιστούν εδώ'
                : 'Ό,τι αποδεχτείτε ή σας ανατεθεί θα εμφανιστεί εδώ'}
            </Text>
          </View>
        </View>

        {/* Το πλαίσιο «σήμερα» ΚΟΛΛΗΤΑ κάτω από την κάρτα (αίτημα πελάτη
            04/08/2026): πριν ζούσε ΜΟΝΟ σαν ListFooterComponent, που με άδεια
            λίστα σπρωχνόταν στην πραγματική βάση της οθόνης (κάτω από το
            flex:1 του empty state) — εκεί ακριβώς που κρύβονται τα gesture
            κουμπιά πλοήγησης σε τηλέφωνα χωρίς τα κλασικά back/home/recents
            (π.χ. Samsung S23 του διανομέα). Τώρα είναι ΜΕΣΑ στο ίδιο
            κεντραρισμένο group με την κάρτα, άρα ανεβαίνει μαζί της. */}
        <View style={{ width: '100%', maxWidth: 380, marginTop: 12 }}>
          {renderTodayStatsRow()}
        </View>
      </View>
    );
  }

  // Παράγωγα του ρολογιού `now`, όχι state: το «Ενεργός» ανεβαίνει έτσι μόνο του
  // κάθε λεπτό (η FlatList ξαναζωγραφίζει ήδη μέσω του extraData) χωρίς να
  // ξαναρωτήσουμε τη βάση, και μηδενίζει μόλις το `now` περάσει τα μεσάνυχτα.
  const { meters: todayMeters, seconds: todaySeconds } = todayShiftTotals(todayShifts, now);

  // ── Πλαίσιο «σήμερα»: το κλείσιμο της λίστας (σχέδιο πελάτη 02/08/2026) ────
  // ΚΥΛΑΕΙ ΜΑΖΙ ΜΕ ΤΗ ΛΙΣΤΑ και δεν είναι σταθερή μπάρα: μια μόνιμη μπάρα θα
  // έτρωγε ~75px ύψος από τις παραγγελίες — ακριβώς το ύψος που κερδίσαμε με το
  // σφίξιμο της κάρτας (αιτήματα πελάτη 31/07 και 02/08). Με άδεια λίστα
  // εμφανίζεται ούτως ή άλλως στο κάτω μέρος της οθόνης, όπως στο σχέδιο, γιατί
  // το contentContainerStyle έχει flexGrow και το άδειο πλαίσιο τεντώνεται από πάνω.
  //
  // Επιστρέφει ΣΤΟΙΧΕΙΟ (όχι component) — ίδιος λόγος με το renderEmptyOrders.
  //
  // Χωρισμένο σε ΔΥΟ συναρτήσεις: το renderTodayStatsRow() είναι μόνο η γραμμή
  // με τα τρία κουτάκια, χωρίς δικά της περιθώρια — έτσι την ξαναχρησιμοποιεί
  // ΚΑΙ το renderEmptyOrders() (κολλητά κάτω από την κάρτα) ΚΑΙ το
  // renderTodayStats() παρακάτω (ως ListFooterComponent όταν η λίστα έχει
  // παραγγελίες, με τα δικά της περιθώρια λίστας).
  function renderTodayStatsRow() {
    const box = {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: theme.surface, borderRadius: 16,
      borderWidth: 1, borderColor: theme.border,
      paddingVertical: 11, paddingHorizontal: 10,
    };

    const cells = [
      { key: 'orders', icon: <Feather name="clipboard" size={17} color={theme.accent} />, label: 'Σύνολο σήμερα', value: String(todayCompleted) },
      // Και τα τρία εικονίδια από Feather: σε τρία κολλητά κουτάκια, δύο
      // διαφορετικά πάχη γραμμής (Feather 24άρι vs Ionicons 512άρι) φαίνονται.
      { key: 'km', icon: <Feather name="map" size={17} color={theme.accent} />, label: 'Χιλιόμετρα', value: formatShiftKm(todayMeters) },
      { key: 'time', icon: <Feather name="clock" size={17} color={theme.accent} />, label: 'Ενεργός', value: formatShiftClock(todaySeconds) },
    ];

    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {cells.map((c) => (
          <View key={c.key} style={box}>
            {c.icon}
            {/* flexShrink ΚΑΙ numberOfLines: σε στενή οθόνη η «Σύνολο σήμερα»
                κόβεται με αποσιωπητικά αντί να σπρώξει το κουτί εκτός γραμμής. */}
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: theme.subtitle }} numberOfLines={1}>
                {c.label}
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: theme.text, marginTop: 2 }} numberOfLines={1}>
                {c.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  function renderTodayStats() {
    return (
      <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 20 }}>
        {renderTodayStatsRow()}
      </View>
    );
  }


  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomWidth: 0, elevation: 5, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.1, shadowRadius: 5, backgroundColor: theme.background, zIndex: 10 }]}>
        {/* Οι δύο πλευρές έχουν ΙΔΙΟ πλάτος επίτηδες: αλλιώς ο κεντρικός τίτλος
            μετατοπίζεται οπτικά προς τη στενότερη πλευρά και δεν είναι πραγματικά
            «στη μέση» όπως ζητήθηκε. */}
        {/* ΑΡΙΣΤΕΡΑ: hamburger (το dark/light mode μετακόμισε ΜΕΣΑ στο μενού) */}
        <View style={{ width: 110, alignItems: 'flex-start' }}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} accessibilityLabel="Μενού">
            <View style={{ backgroundColor: isDarkMode ? theme.toggleBg : '#F0F0F0', padding: 8, paddingHorizontal: 12, borderRadius: 20 }}>
              <Feather name="menu" size={22} color={isDarkMode ? '#FFF' : '#000'} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ΚΕΝΤΡΟ: ο τίτλος + κουκκίδα στίγματος δεξιά του */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, color: '#C5A066', fontWeight: 'bold', letterSpacing: 1.5 }}>VERTEX DRIVER</Text>
          <Animated.View
            accessibilityLabel={locationOk ? 'Στίγμα ενεργό' : 'Χωρίς στίγμα'}
            style={{
              width: 8, height: 8, borderRadius: 4,
              // Πιο ζωντανό πράσινο εδώ (αίτημα πελάτη 04/08/2026): το ίδιο ακριβώς
              // #22C55E του μενού έμοιαζε ξεθωριασμένο σε αυτή τη μικρή κουκκίδα
              // δίπλα στο χρυσό «VERTEX DRIVER» — η χρυσή γειτονιά «τρώει» τον
              // κορεσμό του πρασίνου. Πιο κορεσμένη απόχρωση για να «τραβάει».
              backgroundColor: locationOk ? '#00E676' : '#EF4444',
              opacity: gpsBlink,
            }}
          />
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

      {/* READ-ONLY-ON-FAILOVER: μπάρα όταν τρέχουμε στο εφεδρικό (standby) */}
      {readOnly && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: isDarkMode ? 'rgba(251,191,36,0.12)' : '#FFFBEB', borderBottomWidth: 1, borderBottomColor: isDarkMode ? 'rgba(251,191,36,0.25)' : '#FDE68A' }}>
          <Feather name="alert-triangle" size={14} color={isDarkMode ? '#FBBF24' : '#B45309'} style={{ marginRight: 6 }} />
          <Text style={{ color: isDarkMode ? '#FBBF24' : '#B45309', fontSize: 12, fontWeight: '700', textAlign: 'center', flexShrink: 1 }}>
            Εφεδρική λειτουργία — προσωρινά μόνο ανάγνωση
          </Text>
        </View>
      )}

      <View style={[styles.tabContainer, { backgroundColor: theme.background, padding: 12, borderBottomWidth: 0 }]}>
        <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderRadius: 16, padding: 4, flex: 1, borderWidth: 1, borderColor: theme.border }}>
          {renderTab('pending', 'clipboard', `ΕΝΕΡΓΕΣ (${pendingOrders.length})`, 'left')}
          {renderTab('my_orders', 'user', `ΑΠΟΔΕΚΤΕΣ (${myOrders.length})`, 'right')}
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
        // flexGrow: 1 ώστε η άδεια κατάσταση να κεντράρεται σε ΟΛΟ το ύψος που
        // περισσεύει (χωρίς αυτό κολλάει στην κορυφή). Με παραγγελίες δεν αλλάζει τίποτα.
        // paddingBottom: client feedback 08/08 — το πλαίσιο «σήμερα» έκρυβε πίσω από
        // το gesture bar σε τηλέφωνα χωρίς κλασικά back/home/recents (Samsung S23).
        // Δεν έχουμε το react-native-safe-area-context (native module, θα χρειαζόταν
        // νέο EAS build) — γενναιόδωρο σταθερό padding αντί για πραγματικό inset,
        // αρκετό να καλύψει τυπικό ύψος gesture bar σε Android.
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Platform.OS === 'android' ? 40 : 24 }}
        ListEmptyComponent={renderEmptyOrders()}
        // Με άδεια λίστα το πλαίσιο «σήμερα» είναι ήδη ΜΕΣΑ στο
        // renderEmptyOrders(), κολλητά κάτω από την κάρτα — αν έμπαινε ΚΑΙ
        // εδώ θα εμφανιζόταν διπλό.
        ListFooterComponent={showingEmpty ? null : renderTodayStats()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { fetchOrders(); fetchTodayStats(); }}
          />
        }
      />

      {/* ── Πλαϊνό μενού ────────────────────────────────────────────────── */}
      <DriverMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        driverName={currentUser.full_name}
        isOnDuty={locationOk}
        lastLocationUpdate={lastLocationUpdate}
        activeScreen={activeScreen}
        unreadAnnouncements={unreadAnnouncements}
        onLogout={() => { setMenuVisible(false); handleDriverLogout(); }}
        onNavigate={(key) => {
          setMenuVisible(false);
          // «Αρχική» δεν ανοίγει οθόνη — κλείνει ό,τι είναι ανοιχτό και αφήνει
          // τον διανομέα στη λίστα με τις ενεργές παραγγελίες (αίτημα πελάτη).
          if (key === 'home') {
            setActiveScreen(null);
            setActiveTab('pending');
            return;
          }
          // ΜΙΚΡΗ ΚΑΘΥΣΤΕΡΗΣΗ, ΟΧΙ ΔΙΑΚΟΣΜΗΤΙΚΗ: στο Android ένα Modal που
          // ανοίγει ΤΗΝ ΩΡΑ που κλείνει άλλο μπορεί να μην εμφανιστεί καθόλου
          // — ο διανομέας θα πατούσε «Διαθεσιμότητα» και δεν θα γινόταν τίποτα.
          // Ο χρόνος ταιριάζει με το κλείσιμο του συρταριού.
          setTimeout(() => setActiveScreen(key), 240);
        }}
      />

      {/* ── Οθόνες μενού ───────────────────────────────────────────────────
          Ένα Modal ανά οθόνη, όχι router: η εφαρμογή δεν έχει react-navigation
          και ένα νέο native dependency θα απαιτούσε build — ενώ όλα αυτά
          πρέπει να φτάσουν στα κινητά με eas update. */}
      <Modal
        visible={activeScreen !== null}
        animationType="slide"
        onRequestClose={() => setActiveScreen(null)}
      >
        {activeScreen === 'history' ? (
          <HistoryScreen currentUser={currentUser} isDarkMode={isDarkMode} onBack={() => setActiveScreen(null)} />
        ) : activeScreen === 'availability' ? (
          <AvailabilityScreen currentUser={currentUser} isDarkMode={isDarkMode} onBack={() => setActiveScreen(null)} />
        ) : activeScreen === 'schedule' ? (
          <MyScheduleScreen currentUser={currentUser} isDarkMode={isDarkMode} onBack={() => setActiveScreen(null)} />
        ) : activeScreen === 'announcements' ? (
          <AnnouncementsScreen
            currentUser={currentUser}
            isDarkMode={isDarkMode}
            onBack={() => setActiveScreen(null)}
            onRead={refreshAnnouncementBadge}
          />
        ) : activeScreen === 'broadcast' ? (
          <DriverBroadcastScreen
            currentUser={currentUser}
            isDarkMode={isDarkMode}
            onBack={() => setActiveScreen(null)}
            onSend={sendDriverBroadcast}
          />
        ) : activeScreen === 'support' ? (
          <SupportScreen currentUser={currentUser} isDarkMode={isDarkMode} onBack={() => setActiveScreen(null)} />
        ) : activeScreen === 'vehicle' ? (
          // Αλλαγή μηχανής στη μέση της βάρδιας (χάλασε το ένα, πήρε το άλλο).
          // Ίδιο component με το φράγμα της εκκίνησης — εδώ όμως με «πίσω».
          <VehicleSelectScreen
            isDarkMode={isDarkMode}
            driverName={currentUser.full_name}
            onBack={() => setActiveScreen(null)}
            onDone={() => setActiveScreen(null)}
          />
        ) : null}
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
            backgroundColor: theme.surface,
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
            <View style={{ backgroundColor: isDarkMode ? theme.toggleBg : '#F4F0EB', padding: 16, borderRadius: 12, marginBottom: 20 }}>
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
            backgroundColor: theme.surface,
            borderRadius: 24,
            padding: 24,
            borderTopWidth: 4,
            borderTopColor: '#EF4444',
            elevation: 10,
          }}>
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: isDarkMode ? '#F0EBE2' : '#1E1A14', marginBottom: 16 }}>
              <Feather name="bell" size={20} /> Νέα ανάθεση παραγγελίας
            </Text>
            <View style={{ backgroundColor: isDarkMode ? theme.toggleBg : '#F4F0EB', padding: 16, borderRadius: 12, marginBottom: 20 }}>
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

      {/* ─── ΑΝΑΚΟΙΝΩΣΗ ΑΠΟ ΣΥΝΑΔΕΛΦΟ ───
          Χωρίς συναγερμό που επιμένει: ο ήχος έχει ήδη παίξει ΜΙΑ φορά. Το
          παράθυρο περιμένει ήσυχα το «ΟΚ» — μπορεί ο διανομέας να οδηγεί.
          Το ΟΝΟΜΑ και η ΩΡΑ είναι το κύριο περιεχόμενο (ρητό αίτημα πελάτη):
          χωρίς αυτά, «πάω για βενζίνη» δεν σημαίνει τίποτα. */}
      <Modal visible={driverBroadcasts.length > 0} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: theme.surface,
            borderRadius: 24,
            padding: 24,
            borderTopWidth: 4,
            borderTopColor: '#38BDF8',
            elevation: 10,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 16 }}>
              <Feather name="radio" size={20} color="#38BDF8" />
              <Text style={{ fontSize: 19, fontWeight: 'bold', color: isDarkMode ? '#F0EBE2' : '#1E1A14', flex: 1 }}>
                Ενημέρωση συναδέλφου
              </Text>
              {/* Πόσες ακόμα περιμένουν πίσω από αυτή — αλλιώς το παράθυρο θα
                  «ξαναεμφανιζόταν» μετά το ΟΚ χωρίς εξήγηση. */}
              {driverBroadcasts.length > 1 ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(56,189,248,0.18)' }}>
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#38BDF8' }}>+{driverBroadcasts.length - 1}</Text>
                </View>
              ) : null}
            </View>

            <View style={{ backgroundColor: isDarkMode ? theme.toggleBg : '#F4F0EB', padding: 16, borderRadius: 12, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Feather name="user" size={13} color={isDarkMode ? '#C5A066' : '#8A7347'} />
                <Text style={{ fontSize: 15, fontWeight: '900', color: isDarkMode ? '#C5A066' : '#8A7347', flexShrink: 1 }}>
                  {driverBroadcasts[0]?.sender}
                </Text>
                <Feather name="clock" size={12} color={theme.subtitle} style={{ marginLeft: 4 }} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.subtitle }}>
                  {formatClockTime(driverBroadcasts[0]?.sentAt)}
                </Text>
              </View>
              <Text style={{ fontSize: 16, lineHeight: 24, color: isDarkMode ? '#F0EBE2' : '#1E1A14' }}>
                {driverBroadcasts[0]?.message}
              </Text>
            </View>

            <TouchableOpacity
              style={{ backgroundColor: '#C5A066', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
              onPress={() => setDriverBroadcasts((queue) => queue.slice(1))}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Το είδα (ΟΚ)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}