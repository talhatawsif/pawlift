/** Demo personas (PLAN §11). Accounts are created by `npm run demo:reset` (later batch). */
export const PERSONAS = [
  { key: "admin", name: "Demo Admin", role: "Platform admin" },
  { key: "sam", name: "Sam", role: "Coordinator, Western Paws Rescue" },
  { key: "priya", name: "Priya", role: "Volunteer, St Albans" },
  { key: "tom", name: "Tom", role: "Volunteer, Sunshine" },
  { key: "lee", name: "Lee", role: "Volunteer, Footscray" },
  { key: "jordan", name: "Jordan", role: "Volunteer, pending verification" },
  { key: "mia", name: "Mia", role: "Foster carer and volunteer, Werribee" },
] as const;

export type PersonaKey = (typeof PERSONAS)[number]["key"];

export const personaEmail = (key: PersonaKey) => `${key}@demo.pawlift.invalid`;

/** Server-side only. The switcher exists solely when APP_ENV=demo. */
export const isDemoEnv = () => process.env.APP_ENV === "demo";
