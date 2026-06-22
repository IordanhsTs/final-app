import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { JWT } from 'https://esm.sh/google-auth-library@9'

console.log("Hello from send-order-notification!")

serve(async (req) => {
  try {
    // Παίρνουμε το payload από το Webhook
    const payload = await req.json()
    console.log("Webhook payload:", payload)

    // Μας ενδιαφέρουν μόνο τα νέα INSERTs στον πίνακα orders με status 'pending'
    if (payload.type !== 'INSERT' || payload.record.status !== 'pending') {
      return new Response("Not a new pending order, ignoring.", { status: 200 })
    }

    const newOrder = payload.record

    // Δημιουργούμε Supabase Client για να βρούμε τους οδηγούς
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Βρίσκουμε όλους τους διαθέσιμους οδηγούς που έχουν fcm_token
    // (Μπορείς να προσθέσεις επιπλέον φίλτρα εδώ π.χ. eq('status', 'active'))
    const { data: drivers, error: driverError } = await supabase
      .from('drivers')
      .select('fcm_token')
      .not('fcm_token', 'is', null)

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
                  channel_id: "default",
                  sound: "default"
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
