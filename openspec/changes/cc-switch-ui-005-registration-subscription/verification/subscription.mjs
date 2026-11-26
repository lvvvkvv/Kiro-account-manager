import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { button, calls, until } from "./helpers.mjs";
export async function verifySubscription({ page, out, navigate }) {
  const report = [];
  await navigate("subscription");
  await button(page, "Enable Overage (1)").waitFor();
  // S01: original default, preflight and the intentionally less strict fetch collection.
  await button(page, "Subscription Links").click();
  await page
    .getByText("Scanned 7 accounts: 2 eligible, 5 blocked", { exact: true })
    .waitFor();
  await button(page, "Load Plans").click();
  await button(page, "Pro $0.2/Monthly").waitFor();
  if (!process.env.UI_BEFORE) {
    const plan = await button(page, "Pro $0.2/Monthly").evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        h: e.getBoundingClientRect().height,
        r: s.borderRadius,
        font: s.fontSize,
      };
    });
    assert.equal(plan.h, 58);
    assert.equal(plan.r, "10px");
    assert.equal(plan.font, "13px");
  }
  const plans = await calls(page, "accountGetSubscriptions");
  assert.deepEqual(plans.at(-1).args, [
    "fake-free-a",
    "us-east-1",
    undefined,
    "0".repeat(64),
    "BuilderId",
    "IdC",
    "free-a",
  ]);
  await button(page, "Fetch Links (4)").click();
  await page.waitForFunction(
    () =>
      window.__calls.filter((c) => c.name === "accountGetSubscriptionUrl")
        .length === 4,
  );
  await page.waitForTimeout(100);
  const fetches = await calls(page, "accountGetSubscriptionUrl");
  assert.deepEqual(
    fetches.map((c) => c.args[7]),
    ["free-a", "free-b", "banned", "cant"],
  );
  assert.ok(fetches.every((c) => c.args[1] === "Q_DEVELOPER_STANDALONE_PRO"));
  report.push({
    id: "S01",
    preflight: [2, 5],
    fetchTargets: fetches.map((c) => c.args[7]),
  });
  // S02: exact selected/all scopes, quick pick, additive status selection, invert/clear.
  await page.getByTitle("Select all", { exact: true }).click();
  await button(page, "Delete Selected (4)").waitFor();
  await page.getByTitle("Deselect all", { exact: true }).click();
  await page.locator('input[title="Number of links to pick"]').fill("1");
  await button(page, "Top").click();
  await page.getByRole("button", { name: /^Open Selected \(1\)$/ }).click();
  assert.deepEqual(
    (await calls(page, "openSubscriptionWindow")).map((c) => c.args[0]),
    ["https://example.invalid/subscription/free-a"],
  );
  await page.getByRole("button", { name: /^Export Selected \(1\)$/ }).click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "https://example.invalid/subscription/free-a",
  );
  await button(page, "Next").click();
  await page.getByRole("button", { name: /^Export Selected \(1\)$/ }).click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "https://example.invalid/subscription/banned",
  );
  await button(page, "Deselect").click();
  await page.getByRole("button", { name: /^✗ Error \(1\)$/ }).click();
  await page.getByRole("button", { name: /^✓ Success \(3\)$/ }).click();
  await page
    .getByRole("button", { name: "Delete Selected (4)", exact: true })
    .waitFor();
  await button(page, "Invert").click();
  assert.equal(
    await page.getByRole("button", { name: /^Delete Selected/ }).count(),
    0,
  );
  await page.getByRole("button", { name: "Open All (3)", exact: true }).click();
  assert.equal((await calls(page, "openSubscriptionWindow")).length, 4);
  await page
    .getByRole("button", { name: "Export All (3)", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.__clipboard)).split("\n").length,
    3,
  );
  await page.getByTitle("Open in incognito", { exact: true }).first().click();
  assert.equal(
    (await calls(page, "openSubscriptionWindow")).at(-1).args[0],
    "https://example.invalid/subscription/free-a",
  );
  // Validate all successes; failed links remain failed. Regenerate one with the selected plan.
  await page.evaluate(
    () =>
      (window.__reg.failProbe = [
        "https://example.invalid/subscription/banned",
      ]),
  );
  await button(page, "Validate").click();
  await until(
    page,
    () =>
      window.__calls.filter((c) => c.name === "diagnoseHttpProbe").length === 3,
  );
  await page.waitForTimeout(100);
  assert.ok(
    (await calls(page, "diagnoseHttpProbe")).every(
      (c) => c.args[0].method === "HEAD" && c.args[0].timeoutMs === 6000,
    ),
  );
  await page.evaluate(() => (window.__reg.failUrlIds = []));
  await page
    .getByRole("button", { name: "Regenerate", exact: true })
    .first()
    .click();
  await page.waitForTimeout(120);
  assert.equal((await calls(page, "accountGetSubscriptionUrl")).length, 5);
  // Cancel and import with URL deduplication, copying and selecting the imported row.
  await button(page, "Import").click();
  await page
    .locator("textarea")
    .fill("cancel@example.invalid https://example.invalid/cancel");
  await button(page, "Cancel").click();
  assert.equal(
    await page.getByText("cancel@example.invalid", { exact: true }).count(),
    0,
  );
  await button(page, "Import").click();
  await page
    .locator("textarea")
    .fill(
      "import@example.invalid https://example.invalid/import\nhttps://example.invalid/import\ninvalid",
    );
  await button(page, "Import (2)").click();
  await page.getByText("import@example.invalid", { exact: true }).waitFor();
  const row = page
    .getByText("import@example.invalid", { exact: true })
    .locator("..");
  await row.getByRole("button", { name: "Copy link", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "https://example.invalid/import",
  );
  await navigate("home");
  await navigate("subscription");
  await page.getByText("import@example.invalid", { exact: true }).waitFor();
  await button(page, "Overage Settings").click();
  await button(page, "Subscription Links").click();
  await page.getByText("import@example.invalid", { exact: true }).waitFor();
  report.push({
    id: "S02",
    flow: "fetch/quick top/next/status/invert/deselect + selected/all open/export + HEAD + regenerate + import cancel/dedup + copy + tab/page persistence",
  });
  // S02: delete without account coupling, cancellation, and explicit coupled deletion.
  await page.evaluate(async () => {
    const { appendSubscriptionLink } =
      await import("/src/components/pages/SubscriptionPage.tsx");
    appendSubscriptionLink({
      accountId: "free-b",
      email: "cleanup@example.invalid",
      status: "error",
      error: "Fixture",
    });
    window.__confirm = false;
  });
  const remove = page.getByRole("button", { name: /^Remove Failed/ });
  await remove.click();
  await page.getByText("cleanup@example.invalid", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      return useAccountsStore.getState().accounts.has("free-b");
    }),
    true,
  );
  await page.evaluate(() => (window.__confirm = true));
  await remove.click();
  assert.equal(
    await page.getByText("cleanup@example.invalid", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      return useAccountsStore.getState().accounts.has("free-b");
    }),
    true,
  );
  await page.evaluate(async () => {
    const { appendSubscriptionLink } =
      await import("/src/components/pages/SubscriptionPage.tsx");
    appendSubscriptionLink({
      accountId: "free-b",
      email: "coupled@example.invalid",
      status: "error",
      error: "Fixture",
    });
  });
  await page.getByLabel("Delete accounts", { exact: true }).check();
  await remove.click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      return useAccountsStore.getState().accounts.has("free-b");
    }),
    false,
  );
  // Delete selected is still list-only even with the other checkbox enabled.
  await button(page, "Top").click();
  await page
    .getByRole("button", { name: "Delete Selected (1)", exact: true })
    .click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      return useAccountsStore.getState().accounts.has("free-a");
    }),
    true,
  );
  report.push({
    id: "S02",
    delete:
      "cancel → no coupling keeps account → enabled coupling deletes only matched failed account → selected list delete remains list-only",
  });
  // S03: overage single allowed subset vs all, failures, batch portals and confirmation cancellation.
  await button(page, "Overage Settings").click();
  await button(page, "Enable Overage (1)").click();
  await until(page, () =>
    window.__calls.some((c) => c.name === "accountSetOverage"),
  );
  await page.getByText("Fixture overage denied", { exact: true }).waitFor();
  assert.deepEqual(
    (await calls(page, "accountSetOverage")).map((c) => [c.args[7], c.args[1]]),
    [["pro-a", "ENABLED"]],
  );
  await button(page, "Set All (2)").click();
  await until(
    page,
    () =>
      window.__calls.filter((c) => c.name === "accountSetOverage").length === 3,
  );
  await button(page, "Manage Subscriptions").click();
  const manageRow = page
    .getByText("pro-b@example.invalid", { exact: true })
    .locator("..");
  await manageRow.getByRole("button").first().click();
  await page.evaluate(() => (window.__confirm = false));
  await page
    .getByRole("button", { name: "Open Portal (Selected: 1)", exact: true })
    .click();
  const beforeOpen = (await calls(page, "openSubscriptionWindow")).length;
  await page.evaluate(() => (window.__confirm = true));
  await page
    .getByRole("button", { name: "Open Portal (Selected: 1)", exact: true })
    .click();
  await until(
    page,
    (n) =>
      window.__calls.filter((c) => c.name === "openSubscriptionWindow")
        .length ===
      n + 1,
    beforeOpen,
  );
  assert.equal(
    (await calls(page, "accountGetSubscriptionUrl")).at(-1).args[7],
    "pro-b",
  );
  await page.waitForTimeout(550);
  await page
    .getByRole("button", { name: /^Disable Overage \(Selected/ })
    .click();
  await until(page, async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    return (
      useAccountsStore.getState().accounts.get("pro-b").usage.resourceDetail
        .overageEnabled === false
    );
  });
  assert.deepEqual(
    (await calls(page, "accountSetOverage")).at(-1).args.slice(0, 2),
    ["fake-pro-b", "DISABLED"],
  );
  report.push({
    id: "S03",
    enableTargets: ["pro-a"],
    allTargets: ["pro-a", "pro-b"],
    manageSelected: "pro-b",
    confirm: true,
  });
  // >=50 virtual rows: actual viewport, row estimate and last item; header stays aligned.
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const store = useAccountsStore.getState(),
      base = store.accounts.get("pro-a"),
      accounts = new Map();
    for (let i = 0; i < 61; i++) {
      const id = `bulk-${i}`;
      accounts.set(id, {
        ...base,
        id,
        email: `bulk-${i}@example.invalid`,
        status: "active",
      });
    }
    useAccountsStore.setState({ accounts, selectedIds: new Set() });
  });
  const last = page.getByText("bulk-60@example.invalid", { exact: true });
  const viewport = page.locator('[style*="contain: strict"]');
  await viewport.waitFor({
    state: process.env.UI_BEFORE ? "attached" : "visible",
  });
  const height = await viewport.evaluate(
    (e) => e.getBoundingClientRect().height,
  );
  if (!process.env.UI_BEFORE) {
    assert.ok(height > 100);
    await viewport.evaluate((e) => (e.scrollTop = e.scrollHeight));
    await last.waitFor();
    const row = last.locator("..");
    assert.equal(
      await row.evaluate((e) => e.getBoundingClientRect().height),
      47,
    );
    await row.getByTitle("Open subscription portal", { exact: true }).click();
    assert.equal(
      (await calls(page, "accountGetSubscriptionUrl")).at(-1).args[7],
      "bulk-60",
    );
  }
  report.push({
    id: "S03",
    virtualCount: 61,
    viewportHeight: height,
    lastRow: !process.env.UI_BEFORE,
  });
  await fs.writeFile(
    `${out}/subscription.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    "通过：S01–S03 预检/方案、链接选择和全范围、验证/再生/清理/账号联动、超额和门户、61 行虚拟滚动",
  );
}
