import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Αρχικοποίηση του Admin Supabase Client (παρακάμπτει τα RLS)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();

    // 1. Φέρνουμε όλους τους ενεργούς διανομείς που έχουν push token
    const { data: drivers, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('expo_push_token')
      .eq('is_active', true) // Μόνο σε όσους είναι σε βάρδια
      .not('expo_push_token', 'is', null);

    if (driverError) throw driverError;
    if (!drivers || drivers.length === 0) {
      return new Response(JSON.stringify({ message: "No active drivers with tokens found." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      });
    }

    // 2. Ετοιμάζουμε τα μηνύματα για αποστολή
    const pushMessages = drivers.map(driver => ({
      to: driver.expo_push_token,
      sound: 'default',
      title: '🛵 Νέα Παραγγελία!',
      body: message,
      priority: 'high',
      channelId: 'default', // Σημαντικό για το Android
    }));

    // 3. Στέλνουμε τις ειδοποιήσεις μαζικά στο Expo
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify(pushMessages),
    });

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});