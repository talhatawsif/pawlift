"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { requestError, type RequestDetail } from "@/lib/requests";
import { isoToMelbourneLocal, melbourneLocalToIso } from "@/lib/time/melbourne";

export type RequestState = { error?: string; ok?: boolean } | undefined;

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const MAX_UPLOAD = 6 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function fields(form: FormData) {
  const start = melbourneLocalToIso(s(form, "window_start"));
  const end = melbourneLocalToIso(s(form, "window_end"));
  const deadlineRaw = s(form, "deadline");
  const deadline = deadlineRaw ? melbourneLocalToIso(deadlineRaw) : null;
  if (!start || !end) return { error: "Enter the pickup window start and end." } as const;
  if (deadlineRaw && !deadline) return { error: "Enter a valid delivery deadline." } as const;
  return {
    start, end,
    common: {
      p_animal_name: s(form, "animal_name"),
      p_species: s(form, "species"),
      p_urgency: s(form, "urgency"),
      p_required_date: isoToMelbourneLocal(start).slice(0, 10),
      // Generated RPC types make optional args non-null; the database accepts null.
      p_deadline: deadline as string,
      p_handling: s(form, "handling_requirements"),
      p_carrier: s(form, "carrier_requirements"),
      p_medical_notes: s(form, "medical_notes"),
      p_coordinator_instructions: s(form, "coordinator_instructions"),
      p_origin_location_id: s(form, "origin_location_id"),
      p_destination_location_id: s(form, "destination_location_id"),
      p_window_start: start,
      p_window_end: end,
    },
  } as const;
}

export async function createRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const f = fields(form);
  if ("error" in f) return { error: f.error };
  const orgId = s(form, "org_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_request", { p_org_id: orgId, ...f.common });
  if (error || !data) return { error: requestError(error, "We couldn't save that. Please try again.") };
  revalidatePath(`/org/${orgId}/requests`);
  redirect(`/org/${orgId}/requests/${data}`);
}

export async function updateRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const f = fields(form);
  if ("error" in f) return { error: f.error };
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_request", {
    p_request_id: requestId,
    p_expected_version: Number(s(form, "version")),
    ...f.common,
  });
  if (error) return { error: requestError(error, "We couldn't save that. Please try again.") };
  revalidatePath(`/org/${orgId}/requests/${requestId}`);
  return { ok: true };
}

async function getDetail(requestId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_request_for_coordinator", { p_request_id: requestId });
  return { supabase, detail: error ? null : (data as unknown as RequestDetail) };
}

/** Re-encode server-side: honour EXIF rotation, then drop all metadata (incl. GPS), resize, WebP. */
async function sanitise(file: File): Promise<Buffer | string> {
  if (!ALLOWED.has(file.type)) return "Use a JPEG, PNG or WebP photo.";
  if (file.size > MAX_UPLOAD) return "That photo is over 6 MB. Choose a smaller one.";
  try {
    const out = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return out.length > 1_000_000 ? "That photo is too detailed to shrink enough. Try another." : out;
  } catch {
    return "We couldn't read that photo. Try a different file.";
  }
}

export async function uploadPhoto(_: RequestState, form: FormData): Promise<RequestState> {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  const { supabase, detail } = await getDetail(requestId);
  if (!detail) return { error: "You don't have permission to do that." };
  if (detail.status !== "draft") return { error: "Photos can only be changed before publishing." };
  const image = await sanitise(file);
  if (typeof image === "string") return { error: image };

  const path = `${detail.org_id}/${randomUUID()}.webp`;
  const up = await supabase.storage.from("request-photos").upload(path, image, { contentType: "image/webp" });
  if (up.error) return { error: "We couldn't upload that photo. Please try again." };
  const { error } = await supabase.rpc("set_request_photo", { p_request_id: requestId, p_path: path });
  if (error) {
    await supabase.storage.from("request-photos").remove([path]);
    return { error: requestError(error, "We couldn't attach that photo.") };
  }
  if (detail.photo_path) await supabase.storage.from("request-photos").remove([detail.photo_path]);
  revalidatePath(`/org/${orgId}/requests/${requestId}`);
  return { ok: true };
}

