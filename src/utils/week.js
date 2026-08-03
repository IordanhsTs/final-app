// ── Εβδομάδα Δευτέρα → Κυριακή ───────────────────────────────────────────────
// Η μονάδα όλου του προγράμματος: ο πελάτης μαζεύει δηλώσεις μέσα στην εβδομάδα
// και βγάζει πρόγραμμα για την επόμενη. Ίδιες συμβάσεις με το FuelReport του
// admin και με το migration 0014 (week_start = η Δευτέρα).

export const GREEK_DAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];
export const GREEK_DAYS_SHORT = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];

// Γενική πτώση: «3 – 9 Αυγούστου», όχι «3 – 9 Αύγουστος».
const GREEK_MONTHS_GEN = [
  'Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
  'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου',
];

/** Η Δευτέρα της εβδομάδας στην οποία ανήκει η ημερομηνία (τοπική ώρα). */
export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay(): 0 = Κυριακή
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Τοπική ημερομηνία ως YYYY-MM-DD. ΠΟΤΕ toISOString(): αυτό μετατρέπει σε UTC
 * και τα μεσάνυχτα θερινής ώρας θα γύριζαν την προηγούμενη μέρα — δηλαδή η
 * δήλωση θα έμπαινε σε λάθος ημέρα.
 */
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Οι επτά ημερομηνίες της εβδομάδας, Δευτέρα → Κυριακή. */
export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** «3 – 9 Αυγούστου», ή «30 Ιουλίου – 5 Αυγούστου» όταν η εβδομάδα αλλάζει μήνα. */
export function formatWeekRange(monday) {
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()} – ${sunday.getDate()} ${GREEK_MONTHS_GEN[sunday.getMonth()]}`;
  }
  return `${monday.getDate()} ${GREEK_MONTHS_GEN[monday.getMonth()]} – ${sunday.getDate()} ${GREEK_MONTHS_GEN[sunday.getMonth()]}`;
}

/** «4 Αυγούστου» — για τις κάρτες ημέρας και τις ανακοινώσεις. */
export function formatDay(d) {
  return `${d.getDate()} ${GREEK_MONTHS_GEN[d.getMonth()]}`;
}

/** «09:00» από «09:00:00» (η Postgres επιστρέφει δευτερόλεπτα) ή από Date. */
export function hhmm(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 5);
}

/** «09:00» → Date σημερινής ημέρας με αυτή την ώρα (για τον time picker). */
export function timeToDate(text) {
  const [h, m] = String(text || '00:00').split(':');
  const d = new Date();
  d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return d;
}

/**
 * Διάρκεια διαστήματος σε ώρες. ΝΥΧΤΕΡΙΝΟ: όταν η ώρα λήξης δεν είναι μετά την
 * ώρα έναρξης (17:00 → 01:00) το διάστημα περνά τα μεσάνυχτα και προσθέτουμε
 * 24 ώρες — αλλιώς θα έβγαινε αρνητικό και ο διανομέας θα έβλεπε «-16 ώρες».
 */
export function spanHours(start, end) {
  const toMin = (t) => {
    const [h, m] = String(t).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const a = toMin(start);
  const b = toMin(end);
  const diff = b > a ? b - a : b + 24 * 60 - a;
  return diff / 60;
}

/** true όταν το διάστημα τελειώνει την επόμενη ημέρα (δείχνουμε «+1» δίπλα). */
export function crossesMidnight(start, end) {
  return spanHours(start, end) > 0 && String(end) <= String(start);
}

/** «8 ώρες» / «7,5 ώρες» — χωρίς περιττό δεκαδικό. */
export function formatHours(h) {
  const rounded = Math.round(h * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${text} ${rounded === 1 ? 'ώρα' : 'ώρες'}`;
}
