import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const runtimeOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
export const authRedirectBase = (import.meta.env.VITE_AUTH_REDIRECT_URL ?? runtimeOrigin).replace(/\/+$/, "");

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl ?? "https://replace-me.supabase.co",
  supabaseAnonKey ?? "replace-me-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
