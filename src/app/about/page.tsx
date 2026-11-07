import { InfoPage, Section } from "@/components/InfoPage";

export const metadata = { title: "About · PawLift" };

export default function AboutPage() {
  return (
    <InfoPage
      title="About PawLift"
      intro="You're already going somewhere. You might be able to help an animal get there too."
    >
      <Section title="What it is">
        <p>
          PawLift helps animal rescue groups in Western Melbourne find volunteers who are already driving the right way.
          Rescues post a transport request. Volunteers see requests near them, or along a trip they plan, and offer to
          help.
        </p>
      </Section>
      <Section title="What it is not">
        <p>
          PawLift does not run rescues, own animals or employ drivers. Rescue groups stay in charge of their animals
          and decide who is confirmed. PawLift organises the networks they already have and makes it easier to find
          more people.
        </p>
      </Section>
      <Section title="Demo">
        <p>
          This version uses fictional organisations, people and animals, marked DEMO. Route times marked DEMO are
          estimates, not real directions. Nothing here has been approved for public launch.
        </p>
      </Section>
    </InfoPage>
  );
}
