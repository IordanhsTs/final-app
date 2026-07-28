// ════════════════════════════════════════════════════════════════════════════
// send-assignment-notification
//
// Push στον ΣΥΓΚΕΚΡΙΜΕΝΟ διανομέα για ό,τι κάνει ο διαχειριστής στη δική του
// παραγγελία. Τέσσερα είδη (`kind`):
//   assign        → του ανατέθηκε παραγγελία            (συναγερμός 20")
//   reassign      → του μετατέθηκε παραγγελία           (συναγερμός 20")
//   reassign_away → του ΠΗΡΑΝ την παραγγελία            (ήχος μηνύματος)
//   cancel        → ακυρώθηκε παραγγελία που είχε δεχτεί (ήχος μηνύματος)
//
// ΓΙΑΤΙ ΞΕΧΩΡΙΣΤΗ FUNCTION και όχι επέκταση της send-order-notification:
// εκείνη τρέφεται από Database Webhook σε INSERT και στέλνει σε ΟΛΟΥΣ τους
// διανομείς σε βάρδια. Η ανάθεση είναι UPDATE και αφορά ΕΝΑΝ. Επίσης εκείνη
// τρέχει χωρίς JWT (καλείται από το webhook)· αυτή καλείται από τον browser του
// admin, άρα ΠΡΕΠΕΙ να ελέγχει ποιος καλεί.
//
// ΓΙΑΤΙ ΚΛΗΣΗ ΑΠΟ ΤΟΝ ADMIN και όχι δεύτερο webhook: το webhook σε UPDATE θα
// πυροδοτούσε σε ΚΑΘΕ αλλαγή της παραγγελίας (παραλαβή, ολοκλήρωση, απελευθέρωση
// προγραμματισμένης) και θα έπρεπε να διακρίνει τη μετάθεση από το payload.old,
// που στη Supabase έρχεται σχεδόν άδειο. Επιπλέον θα απαιτούσε χειροκίνητη
// ρύθμιση στο dashboard ανά περιβάλλον. Η κλήση από τον admin είναι ρητή: ξέρει
// ακριβώς πότε συνέβη ανάθεση/μετάθεση και σε ποιον.
// ════════════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { JWT } from 'https://esm.sh/google-auth-library@9'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ ΠΡΟΣΩΡΙΝΟ — ΝΑ ΓΙΝΕΙ 'assignments_urgent_v3' ΜΟΛΙΣ ΜΠΕΙ ΤΟ ΝΕΟ APK       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// Το App.js δημιουργεί ΗΔΗ το `assignments_urgent_v3` (ήχος 19,4" + δόνηση
// 19,2"), αλλά μόνο στο build που περιμένει ακόμα στην ουρά του EAS. Στα κινητά
// που είναι σήμερα εγκατεστημένα υπάρχει το `_v2` — επιβεβαιωμένο από τον
// πελάτη: στις «Κατηγορίες ειδοποιήσεων» φαίνεται «Αναθέσεις από τον
// διαχειριστή» με «Ήχος από εφαρμογή» και ενεργή δόνηση.
//
// Στέλνοντας `_v3` σε αυτά τα κινητά, το Firebase δεν βρίσκει το κανάλι και
// ρίχνει την ειδοποίηση στο δικό του εφεδρικό «Miscellaneous» με γενικό ήχο —
// ΑΚΡΙΒΩΣ αυτό είδε ο πελάτης, και η κατηγορία «Miscellaneous» εμφανίστηκε στη
// λίστα του ως απόδειξη.
//
// Μέχρι να βγει το build, δείχνουμε στο `_v2`: σωστός ήχος + δόνηση με
// κλειδωμένο κινητό, απλώς 2,16" αντί για 20". Καλύτερο από γενικό μπιπ.
//
// ⚠️ Το νέο APK ΣΒΗΝΕΙ το `_v2` στην πρώτη εκκίνηση. Αν μείνει αυτή η τιμή μετά
// την εγκατάσταση, οι αναθέσεις ξαναπέφτουν στο «Miscellaneous». Η αλλαγή σε
// `_v3` και το deploy πρέπει να γίνουν ΤΗΝ ΙΔΙΑ ΣΤΙΓΜΗ με την εγκατάσταση.
const ASSIGNMENT_CHANNEL = 'assignments_urgent_v2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Τα claims του JWT. Το getUser() έχει ήδη επαληθεύσει την υπογραφή πριν
// φτάσουμε εδώ — απλώς διαβάζουμε το payload.
function readClaims(jwt: string): Record<string, unknown> {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64))
  } catch (_) {
    return {}
  }
}

