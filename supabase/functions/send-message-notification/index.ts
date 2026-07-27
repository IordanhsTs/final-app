// ════════════════════════════════════════════════════════════════════════════
// send-message-notification
//
// Push στους διανομείς όταν ο διαχειριστής στέλνει μήνυμα από το «Κέντρο Ελέγχου».
// Μέχρι τώρα το admin_message ταξίδευε ΜΟΝΟ ως Supabase Realtime broadcast — δούλευε
// μόνο όσο η εφαρμογή ήταν ανοιχτή/συνδεδεμένη. Ο διανομέας συνήθως οδηγεί με το
// κινητό κλειδωμένο, οπότε χρειάζεται πραγματικό OS notification (FCM) για να το
// προσέξει, ίδια λογική με το send-assignment-notification.
//
// Ίδιο μοντέλο κλήσης: απευθείας από τον browser του admin (όχι webhook), με JWT
// admin-only, schema από το ΥΠΟΓΕΓΡΑΜΜΕΝΟ token. Τα καταστήματα ΔΕΝ περνούν από εδώ —
// μένουν πάντα ανοιχτά σε συσκευή στο μαγαζί, οπότε το broadcast + τοπικός ήχος
// (SystemAlertListener) αρκεί γι' αυτά.
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
    if (claims.user_role !== 'admin') return json({ error: 'forbidden' }, 403)

    const schema = typeof claims.tenant === 'string' && claims.tenant ? claims.tenant : 'public'

    const { targetIds, message } = await req.json()
    if (!Array.isArray(targetIds) || targetIds.length === 0 || !message) {
      return json({ error: 'targetIds (array) and message are required' }, 400)
    }

    const db = createClient(supabaseUrl, serviceKey, { db: { schema } })

    let query = db.from('drivers').select('fcm_token').not('fcm_token', 'is', null)
    if (!targetIds.includes('all')) query = query.in('id', targetIds)
    const { data: driversList } = await query
    const tokens = [...new Set((driversList || []).map((d) => d.fcm_token).filter(Boolean))]

    if (tokens.length === 0) return json({ skipped: 'no fcm tokens' }, 200)

    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing')

    const serviceAccount = JSON.parse(serviceAccountJson)
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
    const { access_token } = await jwtClient.authorize()

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
              notification: {
                title: '📢 Μήνυμα από το Κέντρο Ελέγχου',
                body: message,
              },
              data: { kind: 'message' },
              android: {
                priority: 'HIGH',
                ttl: '3600s',
                notification: {
                  channel_id: 'messages_urgent_v1',
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
    console.error('send-message-notification error:', error)
    return json({ error: (error as Error).message }, 500)
  }
})
