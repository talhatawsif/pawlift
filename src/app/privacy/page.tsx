import { InfoPage, Section } from "@/components/InfoPage";

export const metadata = { title: "Privacy · PawLift" };

export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy" intro="What PawLift keeps and who can see it." draft>
      <Section title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details: name, email and, for volunteers, a phone number and vehicle details.</li>
          <li>Trips you plan and your location, only when you allow it. You can use a suburb instead.</li>
          <li>Lift details from rescue groups, including pickup and drop-off addresses and contacts.</li>
          <li>Records of actions in the app (an audit log) so problems can be investigated.</li>
        </ul>
      </Section>
      <Section title="Who can see it">
        <p>
          Exact addresses, contacts and handling notes are held apart from public data. They are shown only to the
          rescue group, the confirmed volunteer for that trip and people the group authorises. Admins see them only with a
          recorded reason, and that access is logged and visible to the rescue group.
        </p>
      </Section>
      <Section title="How long we keep it">
        <p>Saved journeys are deleted after they expire. Other retention periods are to be set before launch.</p>
      </Section>
      <Section title="Your choices">
        <p>You can turn off reminders and use a suburb instead of your location. Access and deletion requests: to be defined before launch.</p>
      </Section>
    </InfoPage>
  );
}