// ── Ποιος επιτρέπεται να καλέσει ──────────────────────────────────────────────
// ΝΕΟ μονοπάτι (multi-tenant, με auth hook): admin ΜΟΝΟ αν το `user_role` claim το
// λέει ρητά.
//
// ΜΕΤΑΒΑΤΙΚΟ μονοπάτι — ΓΙΑΤΙ ΥΠΑΡΧΕΙ: ο custom_access_token_hook βάζει το
// `user_role` μόνο για χρήστες με εγγραφή στον public.memberships, και στο
// σημερινό production ο πίνακας είναι ΑΔΕΙΟΣ (το cutover δεν έχει γίνει). Άρα
// κανένα JWT δεν είχε ποτέ `user_role` και ΚΑΘΕ κλήση εδώ έπεφτε σε 403 — γι'
// αυτό δεν έφτανε ΠΟΤΕ push ανάθεσης/μετάθεσης στους διανομείς. Πέφτουμε πίσω
// στον ΙΔΙΟ ακριβώς έλεγχο που κάνει ήδη το delivery-admin/src/App.jsx για να
// αφήσει κάποιον να μπει στο panel: ούτε διανομέας ούτε κατάστημα = διαχειριστής.
// Δεν χαλαρώνει τίποτα σε σχέση με σήμερα — είναι το ίδιο κριτήριο με την είσοδο.
// Φεύγει από μόνο του μόλις γίνει το cutover, γιατί τότε υπάρχει πάντα το claim.
async function isAdminCaller(
  db: ReturnType<typeof createClient>,
  claims: Record<string, unknown>,
  email: string | undefined,
): Promise<boolean> {
  if (typeof claims.user_role === 'string') return claims.user_role === 'admin'
  if (!email) return false

  const [{ data: asDriver }, { data: asStore }] = await Promise.all([
    db.from('drivers').select('id').eq('email', email).maybeSingle(),
    db.from('stores').select('id').eq('email', email).maybeSingle(),
  ])
  return !asDriver && !asStore
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Επαλήθευση υπογραφής/λήξης του token.
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: { user }, error: authError } = await authClient.auth.getUser(jwt)
    if (authError || !user) return json({ error: 'unauthorized' }, 401)

    const claims = readClaims(jwt)

    // Το schema έρχεται από το ΥΠΟΓΕΓΡΑΜΜΕΝΟ token, όχι από το body: αλλιώς ένας
    // admin της μιας εταιρίας θα μπορούσε να ρωτήσει τους διανομείς μιας άλλης.
    const schema = typeof claims.tenant === 'string' && claims.tenant ? claims.tenant : 'public'

    const db = createClient(supabaseUrl, serviceKey, { db: { schema } })

    if (!(await isAdminCaller(db, claims, user.email))) return json({ error: 'forbidden' }, 403)

    const { orderId, driverId, kind } = await req.json()
    if (!orderId || !driverId) return json({ error: 'orderId and driverId are required' }, 400)

    const { data: driver } = await db
      .from('drivers')
      .select('fcm_token')
      .eq('id', driverId)
      .maybeSingle()

    if (!driver?.fcm_token) return json({ skipped: 'no fcm token' }, 200)

    const { data: order } = await db
      .from('orders')
      .select('address')
      .eq('id', orderId)
      .maybeSingle()

    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing')

    const serviceAccount = JSON.parse(serviceAccountJson)
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
    const tokens = await jwtClient.authorize()

    const isReassign = kind === 'reassign'
    // Ο διανομέας που ΧΑΝΕΙ την παραγγελία σε μια μετάθεση — δεν έχει σχέση με το
    // order.address σαν body, θέλει να μάθει απλώς ότι δεν είναι πια δική του.
    const isReassignAway = kind === 'reassign_away'
    // Ακύρωση από τον διαχειριστή ΕΝΩ η παραγγελία ήταν ήδη αποδεκτή: ο διανομέας
    // μπορεί να είναι ήδη καθ' οδόν προς το κατάστημα.
    const isCancel = kind === 'cancel'

    // ΠΟΙΟ ΚΑΝΑΛΙ: ο 20δευτερος συναγερμός είναι για «έχεις δουλειά ΤΩΡΑ» — ισχύει
    // μόνο για ανάθεση/μετάθεση ΠΡΟΣ τον διανομέα. Η απώλεια παραγγελίας και η
    // ακύρωση είναι ΠΛΗΡΟΦΟΡΙΑ: πάνε στο κανάλι μηνυμάτων, με τον σύντομο ήχο του.
    // Πρακτικό όφελος: το messages_urgent_v1 υπάρχει ήδη στις εγκατεστημένες
    // συσκευές, οπότε αυτά τα δύο δουλεύουν ΧΩΡΙΣ να περιμένουμε νέο build.
    const isInfo = isReassignAway || isCancel
    const channelId = isInfo ? 'messages_urgent_v1' : ASSIGNMENT_CHANNEL
    const soundName = isInfo ? 'message' : 'assignment'

    let title: string
    let body: string
    if (isCancel) {
      title = '❌ Ακύρωση παραγγελίας'
      body = order?.address
        ? `Ο διαχειριστής ακύρωσε την παραγγελία: ${order.address}`
        : 'Ο διαχειριστής ακύρωσε την παραγγελία σου.'
    } else if (isReassignAway) {
      title = '↩️ Η παραγγελία μεταφέρθηκε'
      body = 'Ο διαχειριστής μετέθεσε την παραγγελία σου σε άλλον διανομέα.'
    } else if (isReassign) {
      title = '🔁 Μετάθεση παραγγελίας'
      body = order?.address || 'Άνοιξε την εφαρμογή για λεπτομέρειες.'
    } else {
      title = '📦 Σου ανατέθηκε παραγγελία'
      body = order?.address || 'Άνοιξε την εφαρμογή για λεπτομέρειες.'
    }

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.access_token}`,
        },
        body: JSON.stringify({
          message: {
            token: driver.fcm_token,
            notification: { title, body },
            data: {
              orderId: String(orderId),
              kind: isCancel
                ? 'cancel'
                : isReassignAway ? 'reassign_away' : (isReassign ? 'reassign' : 'assign'),
            },
            android: {
              priority: 'HIGH',
              ttl: '600s',
              notification: {
                // ΠΡΟΣΟΧΗ: τα channel id ΠΡΕΠΕΙ να είναι ίδια με το App.js. Τα κανάλια
                // είναι αμετάβλητα στο Android μετά την 1η δημιουργία, οπότε κάθε αλλαγή
                // αρχείου ήχου απαιτεί ΝΕΟ id (_v2, _v3, …) — αλλιώς το κινητό κρατά τον
                // παλιό/λάθος ήχο. Άλλαξε ΚΑΙ ΤΑ ΔΥΟ μαζί.
                channel_id: channelId,
                sound: soundName,
              },
            },
          },
        }),
      }
    )

    if (!res.ok) {
      const detail = await res.text()
      console.error('FCM API error:', res.status, detail)

      // Το FCM απαντά UNREGISTERED / INVALID_ARGUMENT όταν το token δεν ισχύει
      // πια — τυπικά μετά από επανεγκατάσταση ή καθαρισμό δεδομένων της
      // εφαρμογής, που παράγει ΝΕΟ token. Το παλιό μένει στη βάση μέχρι ο
      // διανομέας να ξαναμπεί στην εφαρμογή, και κάθε ανάθεση στο μεταξύ σκάει
      // εδώ. Το σβήνουμε ώστε οι επόμενες να μη χτυπάνε στο κενό (και να
      // βγάζουν το σαφές «δεν έχει ενεργές ειδοποιήσεις» αντί για σφάλμα).
      const stale = /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND|registration-token-not-registered/i.test(detail)
      if (stale) {
        await db.from('drivers').update({ fcm_token: null }).eq('id', driverId)
      }

      return json({
        error: 'fcm failed',
        // Ελληνικό, εκτελέσιμο μήνυμα: ο διαχειριστής πρέπει να ξέρει ΤΙ να κάνει,
        // όχι ότι «κάτι απέτυχε».
        reason: stale
          ? 'Το κινητό του διανομέα δεν είναι πλέον καταχωρημένο για ειδοποιήσεις (συμβαίνει μετά από επανεγκατάσταση της εφαρμογής). Πρέπει να ανοίξει την εφαρμογή και να ξανασυνδεθεί μία φορά.'
          : `Το Firebase απέρριψε την ειδοποίηση (κωδικός ${res.status}).`,
        detail,
      }, 502)
    }

    return json({ success: true })
  } catch (error) {
    console.error('send-assignment-notification error:', error)
    return json({ error: (error as Error).message }, 500)
  }
})
