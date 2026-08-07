// ════════════════════════════════════════════════════════════════════════════
// send-driver-broadcast
//
// Ανακοίνωση ΑΠΟ διανομέα ΠΡΟΣ τους υπόλοιπους διανομείς σε βάρδια
// («έπαθα λάστιχο», «πάω για βενζίνη»). ΔΕΝ είναι συνομιλία: ένα μήνυμα φεύγει,
// οι άλλοι το βλέπουν, πατάνε ΟΚ, τέλος.
//
// ΤΙΠΟΤΑ ΔΕΝ ΑΠΟΘΗΚΕΥΕΤΑΙ (ρητό αίτημα πελάτη 08/08/2026): δεν υπάρχει πίνακας,
// δεν γράφεται γραμμή πουθενά. Το κείμενο ζει μόνο μέσα στο FCM payload και στο
// Realtime broadcast που στέλνει παράλληλα η ίδια η εφαρμογή. Μόλις το δουν οι
// παραλήπτες, δεν υπάρχει πια.
//
// ΓΙΑΤΙ ΞΕΧΩΡΙΣΤΗ FUNCTION και όχι επέκταση της send-message-notification:
// εκείνη είναι admin-only (ο έλεγχος `isAdminCaller` απορρίπτει ρητά όποιον
// βρεθεί στον πίνακα drivers) και δέχεται λίστα παραληπτών από τον καλούντα.
// Εδώ ισχύει το αντίστροφο: καλεί ΔΙΑΝΟΜΕΑΣ, και τους παραλήπτες τους διαλέγει
// ο server — ο διανομέας δεν επιλέγει σε ποιον θα στείλει.
//
// ΤΟ ΟΝΟΜΑ ΤΟΥ ΑΠΟΣΤΟΛΕΑ ΔΕΝ ΕΡΧΕΤΑΙ ΑΠΟ ΤΟ BODY. Διαβάζεται από τη βάση με
// βάση το υπογεγραμμένο JWT, ώστε να μη μπορεί κανείς να στείλει ανακοίνωση
// στο όνομα άλλου.
//
// ΚΑΝΑΛΙ/ΗΧΟΣ: `messages_urgent_v1` + `message.wav` — το ίδιο που ακούει ήδη ο
// διανομέας στην ακύρωση παραγγελίας. ΥΠΑΡΧΕΙ ΗΔΗ σε κάθε εγκατεστημένη συσκευή,
// άρα η λειτουργία δεν χρειάζεται νέο build (τα κανάλια είναι αμετάβλητα στο
// Android — βλ. App.js).
// ════════════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { JWT } from 'https://esm.sh/google-auth-library@9'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Ίδιο με το channel id στο App.js. Αλλαγή ήχου ⇒ ΝΕΟ id ΚΑΙ στα δύο σημεία.
const MESSAGE_CHANNEL = 'messages_urgent_v1'

// Όσο χωράει σε μια ειδοποίηση κλειδωμένης οθόνης χωρίς να κοπεί άσχημα. Η
// εφαρμογή κόβει ήδη στο ίδιο όριο· εδώ είναι το φράγμα για ό,τι δεν πέρασε
// από εκεί.
const MAX_LEN = 200

