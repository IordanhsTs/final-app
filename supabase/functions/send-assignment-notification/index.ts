// ════════════════════════════════════════════════════════════════════════════
// send-assignment-notification
//
// Push στον ΣΥΓΚΕΚΡΙΜΕΝΟ διανομέα όταν ο διαχειριστής του αναθέτει ή του
// μεταθέτει παραγγελία.
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
    if (claims.user_role !== 'admin') return json({ error: 'forbidden' }, 403)

    // Το schema έρχεται από το ΥΠΟΓΕΓΡΑΜΜΕΝΟ token, όχι από το body: αλλιώς ένας
    // admin της μιας εταιρίας θα μπορούσε να ρωτήσει τους διανομείς μιας άλλης.
    const schema = typeof claims.tenant === 'string' && claims.tenant ? claims.tenant : 'public'

    const { orderId, driverId, kind } = await req.json()
    if (!orderId || !driverId) return json({ error: 'orderId and driverId are required' }, 400)

    const db = createClient(supabaseUrl, serviceKey, { db: { schema } })

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
            notification: {
              title: isReassignAway
                ? '↩️ Η παραγγελία μεταφέρθηκε'
                : isReassign ? '🔁 Μετάθεση παραγγελίας' : '📦 Σου ανατέθηκε παραγγελία',
              body: isReassignAway
                ? 'Δεν είναι πλέον δική σου — αναλαμβάνει άλλος διανομέας.'
                : (order?.address || 'Άνοιξε την εφαρμογή για λεπτομέρειες.'),
            },
            data: {
              orderId: String(orderId),
              kind: isReassignAway ? 'reassign_away' : (isReassign ? 'reassign' : 'assign'),
            },
            android: {
              priority: 'HIGH',
              ttl: '600s',
              notification: {
                channel_id: 'assignments_urgent_v1',
                sound: 'alarm',
              },
            },
          },
        }),
      }
    )

    if (!res.ok) {
      const detail = await res.text()
      console.error('FCM API error:', detail)
      return json({ error: 'fcm failed', detail }, 502)
    }

    return json({ success: true })
  } catch (error) {
    console.error('send-assignment-notification error:', error)
    return json({ error: (error as Error).message }, 500)
  }
})
