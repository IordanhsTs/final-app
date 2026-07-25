// ── Χρόνοι & απόσταση παραγγελίας ───────────────────────────────────────────
// Ίδιοι κανόνες με delivery-admin/src/distance.js και store-web-app/lib/distance.ts.
// Τα τρία apps είναι ξεχωριστά repos χωρίς κοινό package, οπότε η μικρή pure
// λογική αντιγράφεται. ΑΝ ΑΛΛΑΞΕΙ, άλλαξέ την και στα άλλα δύο.

/** «3,4 χλμ» — ελληνικό δεκαδικό κόμμα, 1 δεκαδικό. */
export function formatKm(distanceKm) {
  const n = Number(distanceKm);
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(n)) return null;
  return `${n.toFixed(1).replace('.', ',')} χλμ`;
}

/** «3:41» — υπόλοιπο μέχρι να σταλεί μια προγραμματισμένη παραγγελία. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Διάρκειες μιας παραγγελίας σε λεπτά: πόση ώρα ήταν «ενεργή» (μέχρι να την πάρει
 * διανομέας) και πόση είναι «αποδεκτή» (από την αποδοχή και μετά).
 *
 * ΤΟ Math.max(0, …) ΔΙΟΡΘΩΝΕΙ ΤΟ «-1»: το `created_at` το γράφει ο Postgres, ενώ
 * το `accepted_at` το στέλνει το ρολόι του κινητού. Αν το κινητό πάει λίγα
 * δευτερόλεπτα πίσω, η διαφορά βγαίνει αρνητική και το Math.floor(-0,5) έδινε -1
 * την πρώτη στιγμή μετά την αποδοχή. Τώρα ο μετρητής ξεκινά πάντα από 0.
 */
export function orderDurations(order, now = new Date()) {
  const created = order.created_at ? new Date(order.created_at) : null;
  const accepted = order.accepted_at ? new Date(order.accepted_at) : null;
  const ended = order.completed_at ? new Date(order.completed_at) : null;
  if (!created) return { activeMins: 0, acceptedMins: 0, totalMins: 0 };

  const activeEnd = accepted || ended || now;
  const activeMins = Math.max(0, Math.floor((activeEnd - created) / 60000));
  const acceptedMins = accepted
    ? Math.max(0, Math.floor(((ended || now) - accepted) / 60000))
    : 0;

  return { activeMins, acceptedMins, totalMins: activeMins + acceptedMins };
}

/** Λεπτά από τη δημιουργία της παραγγελίας — ποτέ αρνητικά (βλ. παραπάνω). */
export function minutesSinceCreated(order, now = new Date()) {
  if (!order.created_at) return 0;
  return Math.max(0, Math.floor((now - new Date(order.created_at)) / 60000));
}
