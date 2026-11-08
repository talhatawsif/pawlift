import { InfoPage, Section } from "@/components/InfoPage";

export const metadata = { title: "How it works · PawLift" };

export default function HowItWorksPage() {
  return (
    <InfoPage title="How it works" intro="One lift, one driver, one trip.">
      <Section title="For volunteers">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Sign up and complete your volunteer profile. A rescue group or admin checks it.</li>
          <li>Open the map to see animals that need a lift nearby.</li>
          <li>Or enter where you are heading to see lifts that are close to your route, with the extra driving time.</li>
          <li>Offer to take an animal. The rescue group confirms before anything is final.</li>
          <li>Once confirmed, you see the pickup and drop-off details. Confirm pickup and delivery in the app.</li>
        </ol>
      </Section>
      <Section title="For rescue groups">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Register your organisation. An admin verifies it.</li>
          <li>Invite your existing volunteers, and add foster carers who can receive animals.</li>
          <li>Create a lift with pickup, drop-off, a time window and what the animal needs.</li>
          <li>Confirm a volunteer, follow progress on the dashboard, and mark the lift complete.</li>
        </ol>
      </Section>
      <Section title="Privacy by design">
        <p>
          The map shows suburbs, not street addresses. Exact addresses, phone numbers and handling notes are shown only
          to the confirmed volunteer, the rescue group and people it authorises, and are hidden again when the trip ends
          or changes.
        </p>
      </Section>
    </InfoPage>
  );
}
