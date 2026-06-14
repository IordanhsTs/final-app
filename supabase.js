import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://kjzfxvhbdnancxswswft.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqemZ4dmhiZG5hbmN4c3dzd2Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MzEwMzcsImV4cCI6MjA5NjUwNzAzN30.YWjAoxfhYdglGKVSbgnwEBfBmVTBView-QF_AH3p-5Q';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);