import assert from "node:assert/strict";
const calls = async (page, name) =>
  page.evaluate(
    (name) => window.__calls.filter((c) => c.name === name).map((c) => c.args),
    name,
  );
const field = (page, label) =>
  page
    .locator("label")
    .filter({ hasText: label })
    .first()
    .locator("..")
    .locator("input,textarea")
    .first();
const click = async (page, name) =>
  page.getByRole("button", { name, exact: true }).click();
export async function verifyProxy({ page, out, navigate }) {
  await navigate("proxy");
  const port = page.locator("#port");
  await port.fill("5599");
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { port: 5599 },
  ]);
  await page.locator("#host").fill("127.0.0.2");
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { host: "127.0.0.2" },
  ]);
  await page.locator("#apiKey").fill("sk-ui-fixture");
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { apiKey: "sk-ui-fixture" },
  ]);
  await page.locator("#autoStart").click();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { autoStart: true },
  ]);
  for (const [id, value, key, expected] of [
    ["maxRetries", "5", "maxRetries", 5],
    ["payloadSizeLimit", "2048", "payloadSizeLimitKB", 2048],
  ]) {
    await page.locator("#" + id).fill(value);
    assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
      { [key]: expected },
    ]);
  }
  for (const [id, key] of [
    ["clientDrivenToolExecution", "clientDrivenToolExecution"],
    ["disableTools", "disableTools"],
    ["enableTokenBufferReserve", "enableTokenBufferReserve"],
  ]) {
    await page.locator("#" + id).click();
    const last = (await calls(page, "proxyUpdateConfig")).at(-1)[0];
    assert.equal(typeof last[key], "boolean");
  }
  await page.locator("#tokenBufferReserve").fill("24000");
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { tokenBufferReserve: 24000 },
  ]);
  const workspace = page.getByPlaceholder("e.g. C:/Projects/my-app (optional)");
  const n = (await calls(page, "proxyUpdateConfig")).length;
  await workspace.fill("/fixture/project");
  assert.equal((await calls(page, "proxyUpdateConfig")).length, n);
  await workspace.blur();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { workspacePath: "/fixture/project" },
  ]);
  // Public Select uses its existing listbox; endpoint and agent values are unchanged.
  await click(page, "Auto Select");
  await page.getByRole("option", { name: /AmazonQ CLI/ }).click();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { preferredEndpoint: "amazonq-cli" },
  ]);
  await click(page, "Vibe");
  await page.getByRole("option", { name: /^Spec/ }).click();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { agentMode: "spec" },
  ]);
  await click(page, "Sticky");
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { accountSelectionStrategy: "sticky" },
  ]);
  await click(page, "Specific Groups");
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { multiAccountSelectionMode: "groups" },
  ]);
  await page.getByRole("button", { name: /Fixture Group/ }).click();
  await page.waitForTimeout(150);
  assert.deepEqual(
    (await calls(page, "proxySyncAccounts")).at(-1)[0].map((a) => a.id),
    ["fixture-0"],
  );
  await page.locator("#multiAccount").click();
  await click(page, "First Available");
  const ad = page.getByRole("dialog", { name: "Select Account" });
  await ad
    .getByPlaceholder("Search by email, ID or subscription...")
    .fill("fixture1");
  await ad.getByText("fixture1@example.invalid", { exact: true }).click();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { selectedAccountIds: ["fixture-1"] },
  ]);
  await page.locator("#autoSwitchOnQuotaExhausted").click();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { autoSwitchOnQuotaExhausted: true },
  ]);
  await click(page, "Start Service");
  await page
    .getByRole("button", { name: "Stop Service", exact: true })
    .waitFor();
  assert.equal((await calls(page, "proxyStart")).at(-1)[0].port, 5599);
  assert.equal(await port.isDisabled(), true);
  // The original public-host toggle performs stop + start while running; no extra restart added.
  const stops = (await calls(page, "proxyStop")).length;
  await page.locator("#publicAccess").click();
  await page.waitForTimeout(400);
  assert.equal((await calls(page, "proxyStop")).length, stops + 1);
  assert.deepEqual((await calls(page, "proxyStart")).at(-1), []);
  await page.getByTitle("Copy address", { exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "http://localhost:5599",
  );
  for (const id of ["logRequests", "logStreamEvents"]) {
    await page.locator("#" + id).click();
    assert.equal(
      Object.keys((await calls(page, "proxyUpdateConfig")).at(-1)[0])[0],
      id,
    );
  }
  await click(page, "Refresh Models");
  assert.ok((await calls(page, "proxyRefreshModels")).length);
  await click(page, "View Models");
  let d = page.getByRole("dialog", { name: "Available Models" });
  await d.getByText("claude-fixture", { exact: true }).waitFor();
  await d.screenshot({ path: `${out}/models.png` });
  await d.getByRole("button", { name: "Mapping", exact: true }).click();
  d = page.getByRole("dialog", { name: "Model Mapping" });
  await d.getByRole("button", { name: "Add Rule", exact: true }).click();
  await d.getByPlaceholder("Enter rule name").fill("UI rule");
  await d.getByPlaceholder("e.g., claude-*, gpt-4, my-alias").fill("fixture-*");
  await d.getByPlaceholder("Target model name").fill("claude-fixture");
  await d.locator("select").first().selectOption("loadbalance");
  await d.getByRole("button", { name: "Add", exact: true }).click();
  await d.getByPlaceholder("Target model name").nth(1).fill("fixture-second");
  await d.locator("input[type=number]").nth(1).fill("3");
  await d.screenshot({ path: `${out}/mapping.png` });
  await d.getByRole("button", { name: "Save", exact: true }).click();
  const mapping = (await calls(page, "proxyUpdateConfig")).at(-1)[0]
    .modelMappings[0];
  assert.equal(mapping.name, "UI rule");
  assert.equal(mapping.type, "loadbalance");
  assert.deepEqual(mapping.targetModels, ["claude-fixture", "fixture-second"]);
  assert.deepEqual(mapping.weights, [1, 3]);
  await click(page, "Configure Clients");
  d = page.getByRole("dialog", { name: "One-Click Client Configuration" });
  await d
    .getByRole("button", { name: "Apply Configuration", exact: true })
    .waitFor();
  await d.getByText("Claude Code", { exact: true }).click();
  await d
    .getByRole("button", { name: "Apply Configuration", exact: true })
    .click();
  await d.getByText("Configured", { exact: true }).first().waitFor();
  const apply = (await calls(page, "proxyConfigureClients")).at(-1)[0];
  assert.equal(apply.modelId, "claude-fixture");
  assert.deepEqual(apply.clients, [
    "opencode",
    "codex",
    "gemini",
    "hermes",
    "openclaw",
  ]);
  assert.deepEqual(apply.models[0].inputTypes, ["TEXT", "IMAGE"]);
  await d.screenshot({ path: `${out}/clients.png` });
  await d.getByTitle("Close", { exact: true }).click();
  // Security local IP edits apply only on blur, the original numeric conversions remain.
  await page
    .getByText("Security & Observability (v1.8)", { exact: true })
    .click();
  for (const [label, value, key, expected] of [
    ["Max body size (MB)", "12", "maxRequestBodyBytes", 12 * 1024 * 1024],
    ["Rate limit (req/min per Key)", "22", "rateLimitPerKeyPerMinute", 22],
    ["Recent requests limit", "200", "recentRequestsLimit", 200],
    ["Keep-alive timeout (sec)", "75", "keepAliveTimeoutMs", 75000],
  ]) {
    await field(page, label).fill(value);
    assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
      { [key]: expected },
    ]);
  }
  const ip = field(page, "Allowed IPs (whitelist)");
  const ipN = (await calls(page, "proxyUpdateConfig")).length;
  await ip.fill(" 192.0.2.1\n10.0.0.0/8\n");
  assert.equal((await calls(page, "proxyUpdateConfig")).length, ipN);
  await ip.blur();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { allowedIPs: ["192.0.2.1", "10.0.0.0/8"] },
  ]);
  await field(page, "Denied IPs (blacklist)").fill("198.51.100.1");
  await field(page, "Denied IPs (blacklist)").blur();
  assert.deepEqual((await calls(page, "proxyUpdateConfig")).at(-1), [
    { deniedIPs: ["198.51.100.1"] },
  ]);
  for (const label of [
    "Session affinity",
    "Prometheus /metrics",
    "Audit log",
  ]) {
    const sw = page
      .locator("label")
      .filter({ hasText: label })
      .first()
      .locator("..")
      .locator("..")
      .getByRole("switch");
    await sw.click();
  }
  await click(page, "Show details");
  await page.getByText("CN=fixture.invalid", { exact: true }).waitFor();
  await page.evaluate(() => (window.__confirmResult = false));
  await click(page, "Regenerate");
  assert.equal((await calls(page, "proxySelfSignedCertRegenerate")).length, 0);
  await page.evaluate(() => (window.__confirmResult = true));
  await click(page, "Regenerate");
  assert.equal((await calls(page, "proxySelfSignedCertRegenerate")).length, 1);
  await click(page, "Copy PEM");
  assert.match(
    await page.evaluate(() => window.__clipboard),
    /BEGIN CERTIFICATE/,
  );
  await page.evaluate(() => (window.__confirmResult = false));
  await click(page, "Restart Now");
  assert.equal((await calls(page, "proxyRestart")).length, 0);
  await page.evaluate(() => {
    window.__confirmResult = true;
    window.__fail.proxyRestart = "Fixture restart failure";
  });
  await click(page, "Restart Now");
  assert.ok(
    (await page.evaluate(() => window.__alerts)).some((s) =>
      s.includes("Fixture restart failure"),
    ),
  );
  await page.evaluate(() => delete window.__fail.proxyRestart);
  await click(page, "Restart Now");
  await click(page, "View");
  await page.getByText("config", { exact: true }).waitFor();
  // Independent request-log reset ranges and error details.
  await click(page, "View All");
  d = page.getByRole("dialog", { name: "Request Logs" });
  await d.getByText("500", { exact: true }).click();
  await d.getByText("Fixture request error", { exact: true }).waitFor();
  const reset = d.getByTitle("Reset total", { exact: true });
  await reset.nth(0).click();
  assert.equal((await calls(page, "proxyResetTokens")).length, 1);
  assert.equal((await calls(page, "proxyResetCredits")).length, 0);
  await reset.nth(1).click();
  assert.equal((await calls(page, "proxyResetCredits")).length, 1);
  await d.getByRole("button", { name: "Clear", exact: true }).click();
  assert.deepEqual((await calls(page, "proxySaveLogs")).at(-1), [[]]);
  await d.getByTitle("Close", { exact: true }).click();
  // Detailed logs can be opened directly after one response restores recent-request entry.
  await page.evaluate(() =>
    window.__emit("onProxyResponse", {
      path: "/v1/messages",
      status: 200,
      model: "claude-fixture",
    }),
  );
  await click(page, "Detailed Logs");
  d = page.getByRole("dialog", { name: "Proxy Detailed Logs" });
  await d.getByText("Fixture detailed error", { exact: true }).waitFor();
  await d.getByTitle("Toggle details").first().click();
  await d.getByText(/"detail": "Fixture data"/).waitFor();
  await d.getByTitle("Copy log").first().click();
  assert.match(await page.evaluate(() => window.__clipboard), /Fixture data/);
  await d.getByPlaceholder("Search logs...").fill("Fixture success");
  await page.waitForTimeout(100);
  assert.equal(
    await d.getByText("Fixture detailed error", { exact: true }).count(),
    0,
  );
  await d.getByTitle("Clear logs", { exact: true }).click();
  assert.equal((await calls(page, "proxyClearLogs")).length, 1);
  await d.getByTitle("Close", { exact: true }).click();
  await click(page, "Stop Service");
  assert.equal((await calls(page, "proxyStop")).length, 2);
  // API key management preserves creation formats, quotas, visibility, deletion confirmation and usage tabs.
  await page.getByTitle("Manage Multiple API Keys").click();
  d = page.getByRole("dialog", { name: "API Key Management", exact: true });
  await d.getByText("Fixture key", { exact: true }).click();
  await d.getByRole("button", { name: "View Details", exact: true }).click();
  const ud = page.getByRole("dialog", { name: "Usage Details", exact: true });
  for (const name of ["By Model", "Daily Stats", "History"])
    await ud.getByRole("tab", { name, exact: true }).click();
  await ud.screenshot({ path: `${out}/usage.png` });
  await ud.getByTitle("Close", { exact: true }).click();
  await d.getByPlaceholder("Key name...").fill("New key");
  await d.getByPlaceholder("Credits limit (optional)").fill("18");
  await d.getByRole("button", { name: "sk-xxx", exact: true }).click();
  await page.getByRole("option", { name: "PROXY_KEY", exact: true }).click();
  await d.getByRole("button", { name: "Add", exact: true }).click();
  assert.deepEqual((await calls(page, "proxyAddApiKey")).at(-1), [
    { name: "New key", format: "simple", creditsLimit: 18 },
  ]);
  await d.getByText("New key", { exact: true }).click();
  const limit = d.getByPlaceholder("Unlimited");
  await limit.fill("25");
  assert.deepEqual((await calls(page, "proxyUpdateApiKey")).at(-1), [
    "key-1",
    { creditsLimit: 25 },
  ]);
  const newRow = d
    .getByText("New key", { exact: true })
    .locator("..")
    .locator("..");
  await newRow.getByTitle("Show or hide key", { exact: true }).click();
  await newRow.getByText("simple-fixture-generated", { exact: true }).waitFor();
  await newRow.getByTitle("Copy key", { exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "simple-fixture-generated",
  );
  await newRow.getByRole("switch").click();
  assert.deepEqual((await calls(page, "proxyUpdateApiKey")).at(-1), [
    "key-1",
    { enabled: false },
  ]);
  await page.evaluate(() => (window.__confirmResult = false));
  await newRow.getByTitle("Delete key", { exact: true }).click();
  assert.equal((await calls(page, "proxyDeleteApiKey")).length, 0);
  await d.getByRole("button", { name: "Reset Usage", exact: true }).click();
  assert.equal((await calls(page, "proxyResetApiKeyUsage")).length, 0);
  await page.evaluate(() => (window.__confirmResult = true));
  await d.getByRole("button", { name: "Reset Usage", exact: true }).click();
  assert.deepEqual((await calls(page, "proxyResetApiKeyUsage")).at(-1), [
    "key-1",
  ]);
  await newRow.getByTitle("Delete key", { exact: true }).click();
  assert.deepEqual((await calls(page, "proxyDeleteApiKey")).at(-1), ["key-1"]);
  await d.getByTitle("Close", { exact: true }).click();
  await page.screenshot({ path: `${out}/proxy-final.png` });
  console.log(
    "通过：P01–P05 配置/启停/重启、账号范围、模型映射、客户端目标、密钥与独立日志操作",
  );
}
