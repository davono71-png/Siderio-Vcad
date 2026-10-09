const DEFAULT_URL = "https://kvsrnxsaajsdmkikipjl.supabase.co";
const DEFAULT_KEY = "sb_publishable_aY24h_Wv7blCramxY9Rngg_F1BSnJvY";

export type SupabasePublicConfig = {
  url: string;
  key: string;
};

/**
 * Public Suite project. An unset variable uses the default. An explicit empty
 * value, or a URL that is not https, closes access.
 */
export function supabasePublicConfig(): SupabasePublicConfig | null {
  const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyEnv = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const url = (urlEnv === undefined ? DEFAULT_URL : urlEnv).trim();
  const key = (keyEnv === undefined ? DEFAULT_KEY : keyEnv).trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url, key };
}
