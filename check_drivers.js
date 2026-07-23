const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://kjzfxvhbdnancxswswft.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqemZ4dmhiZG5hbmN4c3dzd2Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MzEwMzcsImV4cCI6MjA5NjUwNzAzN30.YWjAoxfhYdglGKVSbgnwEBfBmVTBView-QF_AH3p-5Q';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDrivers() {
  const { data, error } = await supabase.from('drivers').select('id, email, is_active, fcm_token');
  console.log(data);
}

checkDrivers();
