const env = window.__ENV__ || {};
const SUPABASE_URL =
  env.NEXT_PUBLIC_SUPABASE_URL || "https://daagxzibbrkxjoysofld.supabase.co";
const SUPABASE_ANON_KEY =
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_o5p-SouDtXE38V-li6bJsw_5rX9mV_q";

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


