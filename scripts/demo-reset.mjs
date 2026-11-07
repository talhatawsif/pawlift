// Reseeds DEMO data (PLAN §11). Service-role script: never imported from src/.
// Refuses unless APP_ENV=demo and the Supabase project ref is in DEMO_PROJECT_REFS.
// Deletes only is_demo rows and @demo.pawlift.invalid users, then reseeds. Safe to run repeatedly.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
const ref = url ? new URL(url).hostname.split(".")[0] : "";
const allowed = (process.env.DEMO_PROJECT_REFS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (process.env.APP_ENV !== "demo" || !ref || !allowed.includes(ref) || !key || !password) {
  console.error("demo:reset refused: needs APP_ENV=demo, a project ref listed in DEMO_PROJECT_REFS, the service key and DEMO_PASSWORD.");
  process.exit(1);
}

const guidelines = /GUIDELINES_VERSION = "([^"]+)"/.exec(readFileSync("src/lib/guidelines.ts", "utf8"))?.[1] ?? "v1";
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (label, { data, error }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};
const EMAIL = (k) => `${k}@demo.pawlift.invalid`;

// ---- delete previous demo data (only is_demo rows and demo users)
must("delete requests", await db.from("transport_requests").delete().eq("is_demo", true));
must("delete locations", await db.from("locations").delete().eq("is_demo", true));
must("delete organisations", await db.from("organisations").delete().eq("is_demo", true));
let page = 1;
for (;;) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(`list users: ${error.message}`);
  for (const u of data.users) {
    if (u.email?.endsWith("@demo.pawlift.invalid")) must("delete user", await db.auth.admin.deleteUser(u.id));
  }
  if (data.users.length < 200) break;
  page += 1;
}

// ---- suburbs
const suburbs = must("suburbs", await db.from("suburbs").select("id,name"));
const sub = (name) => {
  const s = suburbs.find((x) => x.name === name);
  if (!s) throw new Error(`suburb missing: ${name}`);
  return s.id;
};

// ---- people
const PEOPLE = [
  ["admin", "Demo Admin", "St Albans"],
  ["sam", "Sam", "Sunshine"],
  ["priya", "Priya", "St Albans"],
  ["tom", "Tom", "Sunshine"],
  ["lee", "Lee", "Footscray"],
  ["jordan", "Jordan", "Sunshine"],
  ["mia", "Mia", "Werribee"],
];
const uid = {};
for (const [k, name, suburb] of PEOPLE) {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL(k), password, email_confirm: true, user_metadata: { display_name: name },
  });
  if (error || !data.user) throw new Error(`create ${k}: ${error?.message}`);
  uid[k] = data.user.id;
  must(`profile ${k}`, await db.from("profiles").update({ is_demo: true, display_name: name, home_suburb_id: sub(suburb) }).eq("id", uid[k]));
}
must("admin", await db.from("platform_admins").insert({ user_id: uid.admin }));

// ---- organisations (all fictional, all marked DEMO)
const ORGS = [
  ["western", "Western Paws Rescue (DEMO)", "rescue_group"],
  ["westgate", "Westgate Animal Pound (DEMO)", "council_pound"],
  ["bayside", "Bayside Cat Haven (DEMO)", "shelter"],
  ["kindpaws", "Kindpaws Vet (DEMO)", "vet_clinic"],
];
const org = {};
for (const [k, name, type] of ORGS) {
  const row = must(`org ${k}`, await db.from("organisations").insert({
    name, type, verification_status: "verified", is_demo: true, operating_area: "Western Melbourne (fictional DEMO data)",
    contact_name: "Demo contact", contact_email: `${k}@demo.pawlift.invalid`,
  }).select("id").single());
  org[k] = row.id;
}

// ---- memberships
const now = new Date().toISOString();
const member = (k, o, extra) => ({
  org_id: org[o], user_id: uid[k], status: "active", approved_by: uid.sam, approved_at: now,
  is_coordinator: false, is_volunteer: false, is_foster_carer: false, foster_can_confirm_receipt: false, foster_approved_by: null, foster_approved_at: null,
  ...extra,
});
must("members", await db.from("organisation_members").insert([
  member("sam", "western", { is_coordinator: true, approved_by: uid.admin }),
  member("priya", "western", { is_volunteer: true }),
  member("tom", "western", { is_volunteer: true }),
  member("lee", "western", { is_volunteer: true }),
  member("jordan", "western", { is_volunteer: true }),
  member("mia", "western", { is_volunteer: true, is_foster_carer: true, foster_approved_by: uid.sam, foster_approved_at: now, foster_can_confirm_receipt: true }),
]));

