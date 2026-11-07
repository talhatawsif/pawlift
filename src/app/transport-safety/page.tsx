import { InfoPage, Section } from "@/components/InfoPage";
import { GUIDELINES } from "@/lib/guidelines";

export const metadata = { title: "Transport safety · PawLift" };

export default function TransportSafetyPage() {
  return (
    <InfoPage
      title="Transport safety"
      intro="Volunteers accept these guidelines before they can take an animal."
      draft
    >
      <ol className="space-y-4">
        {GUIDELINES.map((g, i) => (
          <li key={g.title}>
            <h2 className="font-semibold">
              {i + 1}. {g.title}
            </h2>
            <p className="mt-1">{g.body}</p>
          </li>
        ))}
      </ol>
      <Section title="No guarantees">
        <p>
          These guidelines are general advice. PawLift does not guarantee the safety of any animal, volunteer or trip,
          and does not provide insurance. Check what cover your rescue group and your own vehicle insurance give you.
        </p>
      </Section>
      <Section title="In an emergency">
        <p>
          If an animal or person is hurt, get help first: call 000 for people, or an emergency vet for the animal. Then
          tell the coordinator and report an incident in PawLift.
        </p>
      </Section>
    </InfoPage>
  );
}
