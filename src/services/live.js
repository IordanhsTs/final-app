// ─── ΖΩΝΤΑΝΗ ΣΥΝΔΕΣΗ ΠΟΥ ΑΥΤΟ-ΕΠΙΔΙΟΡΘΩΝΕΤΑΙ ────────────────────────────────
//
// Το ΠΡΟΒΛΗΜΑ (04/09/2026, εντοπίστηκε πρώτα στα καταστήματα): το websocket του
// realtime πεθαίνει σιωπηλά — παγωμένα timers στο παρασκήνιο (χαμένα heartbeats),
// ληγμένο token, κόψιμο του δικτύου κινητής, αλλαγή wifi↔4G. Κανένα σφάλμα,
// καμία ένδειξη. Και μέχρι σήμερα ΚΑΝΕΝΑ κανάλι δεν ξαναχτιζόταν ποτέ: μια φορά
// νεκρό, έμενε νεκρό μέχρι να ξαναφορτώσει η οθόνη (δηλαδή μέχρι logout/login).
//
// Στο driver app οι περισσότερες ζημιές τις καλύπτει το push (ανεξάρτητος
// δρόμος): παραγγελίες, μηνύματα διαχείρισης, ανακοινώσεις συναδέλφων. Η
// ΕΞΑΙΡΕΣΗ είναι το `driver_status`: απενεργοποίηση/μπλοκάρισμα διανομέα και ο
// κανόνας «μία συσκευή» ταξιδεύουν ΜΟΝΟ από εκεί. Με νεκρό κανάλι, ο
// απενεργοποιημένος διανομέας συνέχιζε να δουλεύει και ο ίδιος λογαριασμός
// έμενε ζωντανός σε δύο κινητά ταυτόχρονα.
//
// Δύο επίπεδα άμυνας — ΧΩΡΙΣ poll δεδομένων (σε κινητό κοστίζει μπαταρία και
// δεδομένα, και η λίστα παραγγελιών έχει ήδη το push από πίσω της):
//   1. onWake      — σε κάθε επιστροφή στο προσκήνιο: φρεσκάρουμε το session και
//                    ελέγχουμε όλα τα κανάλια.
//   2. liveChannel — κάθε κανάλι παρακολουθεί τον εαυτό του και ξαναχτίζεται
//                    μόνο του, με προαιρετικό onResync σε κάθε επανασύνδεση.
//
// ΠΡΟΣΟΧΗ στο `onResync`: ό,τι καταλήγει στο fetchOrders ακουμπά τη λογική του
// 20δευτερου συναγερμού ανάθεσης (βλ. DriverDashboard). Γι' αυτό το κανάλι των
// παραγγελιών ΔΕΝ έχει onResync — ξαναχτίζεται, αλλά δεν ξαναδιαβάζει μόνο του.

import { AppState } from 'react-native';
import { supabase } from '../../supabase';

// Το AppState χτυπά και σε στιγμιαία εναλλαγή εφαρμογών (π.χ. άνοιγμα του χάρτη
// πλοήγησης και επιστροφή) — δεν θέλουμε καταιγίδα από ελέγχους.
const WAKE_THROTTLE_MS = 3000;
// Πόσο περιμένουμε πριν ξαναχτίσουμε ένα κανάλι που έπεσε. Σε κινητό δίκτυο μια
// στιγμιαία διακοπή είναι ο κανόνας, όχι η εξαίρεση — δεν βιαζόμαστε.
const REBUILD_DELAY_MS = 5000;
// Περιοδικός έλεγχος υγείας. Δεν αγγίζει δίκτυο: κοιτά μόνο την κατάσταση του
// socket, οπότε δεν κοστίζει ούτε μπαταρία ούτε δεδομένα.
const WATCHDOG_MS = 30000;

const wakeListeners = new Set();
let lastWake = 0;
let wired = false;

async function fireWake(force = false) {
  const now = Date.now();
  if (!force && now - lastWake < WAKE_THROTTLE_MS) return;
  lastWake = now;

  // Το token μπορεί να έχει λήξει όσο η εφαρμογή ήταν στο παρασκήνιο. Χωρίς
  // φρέσκο token το realtime απορρίπτεται στο join (το getSession κάνει μόνο του
  // refresh, και ο adapter υιοθετεί τα tokens του native service αν είναι νεότερα).
  try {
    await supabase.auth.getSession();
  } catch (_) {
    // Χωρίς δίκτυο δεν μαθαίνουμε τίποτα — συνεχίζουμε στον έλεγχο καναλιών.
  }

  wakeListeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {
      // Ένας ακροατής που σκάει δεν ακυρώνει τους υπόλοιπους.
    }
  });
}