// ---- volunteer profiles (Jordan stays pending)
const vp = (k, species, carrier, status) => ({
  user_id: uid[k], species_ok: species, has_carrier: carrier, verification_status: status, is_demo: true,
  guidelines_version_accepted: guidelines, guidelines_accepted_at: now,
});
must("volunteer profiles", await db.from("volunteer_profiles").insert([
  vp("priya", ["cat"], true, "verified"),
  vp("tom", ["cat", "dog"], true, "verified"),
  vp("lee", ["cat", "dog", "other"], false, "verified"),
  vp("jordan", ["cat"], false, "pending"),
  vp("mia", ["cat", "dog"], true, "verified"),
]));

// ---- locations (fictional addresses; approximate points are suburb-level)
const pt = (lng, lat) => `SRID=4326;POINT(${lng} ${lat})`;
const LOCS = [
  ["pound_melton", "pound", "Westgate Animal Pound (DEMO), Melton", "Melton", pt(144.58, -37.683), "1 Fictional Rd, Melton (DEMO)", true],
  ["haven_geelong", "shelter", "Bayside Cat Haven (DEMO), Geelong", "Geelong", pt(144.361, -38.15), "2 Imaginary St, Geelong (DEMO)", true],
  ["sunshine_drop", "other", "Sunshine surrender point (DEMO)", "Sunshine", pt(144.832, -37.788), "3 Pretend Ave, Sunshine (DEMO)", false],
  ["vet_footscray", "vet", "Kindpaws Vet (DEMO), Footscray", "Footscray", pt(144.9, -37.8), "4 Make-believe Pde, Footscray (DEMO)", true],
  ["pound_werribee", "pound", "Wyndham Holding Pound (DEMO), Werribee", "Werribee", pt(144.66, -37.9), "5 Notreal Ct, Werribee (DEMO)", false],
  ["foster_mia", "foster_home", "Mia's foster home (DEMO), Werribee", "Werribee", pt(144.66, -37.9), "6 Example Cl, Werribee (DEMO)", true],
];
const loc = {};
for (const [k, kind, label, suburb, point, addr, confirmed] of LOCS) {
  const row = must(`location ${k}`, await db.from("locations").insert({
    org_id: org.western, kind, label_public: label, suburb_id: sub(suburb), approx_point: point, is_demo: true,
    is_confirmed_destination: confirmed, confirmed_by: confirmed ? uid.sam : null, confirmed_at: confirmed ? now : null,
    linked_user_id: k === "foster_mia" ? uid.mia : null,
  }).select("id").single());
  loc[k] = row.id;
  must(`private ${k}`, await db.from("location_private").insert({ location_id: row.id, exact_address: addr, instructions: "DEMO data: not a real place." }));
}

// ---- requests (windows run from seeding time for a week so the demo stays usable; rerun to refresh)
const in7d = new Date(Date.now() + 7 * 864e5).toISOString();
const REQS = [
  { name: "Biscuit", species: "cat", urgency: "soon", from: "pound_melton", to: "haven_geelong", status: "open", carrier: "Secure carrier with towel", handling: "Shy; keep the car quiet" },
  { name: "Rusty", species: "dog", urgency: "routine", from: "sunshine_drop", to: "vet_footscray", status: "open", handling: "Friendly, medium size" },
  { name: "Pip", species: "cat", urgency: "urgent", from: "pound_werribee", to: "vet_footscray", status: "open", carrier: "Carrier needed" },
  { name: "Draft Dot", species: "cat", urgency: "routine", from: "pound_melton", to: "haven_geelong", status: "draft" },
];
for (const r of REQS) {
  const open = r.status === "open";
  const row = must(`request ${r.name}`, await db.from("transport_requests").insert({
    org_id: org.western, reference: `PL-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    animal_name: r.name, species: r.species, urgency: r.urgency, deadline: open ? in7d : null,
    carrier_requirements: r.carrier ?? null, handling_requirements: r.handling ?? null,
    status: r.status, published_at: open ? now : null,
    release_authority_attested_by: open ? uid.sam : null, release_authority_attested_at: open ? now : null,
    origin_location_id: loc[r.from], destination_location_id: loc[r.to], is_demo: true,
  }).select("id").single());
  must(`leg ${r.name}`, await db.from("transport_legs").insert({
    request_id: row.id, seq: 1, from_location_id: loc[r.from], to_location_id: loc[r.to],
    window_start: now, window_end: in7d, status: "open",
  }));
}

console.log(`demo:reset done on ${ref}: ${PEOPLE.length} people, ${ORGS.length} organisations, ${REQS.length} requests.`);