export async function removePhoto(form: FormData) {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const { supabase, detail } = await getDetail(requestId);
  if (!detail || detail.status !== "draft" || !detail.photo_path) return;
  const { error } = await supabase.rpc("set_request_photo", { p_request_id: requestId, p_path: null as unknown as string });
  if (!error) await supabase.storage.from("request-photos").remove([detail.photo_path]);
  revalidatePath(`/org/${orgId}/requests/${requestId}`);
}

export async function publishRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const { supabase, detail } = await getDetail(requestId);
  if (!detail) return { error: "You don't have permission to do that." };
  const { error } = await supabase.rpc("publish_request", {
    p_request_id: requestId,
    p_attest: s(form, "attest") === "on",
  });
  if (error) return { error: requestError(error, "We couldn't publish that. Please try again.") };

  // The photo becomes public only now that the request is published.
  let note = "";
  if (detail.photo_path) {
    const blob = await supabase.storage.from("request-photos").download(detail.photo_path);
    const copy = blob.data
      ? await supabase.storage.from("animal-photos").upload(detail.photo_path, blob.data, { contentType: "image/webp" })
      : { error: blob.error };
    if (copy.error) note = "Published, but the photo could not be shown publicly.";
  }
  revalidatePath(`/org/${orgId}/requests/${requestId}`);
  revalidatePath(`/org/${orgId}/requests`);
  revalidatePath("/requests");
  return { ok: true, error: note || undefined };
}

export async function cancelRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_request", { p_request_id: requestId, p_reason: s(form, "reason") });
  if (error) return { error: requestError(error, "We couldn't cancel that. Please try again.") };
  revalidatePath(`/org/${orgId}/requests/${requestId}`);
  revalidatePath(`/org/${orgId}/requests`);
  revalidatePath("/requests");
  return { ok: true };
}

// ---- leg editor (5a)
const legDone = (orgId: string, requestId: string) => {
  revalidatePath(`/org/${orgId}/requests/${requestId}`);
  revalidatePath(`/org/${orgId}/requests`);
  revalidatePath("/requests");
};

export async function splitLeg(_: RequestState, form: FormData): Promise<RequestState> {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const firstEnd = melbourneLocalToIso(s(form, "first_end"));
  const secondStart = melbourneLocalToIso(s(form, "second_start"));
  if (!firstEnd || !secondStart) return { error: "Enter when the first driver arrives and the next driver leaves." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("split_leg", {
    p_request_id: requestId,
    p_expected_version: Number(s(form, "version")),
    p_seq: Number(s(form, "seq")),
    p_handover_location_id: s(form, "handover_location_id"),
    p_first_end: firstEnd,
    p_second_start: secondStart,
  });
  if (error) return { error: requestError(error, "We couldn't split that leg. Please try again.") };
  legDone(orgId, requestId);
  return { ok: true };
}

export async function mergeLegs(_: RequestState, form: FormData): Promise<RequestState> {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_legs", {
    p_request_id: requestId,
    p_expected_version: Number(s(form, "version")),
    p_seq: Number(s(form, "seq")),
  });
  if (error) return { error: requestError(error, "We couldn't merge those legs. Please try again.") };
  legDone(orgId, requestId);
  return { ok: true };
}

export async function updateLeg(_: RequestState, form: FormData): Promise<RequestState> {
  const orgId = s(form, "org_id");
  const requestId = s(form, "request_id");
  const start = melbourneLocalToIso(s(form, "window_start"));
  const end = melbourneLocalToIso(s(form, "window_end"));
  if (!start || !end) return { error: "Enter the leg's start and end." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_leg", {
    p_request_id: requestId,
    p_expected_version: Number(s(form, "version")),
    p_seq: Number(s(form, "seq")),
    p_window_start: start,
    p_window_end: end,
    // Generated RPC types make optional args non-null; the database accepts null.
    p_to_location_id: (s(form, "to_location_id") || null) as string,
  });
  if (error) return { error: requestError(error, "We couldn't save that leg. Please try again.") };
  legDone(orgId, requestId);
  return { ok: true };
}
