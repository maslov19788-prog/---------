import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://unbxmmloqcujphsslaba.supabase.co';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mdMJhzdlsINAXniuorrivg_W-JDCV8O';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);