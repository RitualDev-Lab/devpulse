import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://udgiyoakgxremqeviwng.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_oGnWgyQqq-0v1Tot0JpUdw_sUyj_XqO"
  );
}
