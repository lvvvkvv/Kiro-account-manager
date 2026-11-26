import assert from "node:assert/strict";
import fs from "node:fs/promises";
const calls = (p, name) =>
  p.evaluate((name) => window.__calls.filter((c) => c.name === name), name);
const store = async (p, fn, args) =>
  p.evaluate(
    async ({ fn, args }) => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState()[fn](...(args || []));
    },
    { fn, args },
  );
export async function verifyTools({ page, navigate, out, setAppearance }) {
  await setAppearance("en", "light");
  await navigate("kiroSettings");
  const report = {};
  await page.getByText("Agent Autonomy", { exact: true }).waitFor();
  const agent = page
    .getByText("Enable Tab Autocomplete", { exact: true })
    .locator("..")
    .locator("..");
  const savedBefore = (await calls(page, "saveKiroSettings")).length;
  await agent.getByRole("switch").click();
  assert.equal((await calls(page, "saveKiroSettings")).length, savedBefore);
  await page.getByText("Command Config", { exact: true }).click();
  await page.getByPlaceholder("e.g.: npm *").fill("npm test");
  await page.getByPlaceholder("e.g.: npm *").press("Enter");
  await page
    .getByPlaceholder("Tool name", { exact: true })
    .fill("fixture-tool");
  await page.getByPlaceholder("Tool name", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const payload = (await calls(page, "saveKiroSettings")).at(-1).args[0];
  assert.ok(payload.enableTabAutocomplete);
  assert.ok(payload.trustedCommands.includes("npm test"));
  assert.ok(payload.trustedTools["fixture-tool"]);
  assert.deepEqual(payload.commandDenylist, ["rm -rf /"]);
  report.kiro = payload;
  for (const name of [
    "Open File",
    "User MCP Config",
    "Workspace MCP Config",
    "Open Steering Folder",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  assert.deepEqual(
    (await calls(page, "openKiroMcpConfig")).map((c) => c.args[0]),
    ["user", "workspace"],
  );
  await page
    .getByRole("button", { name: "Add MCP Server", exact: true })
    .click();
  let dialog = page.locator(".ui-dialog-panel");
  await dialog.getByPlaceholder("e.g.: fetch, exa, context7").fill("added");
  await dialog.getByPlaceholder("e.g.: uvx, npx, node").fill(" node ");
  await dialog.getByPlaceholder("Add argument").fill(" server.js ");
  await dialog.getByPlaceholder("Add argument").press("Enter");
  await dialog
    .getByRole("button", { name: "Add Env Var", exact: true })
    .click();
  await dialog.getByPlaceholder("Key", { exact: true }).fill(" FIXTURE ");
  await dialog.getByPlaceholder("Value", { exact: true }).fill("yes");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  assert.deepEqual((await calls(page, "saveMcpServer")).at(-1).args, [
    "added",
    { command: "node", args: ["server.js"], env: { FIXTURE: "yes" } },
    undefined,
  ]);
  const mcpRow = page
    .getByText("added", { exact: true })
    .locator("..")
    .locator("..");
  await mcpRow.getByTitle("Edit", { exact: true }).click();
  await dialog.getByPlaceholder("e.g.: uvx, npx, node").fill("unsaved");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await calls(page, "saveMcpServer")).length, 1);
  await page.evaluate(() => (window.__confirm = false));
  await mcpRow.getByTitle("Delete", { exact: true }).click();
  assert.equal((await calls(page, "deleteMcpServer")).length, 0);
  await page.evaluate(() => (window.__confirm = true));
  await mcpRow.getByTitle("Delete", { exact: true }).click();
  assert.equal((await calls(page, "deleteMcpServer")).at(-1).args[0], "added");
  await page.getByTitle("Open externally", { exact: true }).click();
  await page.getByTitle("Edit internally", { exact: true }).click();
  await dialog.locator("textarea").fill("# Fixture\nSaved rule");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  assert.deepEqual((await calls(page, "saveKiroSteeringFile")).at(-1).args, [
    "fixture.md",
    "# Fixture\nSaved rule",
  ]);
  await dialog.locator("textarea").fill("unsaved");
  await page.evaluate(() => (window.__confirm = false));
  await dialog.getByRole("button").last().click();
  assert.equal(await dialog.count(), 1);
  await page.evaluate(() => (window.__confirm = true));
  await dialog.getByRole("button").last().click();
  assert.equal(await dialog.count(), 0);
  await page.getByRole("button", { name: "Create Rules", exact: true }).click();
  assert.equal((await calls(page, "createKiroDefaultRules")).length, 1);
  // Six channels and all seven events round-trip without any implicit send on page entry.
  await navigate("webhooks"); // no native integration is used
  assert.equal(await page.evaluate(() => window.__http.length), 0);
  for (const [kind, label] of [
    ["dingtalk", "DingTalk"],
    ["wechat-work", "WeCom"],
    ["feishu", "Feishu"],
    ["telegram", "Telegram"],
    ["discord", "Discord"],
    ["custom", "Custom"],
  ]) {
    await page
      .getByRole("button", { name: "Add Webhook", exact: true })
      .click();
    const edit = page
      .locator(".glass-card")
      .filter({ has: page.getByText("New Webhook", { exact: true }) });
    await edit.getByRole("button", { name: label, exact: true }).click();
    const inputs = edit.locator("input");
    await inputs.nth(0).fill(`Fixture ${kind}`);
    await inputs.nth(1).fill(`https://fixture.example.invalid/${kind}`);
    if (kind === "telegram") await inputs.nth(2).fill("fixture-chat");
    if (kind === "custom")
      await edit.locator("textarea").fill('{"message":"{{message}}"}');
    const events = edit.locator("button[aria-pressed]");
    assert.equal(await events.count(), 7);
    for (const button of await events.all())
      if ((await button.getAttribute("aria-pressed")) === "false")
        await button.click();
    await edit.getByRole("button", { name: "Save", exact: true }).click();
  }
  const hooks = await page.evaluate(async () => {
    const { useWebhookStore: s } = await import("/src/store/webhooks.ts");
    return [...s.getState().webhooks.values()];
  });
  assert.equal(hooks.length, 6);
  assert.ok(hooks.every((h) => h.events.length === 7));
  report.webhooks = hooks;
  assert.equal(await page.evaluate(() => window.__http.length), 0);
  // Toggle, edit/cancel and delete/cancel retain their original state boundaries.
  const firstHook = page
    .getByText(hooks[0].label, { exact: true })
    .locator("..")
    .locator("..")
    .locator("..");
  await firstHook.getByTitle("点击停用", { exact: true }).click();
  await firstHook.getByTitle("点击启用", { exact: true }).click();
  await firstHook.getByRole("button").nth(2).click();
  let editCard = page
    .locator(".glass-card")
    .filter({ has: page.getByText("Edit Webhook", { exact: true }) });
  await editCard
    .locator("input")
    .nth(1)
    .fill("https://fixture.example.invalid/unsaved");
  await editCard.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => (window.__confirm = false));
  await firstHook.getByRole("button").last().click();
  assert.equal(
    await page.evaluate(async () => {
      const { useWebhookStore: s } = await import("/src/store/webhooks.ts");
      return s.getState().webhooks.size;
    }),
    6,
  );
  await page.evaluate(() => (window.__confirm = true));
  // Click the existing test actions in each row; requests are intercepted locally.
  for (const h of hooks) {
    const row = page
      .getByText(h.label, { exact: true })
      .locator("..")
      .locator("..")
      .locator("..");
    await row.getByRole("button").nth(1).click();
    await row.getByText("Test OK", { exact: true }).waitFor();
  }
  assert.equal(await page.evaluate(() => window.__http.length), 6);
  const requests = await page.evaluate(() => window.__http);
  assert.ok(requests.find((r) => r.url.includes("telegram/sendMessage")));
  report.notificationRequests = requests;
  report.existingLogCounter =
    "改前和改后固定样例均保持滚动位置，但追加日志后浮动按钮为 Bottom，新增数量未显示；baseline-log.json 单列证据，未改原轮询与滚动逻辑";
  await navigate("about");
  await navigate("webhooks");
  assert.equal(await page.evaluate(() => window.__http.length), 6);
  // Diagnose network parameters and selected-account postprocessing.
  await store(page, "addProxy", [
    "http://fixture-user:fixture-pass@127.0.0.1:9000",
    { label: "Diagnostic fixture" },
  ]);
  await store(page, "bindAccountToProxy", [
    "fixture-0",
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return [...s.getState().proxyPool.keys()][0];
    }),
  ]);
  await navigate("diagnose");
  const probe = page.getByPlaceholder("https://example.com/health");
  await probe.fill("fixture.example.invalid/health");
  await page
    .getByRole("button", { name: "Run Diagnostics", exact: true })
    .click();
  await page.waitForTimeout(120);
  const runs = await calls(page, "diagnoseRun");
  assert.equal(runs.length, 3);
  assert.equal(runs.flatMap((c) => c.args[0].targets).length, 9);
  assert.equal(
    runs.at(-1).args[0].targets[0].url,
    "https://fixture.example.invalid/health",
  );
  await page.getByRole("button", { name: "Copy Report", exact: true }).click();
  assert.match(
    await page.evaluate(() => window.__clipboard),
    /Fixture unavailable/,
  );
  report.diagnose = runs;
  await page.getByLabel("Test through proxy", { exact: true }).check();
  const networkCard = page
    .locator(".glass-card")
    .filter({ has: page.getByText("Diagnostic Config", { exact: true }) });
  await networkCard.locator("select").selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Run Diagnostics", exact: true })
    .click();
  await page.waitForTimeout(80);
  assert.ok(
    (await calls(page, "diagnoseRun"))
      .slice(-3)
      .every(
        (c) =>
          c.args[0].proxyUrl ===
          "http://fixture-user:fixture-pass@127.0.0.1:9000",
      ),
  );

  const live = page
    .locator(".glass-card")
    .filter({ has: page.getByText("Account Liveness Test", { exact: true }) });
  await live.locator("select").selectOption("fixture-0");
  await page.getByPlaceholder("claude-sonnet-4.5").fill("fixture-model");
  await page
    .getByPlaceholder('Hi, reply with "pong" only.')
    .fill("fixture ping");
  await page.getByRole("button", { name: "Test Now", exact: true }).click();
  await page.waitForTimeout(80);
  assert.equal(
    (await calls(page, "diagnoseAccountLiveness")).at(-1).args[0].message,
    "fixture ping",
  );
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    s.setState({ selectedIds: new Set(["fixture-0", "fixture-1"]) });
  });
  await live.getByRole("button", { name: /^Selected/ }).click();
  await live
    .getByRole("button", { name: "Test Selected (2)", exact: true })
    .click();
  await page.waitForTimeout(100);
  await live
    .getByRole("button", { name: "Retest failed", exact: true })
    .click();
  await page.waitForTimeout(80);
  await live.getByTitle("Retest this account", { exact: true }).first().click();
  await page.waitForTimeout(80);
  // Four selected accounts start at most three workers; Stop prevents the fourth from starting.
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    const accounts = new Map(s.getState().accounts);
    accounts.set("fixture-extra", {
      ...accounts.get("fixture-0"),
      id: "fixture-extra",
      email: "extra@example.invalid",
    });
    s.setState({ accounts, selectedIds: new Set(accounts.keys()) });
    window.__holdLiveness = true;
    window.__pending = [];
  });
  const nBefore = (await calls(page, "diagnoseAccountLiveness")).length;
  await live
    .getByRole("button", { name: "Test Selected (4)", exact: true })
    .click();
  await page.waitForTimeout(100);
  assert.equal(
    (await calls(page, "diagnoseAccountLiveness")).length - nBefore,
    3,
  );
  await live.getByRole("button", { name: "Stop", exact: true }).click();
  await page.evaluate(() => {
    window.__holdLiveness = false;
    window.__pending.splice(0).forEach((r) => r());
  });
  await page.waitForTimeout(100);
  assert.equal(
    (await calls(page, "diagnoseAccountLiveness")).length - nBefore,
    3,
  );
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    const accounts = new Map(s.getState().accounts);
    accounts.delete("fixture-extra");
    s.setState({ accounts, selectedIds: new Set(["fixture-0", "fixture-1"]) });
  });
  await live
    .getByRole("button", { name: "Test Selected (2)", exact: true })
    .click();
  await page.waitForTimeout(80);
  await live.getByRole("button", { name: /Mark.*error/i }).click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accounts.get("fixture-1").lastError;
    }),
    "Fixture unauthorized",
  );
  await page.evaluate(() => (window.__confirm = false));
  await live.getByRole("button", { name: /Delete failed/i }).click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accounts.size;
    }),
    3,
  );
  await page.evaluate(() => (window.__confirm = true));
  await live.getByRole("button", { name: /Delete failed/i }).click();
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      return s.getState().accounts.size;
    }),
    2,
  );
  // Portable config uses its own app marker, mask/credentials options, encryption, and reset scope.
  await navigate("configSync");
  const exportCard = page
    .locator(".glass-card")
    .filter({ has: page.getByText("Export", { exact: true }) })
    .first();
  await exportCard.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForTimeout(80);
  let portable = await page.evaluate(() =>
    JSON.parse(window.__downloads.at(-1).text),
  );
  assert.equal(portable.app, "kiro-account-manager");
  assert.equal(portable.type, undefined);
  assert.ok(portable.proxyPool[0].url.includes("***"));
  assert.equal(portable.proxyPool[0].password, undefined);
  assert.equal(portable.accounts, undefined);
  report.portable = portable;
  const importInput = page.locator("input[type=file]");
  await importInput.setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(portable)),
  });
  await page.getByText("Import Successful", { exact: true }).waitFor();
  const switches = exportCard.getByRole("switch");
  await switches.nth(6).click();
  await exportCard.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForTimeout(80);
  assert.ok(
    await page.evaluate(() =>
      JSON.parse(window.__downloads.at(-1).text).proxyPool[0].url.includes(
        "fixture-pass",
      ),
    ),
  );
  await switches.nth(6).click();
  await switches.nth(7).click();
  await page.getByPlaceholder("Password...").fill("fixture-password");
  await exportCard.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForTimeout(180);
  const encrypted = await page.evaluate(() => window.__downloads.at(-1).text);
  assert.ok(encrypted.startsWith("KCFG1:"));
  await page.evaluate(() => (window.__prompt = "wrong"));
  await importInput.setInputFiles({
    name: "fixture.kcfg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(encrypted),
  });
  await page.getByText("Import Failed", { exact: true }).waitFor();
  await page.evaluate(() => (window.__prompt = null));
  await importInput.setInputFiles({
    name: "cancel.kcfg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(encrypted),
  });
  await page.evaluate(() => (window.__prompt = "fixture-password"));
  await importInput.setInputFiles({
    name: "correct.kcfg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(encrypted),
  });
  await page.getByText("Import Successful", { exact: true }).waitFor();
  const resetKeys = [
    "kiro-register-ratelimit-enabled",
    "kiro-register-ratelimit-max",
    "kiro-register-autobackoff",
    "kiro-register-dailyquota-limit",
    "kiro-register-schedule-enabled",
    "kiro-register-schedule-time",
    "kiro-register-mixed-sources",
    "kiro-register-templates",
    "kiro-register-email-blacklist",
  ];
  await page.evaluate((keys) => {
    for (const k of keys) localStorage.setItem(k, "fixture");
    localStorage.setItem("kiro-register-config", '{"keep":true}');
    window.__confirm = false;
  }, resetKeys);
  await page
    .getByRole("button", { name: "Reset Register Preferences", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kiro-register-templates")),
    "fixture",
  );
  await page.evaluate(() => (window.__confirm = true));
  await page
    .getByRole("button", { name: "Reset Register Preferences", exact: true })
    .click();
  assert.deepEqual(
    await page.evaluate(
      (keys) => keys.map((k) => localStorage.getItem(k)),
      resetKeys,
    ),
    resetKeys.map(() => null),
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("kiro-register-config")),
    '{"keep":true}',
  );
  // Logs retain filtering, detail, download, polling, and read-history behavior.
  await navigate("logs");
  await page.waitForTimeout(100);
  const search = page.getByPlaceholder("Filter by message, category...");
  await page.locator("select").nth(0).selectOption("1h");
  await page.locator("select").nth(1).selectOption("Kiro");
  await page.getByRole("button", { name: /^ERROR 25$/ }).click();
  await search.fill("Fixture log 99");
  assert.ok(await page.getByText("Fixture log 99", { exact: true }).count());
  await page.getByText("Fixture log 99", { exact: true }).click();
  await page.getByText('"fixture": "detail"', { exact: false }).waitFor();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForTimeout(80);
  const logExport = await page.evaluate(() => window.__downloads.at(-1).text);
  assert.match(logExport, /Fixture log 99/);
  assert.equal(logExport.split("\n").length, 1);
  await search.fill("");
  await page.getByRole("button", { name: /^All 100$/ }).click();
  await page.locator("select").nth(1).selectOption("all");
  await page.locator("select").nth(0).selectOption("all");
  await page.locator("select").nth(2).selectOption("10000");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("systemLogs_displayLimit")),
    "10000",
  );
  await navigate("home");
  await navigate("logs");
  await page.waitForTimeout(300);
  const scroll = page.locator("div.h-full.overflow-y-auto.font-mono");
  await scroll.evaluate((e) => {
    e.scrollTop = 0;
    e.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(200);
  await page.getByText("Scrolled up", { exact: true }).waitFor();
  await page.evaluate(() =>
    window.__logs.push({
      timestamp: new Date().toISOString(),
      level: "INFO",
      category: "Kiro",
      message: "Fixture new entry",
    }),
  );
  await page.waitForTimeout(1700);
  assert.equal(await scroll.evaluate((e) => e.scrollTop), 0);
  await page.getByText("Showing", { exact: false }).last().waitFor();
  await page.getByRole("button", { name: "Bottom", exact: true }).click();
  await page.getByText("Following", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear All", exact: true }).click();
  assert.equal((await calls(page, "proxyClearLogs")).length, 1);
  // Manual about updates preserve failure/retry, release URL and QR content.
  await navigate("about");
  assert.equal((await calls(page, "checkForUpdatesManual")).length, 0);
  await page
    .getByRole("button", { name: "Check Updates", exact: true })
    .click();
  await page.getByText("Fixture update failed", { exact: false }).waitFor();
  await page.getByRole("button", { name: /Retry/ }).click();
  assert.equal((await calls(page, "checkForUpdatesManual")).length, 2);
  await navigate("home");
  await page.evaluate(
    () =>
      (window.__update = {
        hasUpdate: true,
        currentVersion: "1.7.6",
        latestVersion: "9.9.9",
        releaseName: "Fixture release",
        releaseUrl: "https://fixture.example.invalid/release",
        releaseNotes: "Fixture notes",
        assets: [
          {
            name: "fixture.zip",
            size: 2048,
            downloadUrl: "https://fixture.example.invalid/file",
          },
        ],
      }),
  );
  await navigate("about");
  await page
    .getByRole("button", { name: "Check Updates", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: /Go to.*Download|Download.*GitHub|View Release/i,
    })
    .click();
  assert.equal(
    (await calls(page, "openExternal")).at(-1).args[0],
    "https://fixture.example.invalid/release",
  );
  await navigate("home");
  await navigate("about");
  await page.getByRole("button", { name: "Join Group", exact: true }).click();
  assert.equal(
    await page.locator(".ui-dialog-panel img[alt=Group]").count(),
    1,
  );
  await fs.writeFile(`${out}/tools.json`, JSON.stringify(report, null, 2));
  console.log(
    "通过：U03–U07/U09 Kiro、Webhook、诊断、配置加解密、日志、关于隔离回归",
  );
}