// Πόσο «φρέσκος» πρέπει να είναι ο διανομέας για να θεωρείται σε βάρδια. Το
// native GPS service γράφει κάθε 10", άρα 3 λεπτά είναι άφθονο περιθώριο. Ίδιο
// κριτήριο με τη send-order-notification: όποιος σταμάτησε να στέλνει στίγμα
// εξαιρείται ΑΥΤΟΜΑΤΑ, χωρίς να εξαρτόμαστε από καθάρισμα του is_active.
const FRESH_MS = 3 * 60 * 1000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function readClaims(jwt: string): Record<string, unknown> {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64))
  } catch (_) {
    return {}
  }
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

    const authClient = createClient(supabaseUrl, anonKey)
    const { data: { user }, error: authError } = await authClient.auth.getUser(jwt)
    if (authError || !user) return json({ error: 'unauthorized' }, 401)

    const claims = readClaims(jwt)
    // Το schema από το ΥΠΟΓΕΓΡΑΜΜΕΝΟ token, ποτέ από το body: αλλιώς ένας
    // διανομέας θα μπορούσε να «φωνάξει» στους διανομείς άλλης εταιρίας.
    const schema = typeof claims.tenant === 'string' && claims.tenant ? claims.tenant : 'public'

    const db = createClient(supabaseUrl, serviceKey, { db: { schema } })

    // ── Ο αποστολέας ΠΡΕΠΕΙ να είναι διανομέας σε βάρδια ──────────────────────
    const { data: sender } = await db
      .from('drivers')
      .select('id, full_name, is_active, is_blocked')
      .eq('id', user.id)
      .maybeSingle()

    if (!sender || sender.is_blocked) return json({ error: 'forbidden' }, 403)
    if (!sender.is_active) {
      return json({ error: 'not_on_shift', reason: 'Η ανακοίνωση στέλνεται μόνο κατά τη διάρκεια της βάρδιας.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const message = String(body?.message ?? '').trim().slice(0, MAX_LEN)
    if (!message) return json({ error: 'message is required' }, 400)

    // Το ίδιο id ταξιδεύει και στο Realtime broadcast που στέλνει η εφαρμογή,
    // ώστε ο παραλήπτης να αναγνωρίζει ότι είναι Η ΙΔΙΑ ανακοίνωση και να μην
    // τη δείξει (και την ηχήσει) δύο φορές.
    const broadcastId = String(body?.broadcastId ?? `${sender.id}-${Date.now()}`)
    const sentAt = String(body?.sentAt ?? new Date().toISOString())

    // ── Οι παραλήπτες: όλοι οι ΑΛΛΟΙ διανομείς σε βάρδια ─────────────────────
    const freshSince = new Date(Date.now() - FRESH_MS).toISOString()
    const { data: recipients } = await db
      .from('drivers')
      .select('fcm_token')
      .not('fcm_token', 'is', null)
      .eq('is_active', true)
      .eq('is_blocked', false)
      .gt('last_seen', freshSince)
      .neq('id', sender.id)

    const tokens = [...new Set((recipients || []).map((d) => d.fcm_token).filter(Boolean))]
    if (tokens.length === 0) return json({ success: true, sent: 0, failed: 0, skipped: 'no drivers on shift' })

    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing')

    const serviceAccount = JSON.parse(serviceAccountJson)
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
    const { access_token } = await jwtClient.authorize()

    const senderName = sender.full_name || 'Συνάδελφος'

    const results = await Promise.all(tokens.map((token) =>
      fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access_token}`,
          },
          body: JSON.stringify({
            message: {
              token,
              // Ο τίτλος είναι ΤΟ ΟΝΟΜΑ: στην κλειδωμένη οθόνη ο διανομέας πρέπει
              // να δει με μια ματιά ποιος μιλάει, χωρίς να ανοίξει τίποτα.
              notification: { title: `📣 ${senderName}`, body: message },
              // Όλα τα πεδία και ως data: από εδώ τα διαβάζει η εφαρμογή για να
              // στήσει το in-app παράθυρο (όνομα + ώρα) όταν είναι ανοιχτή.
              data: {
                kind: 'driver_broadcast',
                broadcastId,
                senderId: String(sender.id),
                sender: senderName,
                message,
                sentAt,
              },
              android: {
                priority: 'HIGH',
                // Μια ανακοίνωση βάρδιας δεν έχει νόημα μισή ώρα μετά — ο
                // διανομέας έχει ήδη αλλάξει λάστιχο. Δεν την κρατάμε στην ουρά.
                ttl: '600s',
                notification: {
                  channel_id: MESSAGE_CHANNEL,
                  sound: 'message',
                },
              },
            },
          }),
        }
      ).catch((e) => { console.error('FCM fetch error:', e); return { ok: false } as Response })
    ))

    const failed = results.filter((r) => !r.ok).length
    return json({ success: true, sent: tokens.length - failed, failed })
  } catch (error) {
    console.error('send-driver-broadcast error:', error)
    return json({ error: (error as Error).message }, 500)
  }
})