function wire() {
  if (wired) return;
  wired = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') fireWake();
  });
}

/** Δηλώνει κάτι που πρέπει να ξαναελεγχθεί μόλις έρθει η εφαρμογή μπροστά. */
export function onWake(fn) {
  wire();
  wakeListeners.add(fn);
  return () => {
    wakeListeners.delete(fn);
  };
}

/** Χειροκίνητο ξύπνημα. */
export function forceWake() {
  fireWake(true);
}

/**
 * Realtime κανάλι που επιβιώνει από πεσμένο δίκτυο, ληγμένο token και παγωμένο
 * παρασκήνιο. Επιστρέφει τη συνάρτηση καθαρισμού.
 *
 * @param {object}   opts
 * @param {string}   opts.name       Όνομα καναλιού (topic).
 * @param {function} opts.bind       Δηλώνει τα `.on(...)`. Καλείται ΞΑΝΑ σε κάθε
 *                                   επαναχτίσιμο — αν κρατάς αναφορά στο κανάλι
 *                                   (π.χ. για broadcast send), ανανέωσέ την εδώ.
 * @param {function} [opts.onResync] Καλείται σε κάθε επιτυχή (επανα)σύνδεση.
 * @param {boolean}  [opts.unique]   Προεπιλογή true: μοναδικό suffix στο όνομα.
 *                                   ΠΡΟΣΟΧΗ: για broadcast πρέπει να είναι false —
 *                                   εκεί το όνομα είναι η διεύθυνση και πρέπει να
 *                                   ταιριάζει με τον αποστολέα/παραλήπτη.
 */
export function liveChannel({ name, bind, onResync, unique = true }) {
  let disposed = false;
  let generation = 0;
  let current = null;
  let healthy = false;
  let rebuildTimer = null;

  const clearRebuild = () => {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
  };

  const build = async () => {
    if (disposed) return;
    clearRebuild();

    // Ο μετρητής γενιάς ακυρώνει τα callbacks του παλιού καναλιού: το κλείσιμό του
    // πυροδοτεί CLOSED και χωρίς αυτόν θα ζητούσε αμέσως νέο επαναχτίσιμο.
    const gen = ++generation;
    const previous = current;
    current = null;
    healthy = false;

    if (previous) {
      try {
        await supabase.removeChannel(previous);
      } catch (_) {
        // Ήδη κλειστό — προχωράμε στο νέο κανάλι.
      }
      if (disposed || gen !== generation) return;
    }

    const topic = unique
      ? `${name}_${gen}_${Math.random().toString(36).slice(2, 8)}`
      : name;

    current = bind(supabase.channel(topic)).subscribe((status) => {
      if (disposed || gen !== generation) return;
      if (status === 'SUBSCRIBED') {
        healthy = true;
        if (onResync) onResync();
      } else {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED
        healthy = false;
        scheduleRebuild();
      }
    });
  };

  const scheduleRebuild = () => {
    if (disposed || rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      build();
    }, REBUILD_DELAY_MS);
  };

  /**
   * Υγιές = και το κανάλι μπήκε, και το από κάτω websocket ζει. Ο δεύτερος έλεγχος
   * πιάνει και το failover: μετά από αλλαγή backend ο client είναι άλλος και τα
   * παλιά κανάλια ανήκουν σε νεκρό socket χωρίς να το πει κανείς.
   */
  const check = () => {
    if (disposed) return;
    let socketAlive = true;
    try {
      socketAlive = supabase.realtime.isConnected();
    } catch (_) {
      // Άγνωστη κατάσταση socket — κρίνουμε μόνο από το healthy.
    }
    if (!healthy || !socketAlive) build();
  };

  build();
  const offWake = onWake(check);
  const watchdog = setInterval(check, WATCHDOG_MS);

  return () => {
    disposed = true;
    offWake();
    clearInterval(watchdog);
    clearRebuild();
    if (current) {
      try {
        supabase.removeChannel(current);
      } catch (_) {
        // Στο unmount δεν έχει νόημα να ασχοληθούμε με αποτυχία κλεισίματος.
      }
    }
    current = null;
  };
}

/**
 * Τυλίγει ένα onResync ώστε να αγνοεί την ΠΡΩΤΗ σύνδεση: εκεί τα αρχικά ερωτήματα
 * της οθόνης μόλις έχουν τρέξει και δεν έχει νόημα να ξαναγίνουν.
 */
export function skipFirst(fn) {
  let first = true;
  return (...args) => {
    if (first) {
      first = false;
      return;
    }
    fn(...args);
  };
}
