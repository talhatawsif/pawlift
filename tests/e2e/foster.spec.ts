import { expect, test } from "@playwright/test";
import { runInfo } from "./env";
import { as, card, chooseOption, main, melbourneLocal } from "./helpers";

// BRIEF §13: an authorised foster carer receives an animal. Sam sends a dog to Mia's foster home,
// Tom drives it, Mia confirms it arrived safely, Sam completes.
test("foster story: Mia receives Pepper and confirms the arrival", async ({ browser }) => {
  const { westernOrgId, runId } = runInfo();
  const animal = `Pepper ${runId}`;
  const sam = await as(browser, "sam");
  const tom = await as(browser, "tom");
  const mia = await as(browser, "mia");

  await sam.goto(`/org/${westernOrgId}/requests/new`);
  await sam.getByLabel("Animal name or reference").fill(animal);
  await sam.getByLabel("Type", { exact: true }).selectOption("dog");
  await sam.getByLabel("Urgency").selectOption("soon");
  await chooseOption(sam.getByLabel("Pickup location"), /Westgate Animal Pound \(DEMO\), Melton/);
  await chooseOption(sam.getByLabel("Destination (confirmed locations only)"), /Mia's foster home \(DEMO\)/);
  await sam.getByLabel("Pickup window starts").fill(melbourneLocal(1));
  await sam.getByLabel("Pickup window ends").fill(melbourneLocal(6));
  await sam.getByLabel("Carrier or restraint requirements").fill("Crate or harness (DEMO)");
  await sam.getByLabel("Medical or mobility notes (private)").fill("DEMO: fictional note. Needs water on arrival.");
  await sam.getByRole("button", { name: "Save draft" }).click();
  await expect(sam).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await sam.getByRole("checkbox", { name: /authorised to release/ }).check();
  await sam.getByRole("button", { name: "Publish lift" }).click();
  await expect(main(sam)).toContainText(/Open for volunteers/);

  // Before anyone takes it, Mia sees nothing incoming for it.
  await mia.goto("/foster");
  await expect(main(mia)).toContainText("My foster home");
  await expect(main(mia)).not.toContainText(animal);

  await tom.goto("/requests");
  await card(main(tom), animal).getByRole("link", { name: `View details for ${animal}` }).click();
  await tom.getByRole("button", { name: `I can take ${animal}` }).click();
  await expect(tom).toHaveURL(/\/assignments\/[0-9a-f-]+\?claimed=1/);
  const assignmentUrl = tom.url().split("?")[0];

  await sam.goto(`/org/${westernOrgId}/dashboard`);
  await card(sam.getByRole("region", { name: /Waiting for you to confirm/ }), animal)
    .getByRole("button", { name: "Confirm this volunteer" }).click();
  await expect(sam.getByRole("region", { name: /^Confirmed/ })).toContainText(animal);

  // Once confirmed, Mia sees it coming with the driver's first name; never the pickup address.
  await mia.goto("/foster");
  const incoming = card(main(mia), animal);
  await expect(incoming).toContainText("Tom");
  await expect(main(mia)).not.toContainText("1 Fictional Rd");

  await tom.goto(assignmentUrl);
  await expect(main(tom)).toContainText("6 Example Cl, Werribee (DEMO)");
  await tom.getByRole("button", { name: "Start trip" }).click();
  await tom.getByRole("button", { name: "I've collected the animal" }).click();
  await tom.getByRole("button", { name: "I've delivered the animal" }).click();
  await expect(tom.getByRole("button", { name: "I've delivered the animal" })).toHaveCount(0);

  // Mia confirms the arrival.
  await mia.goto("/foster");
  await card(main(mia), animal).getByRole("button", { name: `${animal} has arrived safely` }).click();
  await expect(card(main(mia), animal)).not.toContainText("Tom");
  await expect(mia.getByRole("button", { name: `${animal} has arrived safely` })).toHaveCount(0);

  // Sam completes; it moves to Mia's past arrivals.
  await sam.goto(`/org/${westernOrgId}/dashboard`);
  await card(sam.getByRole("region", { name: /Delivered: confirm the animal arrived/ }), animal)
    .getByRole("button", { name: "Animal received: mark complete" }).click();
  await expect(sam.getByRole("region", { name: /Completed in the last 30 days/ })).toContainText(animal);
  await mia.goto("/foster");
  await expect(mia.locator("section").filter({ has: mia.getByRole("heading", { name: "Past arrivals" }) })).toContainText(animal);
});
