import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// force-dynamic on the page ensures Next.js doesn't cache Supabase reads
export const supabase = createClient(url, anon, {
  global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
});
