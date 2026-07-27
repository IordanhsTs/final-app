import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { JWT } from 'https://esm.sh/google-auth-library@9'

console.log("Hello from send-order-notification!")

serve(async (req) => {
  try {
    // Παίρνουμε το payload από το Webhook
    const payload = await req.json()
    console.log("Webhook payload:", payload)

    // Μας ενδιαφέρουν: (α) νέα INSERTs με status 'pending' — κανονική παραγγελία,
    // ή (β) UPDATE όπου μια ΚΑΘΥΣΤΕΡΗΜΕΝΗ παραγγελία μόλις απελευθερώθηκε
    // (scheduled → pending, βλ. release_due_orders()). Χωρίς το (β) ο διανομέας
    // μαθαίνει για μια προγραμματισμένη παραγγελία μόνο αν τύχει να έχει ανοιχτή
    // την εφαρμογή τη στιγμή που ενεργοποιείται.
    const isNewPendingOrder = payload.type === 'INSERT' && payload.record?.status === 'pending'
    const isReleasedFromSchedule =
      payload.type === 'UPDATE' &&
      payload.old_record?.status === 'scheduled' &&
      payload.record?.status === 'pending'

    if (!isNewPendingOrder && !isReleasedFromSchedule) {
      return new Response("Not a new/released pending order, ignoring.", { status: 200 })
    }

    const newOrder = payload.record

    // MULTI-TENANT: το webhook payload περιέχει το `schema` του πίνακα που πυροδότησε
    // το trigger (π.χ. 'co_florina'). Ρωτάμε τους οδηγούς ΕΚΕΙΝΗΣ της εταιρίας.
    // Fallback σε 'public' για συμβατότητα με το σημερινό production (πριν το cutover).
    const schema = payload.schema && payload.schema !== 'public' ? payload.schema : 'public'
    console.log('Order schema (tenant):', schema)

    // Δημιουργούμε Supabase Client για να βρούμε τους οδηγούς
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Βρίσκουμε τους διαθέσιμους οδηγούς ΤΗΣ ΕΤΑΙΡΙΑΣ που έχουν fcm_token.
    //
    // HEARTBEAT GATE (last_seen): ειδοποιούμε ΜΟΝΟ οδηγούς που ενημέρωσαν θέση
    // πρόσφατα — δηλαδή είναι όντως ΣΕ ΒΑΡΔΙΑ. Το native GPS service γράφει κάθε
    // 10s, άρα ένα ενεργό κινητό έχει πάντα φρέσκο last_seen. Ένα κλειστό/
    // αποσυνδεδεμένο κινητό (π.χ. έληξε το session και δεν καθαρίστηκε το
    // is_active/fcm_token) σταματά να ενημερώνει → εξαιρείται ΑΥΤΟΜΑΤΑ εδώ, ώστε
    // να ΜΗΝ έρχονται ειδοποιήσεις εκτός βάρδιας. Self-healing: δεν εξαρτάται από
    // το αν πρόλαβε ο client να καθαρίσει την παρουσία του.
    const FRESH_MS = 3 * 60 * 1000 // 3 λεπτά (native interval = 10s → άφθονο περιθώριο)
    const freshSince = new Date(Date.now() - FRESH_MS).toISOString()

    const { data: drivers, error: driverError } = await supabase
      .schema(schema)
      .from('drivers')
      .select('fcm_token')
      .not('fcm_token', 'is', null)
      .eq('is_active', true)
      .eq('is_blocked', false)
      .gt('last_seen', freshSince)

    if (driverError || !drivers || drivers.length === 0) {
      console.log("No drivers with FCM tokens found.")
      return new Response("No drivers found", { status: 200 })
    }

    // Φορτώνουμε το Service Account Key του Firebase από τα μυστικά (Secrets) της Supabase
    // Θα πρέπει να το κάνεις stringify και να το σώσεις ως secret 'FIREBASE_SERVICE_ACCOUNT'
    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    if (!serviceAccountJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing")
    }
    
    const serviceAccount = JSON.parse(serviceAccountJson)
    const projectId = serviceAccount.project_id
    
    console.log("-----------------------------------------")
    console.log("USING FIREBASE PROJECT ID:", projectId)
    console.log("-----------------------------------------")

    // Δημιουργούμε το JWT (Google Auth Token)
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
    const tokens = await jwtClient.authorize()

    const sendPromises = drivers.map(async (driver) => {
      const fcmToken = driver.fcm_token

      // Καλούμε το Firebase Cloud Messaging API v1
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.access_token}`,
          },
          body: JSON.stringify({
            message: {
              token: fcmToken,
              notification: {
                title: '🛵 Νέα Παραγγελία!',
                body: newOrder.address || 'Μια νέα παραγγελία είναι διαθέσιμη',
              },
              data: {
                orderId: String(newOrder.id),
              },
              android: {
                priority: "HIGH",
                ttl: "86400s",
                notification: {
                  channel_id: "orders_urgent_v3",
                  sound: "notification"
                }
              }
            },
          }),
        }
      )

      if (!res.ok) {
        console.error("FCM API error for token", fcmToken, await res.text())
      } else {
        console.log("Push sent successfully to token", fcmToken)
      }
    })

    await Promise.all(sendPromises)

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error("Error processing webhook:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
