"use server";

import { createClient } from "@/lib/supabase/server";

export type SuburbOption = { id: string; name: string; postcode: string; lat: number; lng: number };

/** Public suburb search for the manual location fallback. Works signed out. */
export async function searchSuburbs(query: string): Promise<{ items: SuburbOption[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await (
    supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: SuburbOption[] | null; error: unknown }>
  )("list_public_suburbs", { p_query: query.slice(0, 40) });
  if (error) return { items: [], error: "Suburbs couldn't be loaded. Try again." };
  return { items: data ?? [] };
}
