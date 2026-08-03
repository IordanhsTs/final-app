import AsyncStorage from '@react-native-async-storage/async-storage';

// ── «Τι έχω ήδη διαβάσει» — τοπικά, όχι στη βάση ────────────────────────────
// Οι ανακοινώσεις δεν στέλνουν push (απόφαση 03/08/2026): η μόνη ένδειξη είναι
// η κόκκινη κουκκίδα στο μενού. Γι' αυτό αρκεί ΜΙΑ χρονοσφραγίδα ανά συσκευή —
// ένας πίνακας `announcement_reads` θα πρόσθετε γραφή στη βάση σε κάθε άνοιγμα
// οθόνης για να απαντήσει την ίδια ερώτηση. Το κόστος του τοπικού: μετά από
// επανεγκατάσταση όλες φαίνονται αδιάβαστες, που είναι το ασφαλές λάθος.

const KEY = 'vertex-announcements-read-at';

export async function getLastReadAt() {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch (_) {
    return null;
  }
}

export async function markAnnouncementsRead(when = new Date()) {
  try {
    await AsyncStorage.setItem(KEY, when.toISOString());
  } catch (_) {}
}
