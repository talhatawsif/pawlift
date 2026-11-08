import { expect, test } from "@playwright/test";
import { runInfo } from "./env";
import { as, card, main } from "./helpers";

// BRIEF §13 volunteer story: home → nearby → destination → route match → extra time → accept →
// organisation confirms → pickup → delivery → completed on the organisation dashboard.
test("volunteer story: Priya takes Biscuit from the map and Sam sees it completed", async ({ browser }) => {
  const { westernOrgId } = runInfo();
  const priya = await as(browser, "priya");
  const sam = await as(browser, "sam");

  // Home: nearby list, all DEMO.
  await priya.goto("/");
  const sheet = priya.getByRole("region", { name: "Animals needing a lift" });
  await expect(sheet).toContainText(/3 animals need a lift/);
  await sheet.getByRole("button", { name: "Show list" }).click();
  for (const name of ["Biscuit", "Rusty", "Pip"]) await expect(sheet).toContainText(name);

  // Starting point: choose a suburb instead of device location.
  await priya.getByRole("button", { name: /^From:/ }).click();
  const dialog = priya.getByRole("dialog");
  await dialog.getByRole("button", { name: "Choose a suburb instead" }).click();
  await dialog.getByLabel("Suburb or postcode").fill("St Albans");
  await dialog.getByRole("button", { name: /^St Albans\s*\d{4}$/ }).first().click();
  await expect(priya.getByRole("button", { name: /^From: St Albans/ })).toBeVisible();

  // Destination and search.
  await priya.getByRole("combobox", { name: /Where are you heading/ }).fill("Geelong");
  await priya.getByRole("option", { name: /^Geelong \d{4}$/ }).click();
  await priya.getByRole("button", { name: "Find lifts along my route" }).click();

  // Route match with extra time, labelled DEMO.
  const route = priya.getByRole("region", { name: "On your route" });
  const match = card(route, "Biscuit");
  await expect(match).toContainText(/\+\d+ min driving/);
  await expect(match).toContainText("DEMO estimate");

  // Changing any search input clears the stale matches; searching again restores them.
  await priya.getByLabel("Most extra driving").selectOption("30");
  await expect(route).toHaveCount(0);
  await priya.getByRole("button", { name: "Find lifts along my route" }).click();
  await expect(card(route, "Biscuit")).toContainText("DEMO estimate");
  await match.getByRole("link", { name: "View details and take this" }).click();

  // Accept.
  await priya.getByRole("button", { name: "I can take Biscuit" }).click();
  await expect(priya).toHaveURL(/\/assignments\/[0-9a-f-]+\?claimed=1/);
  await expect(main(priya)).toContainText("Reserved for you");
  const assignmentUrl = priya.url().split("?")[0];
  await expect(main(priya)).not.toContainText("1 Fictional Rd");

  // The organisation confirms (needs-a-driver first, then waiting for confirmation).
  await sam.goto(`/org/${westernOrgId}/dashboard`);
  const waiting = sam.getByRole("region", { name: /Waiting for you to confirm/ });
  await card(waiting, "Biscuit").getByRole("button", { name: "Confirm this volunteer" }).click();
  await expect(sam.getByRole("region", { name: /^Confirmed/ })).toContainText("Biscuit");

  // Exact details appear for the confirmed volunteer; pickup and delivery.
  await priya.goto(assignmentUrl);
  await expect(main(priya)).toContainText("1 Fictional Rd, Melton (DEMO)");
  await priya.getByRole("button", { name: "Start trip" }).click();
  await priya.getByRole("button", { name: "I've collected the animal" }).click();
  await priya.getByRole("button", { name: "I've delivered the animal" }).click();
  await expect(priya.getByRole("button", { name: "I've delivered the animal" })).toHaveCount(0);
  await priya.reload();
  await expect(main(priya)).not.toContainText("1 Fictional Rd");

  // The organisation records completion.
  await sam.goto(`/org/${westernOrgId}/dashboard`);
  const delivered = sam.getByRole("region", { name: /Delivered: confirm the animal arrived/ });
  await card(delivered, "Biscuit").getByRole("button", { name: "Animal received: mark complete" }).click();
  const completed = sam.getByRole("region", { name: /Completed in the last 30 days/ });
  await expect(completed).toContainText("Biscuit");

  // The audit trail lists the request's events.
  await card(completed, "Biscuit").getByRole("link", { name: "History for this lift" }).click();
  await expect(main(sam).locator("li")).not.toHaveCount(0);
});
