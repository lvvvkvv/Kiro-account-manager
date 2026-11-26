import assert from "node:assert/strict";
import fs from "node:fs/promises";
const state = async (page, keys) =>
  page.evaluate(async (keys) => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    return Object.fromEntries(keys.map((k) => [k, s.getState()[k]]));
  }, keys);
const calls = async (page, name) =>
  page.evaluate((name) => window.__calls.filter((c) => c.name === name), name);
export async function verifySettings({ page, navigate, setAppearance, out }) {
  await setAppearance("en", "light");
  await navigate("settings");
  const row = (text) =>
    page
      .locator(".ui-setting-row")
      .filter({ has: page.getByText(text, { exact: true }) });
  const click = (text) => row(text).getByRole("button").click();
  const report = {};
  assert.equal(
    await page.locator('select[aria-label="Display Language"] option').count(),
    2,
  );
  await click("Privacy Mode");
  await click("Usage Precision");
  await click("Login Private Mode");
  await row("Switch Target").locator("select").selectOption("both");
  assert.deepEqual(
    await state(page, [
      "privacyMode",
      "usagePrecision",
      "loginPrivateMode",
      "switchTarget",
    ]),
    {
      privacyMode: true,
      usagePrecision: false,
      loginPrivateMode: true,
      switchTarget: "both",
    },
  );
  // No network submission while typing; only the existing Save applies the URL.
  const proxy = page.getByPlaceholder(
    "http://127.0.0.1:7890 or socks5://127.0.0.1:1080",
  );
  const before = (await calls(page, "setProxy")).length;
  await proxy.fill("socks5://127.0.0.1:1088");
  assert.equal((await calls(page, "setProxy")).length, before);
  await proxy
    .locator("..")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  assert.equal(
    (await calls(page, "setProxy")).at(-1).args[1],
    "socks5://127.0.0.1:1088",
  );
  await click("Auto Refresh");
  await row("Check Interval").locator("select").selectOption("15");
  await row("Concurrency").first().locator("input").fill("12");
  await click("Sync Account Info");
  await row("Usage API Type").locator("select").selectOption("cbor");
  await click("Use K-Proxy for API");
  await click("Enable Auto Switch");
  await row("Balance Threshold").locator("input").fill("7");
  await row("How often to check balance").locator("select").selectOption("5");
  await page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Batch Import", exact: true }),
    })
    .locator("input")
    .fill("21");
  await row("Close Button Action").locator("select").selectOption("minimize");
  const shortcut = row("Show Window").locator("input");
  await shortcut.click();
  await shortcut.press("Meta+Shift+J");
  assert.equal(
    (await calls(page, "setShowWindowShortcut")).at(-1).args[0],
    "Command+Shift+J",
  );
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page
    .locator('select[aria-label="Display Language"]')
    .selectOption("zh");
  const keys = [
    "theme",
    "darkMode",
    "language",
    "privacyMode",
    "usagePrecision",
    "autoRefreshEnabled",
    "autoRefreshInterval",
    "autoRefreshConcurrency",
    "autoRefreshSyncInfo",
    "autoSwitchEnabled",
    "autoSwitchThreshold",
    "autoSwitchInterval",
    "batchImportConcurrency",
    "switchTarget",
    "loginPrivateMode",
    "proxyUrl",
  ];
  report.preferences = await state(page, keys);
  await page
    .locator(".ui-setting-row")
    .filter({ hasText: /Proactive Token Renewal for IDE|IDE 主动续期/ })
    .getByRole("button")
    .click();
  assert.equal(
    (await calls(page, "setProactiveRenewalEnabled")).at(-1).args[0],
    true,
  );
  // Rehydrate the actual persisted payload in the same isolated session, preserving all values.
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    await s.getState().flushSaveImmediately();
    window.__persisted = structuredClone(window.__data);
    s.getState().stopAutoSwitch();
    s.getState().stopAutoTokenRefresh();
    s.setState({ theme: "light", language: "en", privacyMode: false });
    await s.getState().loadFromStorage();
  });
  const restored = await state(page, keys);
  assert.equal(restored.autoRefreshSyncInfo, true);
  report.existingPersistenceGap =
    "原 store 未持久化 autoRefreshSyncInfo，回读为 true；本次沿用";
  delete restored.autoRefreshSyncInfo;
  const persisted = { ...report.preferences };
  delete persisted.autoRefreshSyncInfo;
  assert.deepEqual(restored, persisted);
  await setAppearance("en", "light");
  await navigate("settings");
  // Inner config format retains IDs and overwrites after explicit confirmation only.
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    s.setState({ autoRefreshEnabled: false, autoSwitchEnabled: false });
    s.getState().stopAutoSwitch();
    s.getState().stopAutoTokenRefresh();
    s.getState().addProxy("http://fixture-user:fixture-pass@127.0.0.1:9000", {
      label: "Fixture proxy",
    });
    localStorage.setItem(
      "kiro-register-templates",
      '[{"id":"original-template"}]',
    );
    localStorage.setItem("systemLogs_displayLimit", "10000");
  });
  await page
    .getByRole("button", { name: "Export Config", exact: true })
    .click();
  await page.waitForTimeout(50);
  const embedded = await page.evaluate(() =>
    JSON.parse(window.__downloads.at(-1).text),
  );
  assert.equal(embedded.type, "kiro-account-manager-config");
  assert.equal(embedded.app, undefined);
  assert.equal(Array.isArray(embedded.proxyPool), false);
  assert.ok(Object.values(embedded.proxyPool)[0].url.includes("fixture-pass"));
  embedded.localStorage["systemLogs_displayLimit"] = "50000";
  embedded.proxyPool = {
    "original-id": {
      ...Object.values(embedded.proxyPool)[0],
      id: "original-id",
    },
  };
  await page.evaluate((p) => {
    window.__import = { format: "json", content: JSON.stringify(p) };
    window.__confirm = false;
  }, embedded);
  await page
    .getByRole("button", { name: "Import Config", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("systemLogs_displayLimit")),
    "10000",
  );
  await page.evaluate(() => (window.__confirm = true));
  await page
    .getByRole("button", { name: "Import Config", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("systemLogs_displayLimit")),
    "50000",
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return [...s.getState().proxyPool.keys()];
    }),
    ["original-id"],
  );
  assert.match(await page.evaluate(() => window.__alerts.at(-1)), /restart/);
  report.embedded = embedded;
  // Account export reuses existing dialog; clear requires both original confirmations.
  await row("Export Data").getByRole("button").click();
  assert.ok(await page.locator(".ui-dialog-panel").count());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate("settings");
  await page.evaluate(() => (window.__confirm = false));
  await row("Clear All Data").getByRole("button").click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accounts.size;
    }),
    3,
  );
  // Machine ID operations run only against the in-memory IPC fixture.
  await navigate("machineId");
  await page.getByText("Current Machine ID", { exact: true }).waitFor();
  const card = (text) =>
    page
      .locator(".glass-card")
      .filter({ has: page.getByText(text, { exact: true }) });
  await card("Current Machine ID")
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "11111111-1111-4111-8111-111111111111",
  );
  await page
    .getByRole("button", { name: "Generate & Apply", exact: true })
    .click();
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => window.__machine),
    "22222222-2222-4222-8222-222222222222",
  );
  const custom = page.getByPlaceholder("Enter UUID format machine ID...");
  await custom.fill("44444444-4444-4444-8444-444444444444");
  await page
    .getByRole("button", { name: "Apply Custom ID", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__machine),
    "11111111-1111-4111-8111-111111111111",
  );
  await page.getByRole("button", { name: "Export to File" }).click();
  await page.getByRole("button", { name: "Import from File" }).click();
  assert.equal(
    await page.evaluate(() => window.__machine),
    "33333333-3333-4333-8333-333333333333",
  );
  for (const label of ["Auto Change on Switch", "Use bound machine ID"])
    await page
      .locator(".ui-setting-row")
      .filter({ has: page.getByText(label, { exact: true }) })
      .getByRole("button")
      .click();
  await page.getByText("Account Machine ID", { exact: true }).click();
  await page.locator(".ui-dialog-panel").waitFor();
  const search = page.getByPlaceholder("Search accounts...");
  await search.fill("Fixture 0");
  assert.equal(
    await page
      .locator(".ui-dialog-body")
      .getByTitle("Edit", { exact: true })
      .count(),
    1,
  );
  await page.getByTitle("Edit", { exact: true }).click();
  await page
    .getByPlaceholder("Enter UUID format machine ID", { exact: true })
    .fill("bound-fixture");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accountMachineIds["fixture-0"];
    }),
    undefined,
  );
  await page.getByTitle("Edit", { exact: true }).click();
  await page
    .getByPlaceholder("Enter UUID format machine ID", { exact: true })
    .fill("bound-fixture");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTitle("Copy", { exact: true }).click();
  assert.equal(await page.evaluate(() => window.__clipboard), "bound-fixture");
  await page.getByTitle("Random", { exact: true }).click();
  await page.getByTitle("Delete", { exact: true }).click();
  await page.locator(".ui-dialog-header").getByRole("button").last().click();
  await page.getByText("Change History", { exact: true }).click();
  assert.ok(
    await page
      .locator(".ui-dialog-body")
      .getByTitle("Copy", { exact: true })
      .count(),
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().machineIdHistory.length;
    }),
    0,
  );
  await page.locator(".ui-dialog-header").getByRole("button").last().click();
  await page.evaluate(() => {
    window.__admin = false;
    window.__machineFail = true;
  });
  await navigate("home");
  await navigate("machineId");
  await page
    .getByRole("button", { name: "Restart as Admin", exact: true })
    .click();
  assert.equal((await calls(page, "machineIdRequestAdminRestart")).length, 1);
  await navigate("settings");
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    const data = s.getState().exportAccounts();
    data.accounts = [
      {
        ...data.accounts[0],
        id: "imported-fixture",
        email: "imported@example.invalid",
        userId: "new-fixture-user",
      },
    ];
    window.__import = { format: "json", content: JSON.stringify(data) };
  });
  await row("Import Data").getByRole("button").click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accounts.size;
    }),
    4,
  );
  await page.evaluate(() => (window.__confirm = true));
  const confirmations = await page.evaluate(
    () => window.__confirmations.length,
  );
  await row("Clear All Data").getByRole("button").click();
  assert.equal(
    await page.evaluate(() => window.__confirmations.length),
    confirmations + 2,
  );
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accounts.size;
    }),
    0,
  );
  await fs.writeFile(`${out}/settings.json`, JSON.stringify(report, null, 2));
  console.log(
    "通过：U01/U02/U08/U10 设置、持久化、内嵌格式与机器码绑定隔离回归",
  );
}
