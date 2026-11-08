import { expect, test } from "@playwright/test";
import { runInfo } from "./env";
import { as, card, chooseOption, main, melbourneLocal } from "./helpers";

// BRIEF §13 organisation story: organisation registers → admin approves → invites an existing
// volunteer → volunteer joins → coordinator creates a request with a confirmed destination →
// volunteer accepts → coordinator confirms → volunteer completes → organisation records completion.
test("organisation story: a new organisation is approved, invites Lee, and completes a transport", async ({ browser }) => {
  const { runId } = runInfo();
  const orgName = `Northside Paws ${runId} (e2e)`;
  const animal = `Juniper ${runId}`;
  const coord = await as(browser, "orguser");
  const admin = await as(browser, "admin");
  const lee = await as(browser, "lee");

  // Register.
  await coord.goto("/org/new");
  await coord.getByLabel("Organisation name").fill(orgName);
  await coord.getByLabel("Type").selectOption("rescue_group");
  await coord.getByLabel("Registration details").fill("ABN 00 000 000 000 (DEMO, e2e)");
  await coord.getByLabel("Contact name").fill("Casey");
  await coord.getByLabel("Where you operate").fill("Western Melbourne");
  await coord.getByRole("button", { name: "Submit for verification" }).click();
  await expect(coord).toHaveURL(/\/org\/[0-9a-f-]{36}$/);
  const orgId = coord.url().split("/").pop()!;

  // Admin approves with a recorded check. The demo registrant's organisation is a DEMO one (D43).
  await admin.goto("/admin/organisations");
  await expect(card(main(admin), orgName)).toContainText("DEMO");
  await admin.goto(`/admin/organisations/${orgId}`);
  await admin.getByLabel("Checks performed (one per line)").fill("Registration details checked (DEMO e2e)");
  await admin.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(admin).toHaveURL(/\/admin\/organisations$/);

  // Invite an existing volunteer (Lee already drives for Western Paws).
  await coord.goto(`/org/${orgId}/members`);
  await coord.getByRole("button", { name: "Create invitation" }).click();
  const link = await coord.getByLabel("Invitation link").inputValue();
  const invitePath = new URL(link).pathname;

  await lee.goto(invitePath);
  await lee.getByRole("button", { name: `Join ${orgName} as a volunteer` }).click();
  await expect(lee).toHaveURL(/\/volunteer\?joined=1/);
  await coord.goto(`/org/${orgId}/members`);
  await expect(main(coord)).toContainText("Lee");

  // Locations: a pickup point and a destination, then confirm the destination.
  await coord.goto(`/org/${orgId}/locations`);
  const addLocation = async (kind: string, label: string, suburb: RegExp, address: string) => {
    const form = main(coord).locator("form").filter({ has: coord.getByRole("button", { name: "Add location" }) });
    await form.getByLabel("Type").selectOption(kind);
    await form.getByLabel("Public name").fill(label);
    await chooseOption(form.getByLabel("Suburb (public)"), suburb);
    await form.getByLabel("Exact address (private)").fill(address);
    await form.getByRole("button", { name: "Add location" }).click();
    await expect(card(main(coord), label)).toBeVisible();
  };
  await addLocation("shelter", `Northside shelter ${runId}`, /^Sunshine \d{4}$/, "10 Pretend St, Sunshine (DEMO)");
  await addLocation("vet", `Northside vet ${runId}`, /^Footscray \d{4}$/, "11 Pretend St, Footscray (DEMO)");
  const vet = card(main(coord), `Northside vet ${runId}`);
  await vet.getByRole("button", { name: "Confirm as destination" }).click();
  await expect(card(main(coord), `Northside vet ${runId}`)).toContainText("Confirmed destination");

  // Create the request, choosing the confirmed destination, then publish.
  // The coordinator starts from the map: "Add lift" goes straight to the form (one organisation).
  await coord.goto("/");
  await coord.getByRole("link", { name: "Add lift" }).click();
  await expect(coord).toHaveURL(new RegExp(`/org/${orgId}/requests/new$`));

  // The menu drawer lists the organisation pages and marks the current one.
  const menu = coord.getByRole("button", { name: "Menu" });
  await menu.click();
  const drawer = coord.getByRole("dialog", { name: "Menu" });
  for (const name of ["Dashboard", "Requests", "Locations", "Members", "History", "Audit trail", "Settings"]) {
    await expect(drawer.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(drawer.getByRole("link", { name: "Requests", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(drawer.getByRole("link", { name: "Dashboard", exact: true })).not.toHaveAttribute("aria-current");
  await coord.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();

  await coord.getByLabel("Animal name or reference").fill(animal);
  await coord.getByLabel("Type", { exact: true }).selectOption("dog");
  await chooseOption(coord.getByLabel("Pickup location"), new RegExp(`Northside shelter ${runId}`));
  await chooseOption(coord.getByLabel("Destination (confirmed locations only)"), new RegExp(`Northside vet ${runId}`));
  await coord.getByLabel("Pickup window starts").fill(melbourneLocal(1));
  await coord.getByLabel("Pickup window ends").fill(melbourneLocal(6));
  await coord.getByLabel("Special handling").fill("Friendly (DEMO)");
  await coord.getByRole("button", { name: "Save draft" }).click();
  await expect(coord).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await coord.getByRole("checkbox", { name: /authorised to release/ }).check();
  await coord.getByRole("button", { name: "Publish request" }).click();
  await expect(main(coord)).toContainText(/Open for volunteers/);

  // It appears on the map home: card in the list and a pin.
  await coord.goto("/");
  await expect(coord.getByLabel(new RegExp(`${animal}.*pickup pin`))).toBeAttached();
  await coord.getByRole("region", { name: "Animals needing a lift" }).getByRole("button", { name: "Show list" }).click();
  await expect(coord.getByRole("region", { name: "Animals needing a lift" })).toContainText(animal);

  // Lee finds it in the list and takes it.
  await lee.goto("/requests");
  await card(main(lee), animal).getByRole("link", { name: `View details for ${animal}` }).click();
  await lee.getByRole("button", { name: `I can take ${animal}` }).click();
  await expect(lee).toHaveURL(/\/assignments\/[0-9a-f-]+\?claimed=1/);
  const assignmentUrl = lee.url().split("?")[0];

  // Coordinator confirms; Lee drives it.
  await coord.goto(`/org/${orgId}/dashboard`);
  await card(coord.getByRole("region", { name: /Waiting for you to confirm/ }), animal)
    .getByRole("button", { name: "Confirm this volunteer" }).click();
  await expect(coord.getByRole("region", { name: /^Confirmed/ })).toContainText(animal);

  await lee.goto(assignmentUrl);
  await expect(main(lee)).toContainText("10 Pretend St, Sunshine (DEMO)");
  await lee.getByRole("button", { name: "Start trip" }).click();
  await lee.getByRole("button", { name: "I've collected the animal" }).click();
  await lee.getByRole("button", { name: "I've delivered the animal" }).click();
  await expect(lee.getByRole("button", { name: "I've delivered the animal" })).toHaveCount(0);

  // The organisation records completion; history lists it.
  await coord.goto(`/org/${orgId}/dashboard`);
  await card(coord.getByRole("region", { name: /Delivered: confirm the animal arrived/ }), animal)
    .getByRole("button", { name: "Animal received: mark complete" }).click();
  await expect(coord.getByRole("region", { name: /Completed in the last 30 days/ })).toContainText(animal);
  await coord.goto(`/org/${orgId}/history`);
  await expect(main(coord)).toContainText(animal);
});
