import { InfoPage, Section } from "@/components/InfoPage";

export const metadata = { title: "Terms · PawLift" };

export default function TermsPage() {
  return (
    <InfoPage title="Terms of use" intro="Plain-language draft." draft>
      <Section title="What PawLift does">
        <p>
          PawLift is a coordination tool. It connects rescue groups with volunteers who offer to transport animals.
          PawLift is not a party to any arrangement between them.
        </p>
      </Section>
      <Section title="Your responsibilities">
        <ul className="list-disc space-y-1 pl-5">
          <li>Give accurate information and keep your account to yourself.</li>
          <li>Follow the transport safety guidelines and the instructions of the rescue group.</li>
          <li>Obey road rules and animal welfare laws. Only take trips you can safely do.</li>
          <li>Report incidents promptly.</li>
        </ul>
      </Section>
      <Section title="Verification">
        <p>
          &quot;Verified&quot; means a rescue group or admin recorded that they checked certain things. It is not a
          background check or a guarantee about a person.
        </p>
      </Section>
      <Section title="Liability and insurance">
        <p>
          To be settled with professional advice before launch: liability, insurance cover for volunteers and animals,
          and how disputes are handled.
        </p>
      </Section>
      <Section title="Changes and suspension">
        <p>
          Admins may suspend accounts that put animals or people at risk. These terms will change before launch.
        </p>
      </Section>
    </InfoPage>
  );
}
