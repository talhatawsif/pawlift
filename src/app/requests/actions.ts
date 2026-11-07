"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requestError } from "@/lib/requests";

export type ClaimState = { error?: string } | undefined;

export async function claimLeg(_: ClaimState, form: FormData): Promise<ClaimState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_leg", {
    p_leg_id: String(form.get("leg_id") ?? ""),
    p_idempotency_key: String(form.get("key") ?? ""),
    p_journey_id: null as unknown as string,
  });
  if (error || !data) return { error: requestError(error, "We couldn't reserve that. Please try again.") };
  redirect(`/assignments/${data}?claimed=1`);
}
