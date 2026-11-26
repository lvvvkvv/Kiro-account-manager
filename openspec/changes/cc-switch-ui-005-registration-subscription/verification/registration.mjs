import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  button,
  field,
  calls,
  reset,
  until,
  idle,
  assertCall,
} from "./helpers.mjs";
export async function verifyRegistration(ctx) {
  const { page, out, navigate } = ctx,
    report = [];
  // R01: all sources keep credentials/disabled behavior and auto request payloads.
  for (const [mode, label, expected] of [
    ["outlook", "Outlook", { useOutlook: true }],
    [
      "tempmail",
      "TempMail",
      {
        useTempMailPlus: true,
        tempMailPlusEmail: "inbox@example.invalid",
        tempMailPlusEpin: "fake-epin",
        tempMailPlusDomain: "temp.example.invalid",
      },
    ],
    ["proton", "Proton", { useProton: true }],
    [
      "gptmail",
      "GPTmail",
      {
        useGptMail: true,
        gptMailDomain: "gpt.example.invalid",
        gptMailPrivatePassword: "fake-private",
        gptMailInboxEmail: "",
        gptMailBaseURL: "https://example.invalid/mail",
        gptMailPrefix: "fixture",
      },
    ],
  ]) {
    await reset(ctx, { mode });
    if (mode === "proton") {
      await button(page, "Login Proton").click();
      await button(page, "Check status").click();
      await page.getByText("● Logged in", { exact: true }).waitFor();
    }
    await button(page, "Start Registration").click();
    const config = (await calls(page, "registrationStartAuto")).at(-1).args[0];
    for (const [k, v] of Object.entries(expected))
      assert.deepEqual(config[k], v);
    if (mode === "proton")
      assert.match(config.protonEmail, /^f.*@protonmail.com$/);
    if (mode === "outlook")
      assert.match(config.outlookData, /one@example.invalid/);
    await button(page, "Cancel").click();
    assert.equal((await calls(page, "registrationCancel")).length, 1);
    report.push({ id: "R01", mode, keys: Object.keys(config) });
  }
  await reset(ctx, {
    mode: "gptmail",
    gptMailInboxEmail: "receiver@example.invalid",
  });
  await button(page, "Start Registration").click();
  assert.equal(
    (await calls(page, "registrationStartAuto")).at(-1).args[0]
      .gptMailInboxEmail,
    "receiver@example.invalid",
  );
  await button(page, "Cancel").click();
  await reset(
    ctx,
    { mode: "mixed" },
    {
      "kiro-register-mixed-sources": ["tempmail", "gptmail"],
      "kiro-register-mixed-weights": {
        tempmail: 3,
        gptmail: 1,
        outlook: 1,
        proton: 1,
      },
    },
  );
  assert.equal(
    await field(page, "Private domain password").inputValue(),
    "fake-private",
  );
  assert.equal(
    (
      await page
        .locator("input[type=password]")
        .evaluateAll((es) => es.map((e) => e.value))
    ).includes("fake-epin"),
    true,
  );
  await button(page, "Start Batch").click();
  await idle(page);
  const mixed = await calls(page, "registrationStartAuto");
  assert.equal(mixed.length, 2);
  assert.ok(
    mixed.every((c) => c.args[0].useTempMailPlus || c.args[0].useGptMail),
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("kiro-register-mixed-weights"))
          .tempmail,
    ),
    3,
  );
  report.push({
    id: "R01",
    mode: "mixed",
    payloads: mixed.map((c) => Object.keys(c.args[0])),
  });
  // R02: explicit phase sequence; an empty OTP never submits itself.
  await reset(ctx);
  await page.evaluate(() => (window.__reg.phaseFailure = "init"));
  await button(page, "Start Registration").click();
  await button(page, "Start Registration").waitFor();
  assert.equal((await calls(page, "registrationManualPhase2")).length, 0);
  await page.evaluate(() => (window.__reg.phaseFailure = ""));
  await button(page, "Start Registration").click();
  await field(page, /^Email$/).fill("manual@example.invalid");
  await button(page, "Submit Email").click();
  assert.equal((await calls(page, "registrationManualPhase3")).length, 0);
  await button(page, "Submit Code").click();
  assert.equal((await calls(page, "registrationManualPhase3")).length, 0);
  await page.locator('input[maxlength="6"]').fill("123456");
  await button(page, "Submit Code").click();
  await button(page, "New Registration").waitFor();
  await assertCall(page, "registrationManualPhase1", [
    { fullName: "Fixture Person" },
  ]);
  await assertCall(page, "registrationManualPhase2", [
    "manual@example.invalid",
    "Fixture Person",
  ]);
  await assertCall(page, "registrationManualPhase3", ["123456"]);
  await button(page, "Import to Manager").click();
  await until(page, async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    return [...useAccountsStore.getState().accounts.values()].some(
      (a) => a.email === "registered@example.invalid",
    );
  });
  report.push({
    id: "R02",
    flow: "init failure → email → empty OTP blocked → OTP → result → explicit import",
  });
  await reset(ctx, {
    batchAutoImport: true,
    autoFetchProLink: true,
    manualParentEmail: "parent@example.invalid",
  });
  await button(page, "Start Registration").click();
  await page.locator('input[maxlength="6"]').waitFor();
  await page.locator('input[maxlength="6"]').fill("654321");
  await button(page, "Submit Code").click();
  await button(page, "New Registration").waitFor();
  assert.equal((await calls(page, "verifyAccountCredentials")).length, 1);
  assert.equal((await calls(page, "accountGetSubscriptionUrl")).length, 1);
  await navigate("subscription");
  await button(page, "Subscription Links").click();
  await page.getByText("registered@example.invalid", { exact: true }).waitFor();
  await navigate("register");
  await button(page, "New Registration").waitFor();
  assert.equal(
    await page.evaluate(() => window.__listeners.onRegistrationStep.length),
    1,
  );
  assert.equal(
    await page.evaluate(() => window.__listeners.onRegistrationLog.length),
    1,
  );
  report.push({
    id: "S04",
    flow: "auto import + subscription append/update + page round trip",
  });
  // R03: pause/resume controls and stop boundary, including events received while unmounted.
  await reset(ctx, { mode: "gptmail", batchCount: 3 });
  await page.evaluate(() => (window.__reg.hold = true));
  await button(page, "Start Batch").click();
  await until(page, () => window.__reg.pending.length === 1);
  await button(page, "Pause").click();
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(450);
  assert.equal((await calls(page, "registrationStartAuto")).length, 1);
  await navigate("home");
  await page.evaluate(() =>
    window.__emit("onRegistrationLog", "Fixture off-page log"),
  );
  await navigate("register");
  await page.getByText(/Fixture off-page log/).waitFor();
  // Actual Task Center controls use the original callbacks; closing drawer leaves work active.
  await page.getByTitle("Task Center", { exact: true }).click();
  await button(page, "Resume").last().click();
  await until(page, () => window.__reg.pending.length === 1);
  const close = page.getByRole("button", { name: "Close", exact: true });
  await close.click();
  assert.equal((await calls(page, "registrationCancel")).length, 0);
  await page.getByTitle("Task Center", { exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  await idle(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal((await calls(page, "registrationStartAuto")).length, 2);
  await reset(ctx, { mode: "gptmail", batchCount: 3 });
  await page.evaluate(() => (window.__reg.hold = true));
  await button(page, "Start Batch").click();
  await until(page, () => window.__reg.pending.length === 1);
  await button(page, "Pause").click();
  await button(page, "Stop Batch").click();
  await idle(page);
  assert.equal((await calls(page, "registrationStartAuto")).length, 1);
  assert.ok((await calls(page, "registrationCancel")).length >= 1);
  report.push({
    id: "R03/R05",
    flow: "pause → drain in-flight → off-page log → Task Center resume → close drawer → Task Center cancel; separate pause → stop cancels in-flight",
  });
  // R03/R05: failure diagnosis/class retry keeps other results; retry updates history and linked result.
  await reset(ctx, { mode: "gptmail", batchCount: 3 });
  await page.evaluate(
    () =>
      (window.__reg.outcomes = [
        {
          success: true,
          result: {
            status: "failed",
            email: "network@example.invalid",
            error: "network timeout",
          },
        },
        {
          success: true,
          result: {
            status: "failed",
            email: "used@example.invalid",
            error: "email already exists",
          },
        },
        { success: true, result: window.__result("ok@example.invalid") },
      ]),
  );
  await button(page, "Start Batch").click();
  await idle(page);
  await page.getByText("2 tasks failed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "诊断", exact: true }).first().click();
  await page.getByText("可能原因：", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Network error (1)", exact: true })
    .click();
  await idle(page);
  assert.equal((await calls(page, "registrationStartAuto")).length, 4);
  const blacklist = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kiro-register-email-blacklist")),
  );
  assert.ok(blacklist.includes("used@example.invalid"));
  // Add fixed history to show metrics, CSV, charts and re-import; reload is the original persistence boundary.
  await page.evaluate(() => {
    const history = JSON.parse(localStorage.getItem("kiro-register-history"));
    while (history.length < 5)
      history.push({ ...history[0], id: `fixture-h-${history.length}` });
    localStorage.setItem("kiro-register-history", JSON.stringify(history));
  });
  await navigate("home");
  await navigate("register");
  await button(page, "CSV").click();
  await until(page, () =>
    window.__downloads.some((d) => d.type.startsWith("text/csv")),
  );
  const csv = await page.evaluate(
    () => window.__downloads.find((d) => d.type.startsWith("text/csv")).text,
  );
  assert.ok(csv.startsWith("time,email,status,error,password\n"));
  assert.ok(csv.includes("used@example.invalid"));
  report.push({
    id: "R05",
    flow: "diagnosis + network-only retry + blacklist + 5 sample analytics + exact CSV header",
  });
  const historyCard = page
    .locator(".glass-card")
    .filter({ has: page.getByText(/Registration History \(5\)/) })
    .last();
  await historyCard.getByText("Import", { exact: true }).first().click();
  await until(page, () =>
    window.__calls.some((c) => c.name === "verifyAccountCredentials"),
  );
  await page.getByRole("button", { name: /Used-email blacklist/ }).click();
  await page.getByPlaceholder("Search email...").fill("used@");
  await page.getByTitle("Remove from blacklist", { exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("kiro-register-email-blacklist"),
      ).includes("used@example.invalid"),
    ),
    false,
  );
  if (!process.env.UI_BEFORE) {
    const sizes = await page.evaluate(() => ({
      metrics: [...document.querySelectorAll(".text-metric")].map((e) => {
        const s = getComputedStyle(e);
        return [s.fontSize, s.lineHeight, s.fontWeight];
      }),
      fingerprints: [...document.querySelectorAll('[title^="Chrome "]')].map(
        (e) => {
          const s = getComputedStyle(e);
          return {
            h: e.getBoundingClientRect().height,
            w: e.getBoundingClientRect().width,
            r: s.borderRadius,
            size: s.fontSize,
            line: s.lineHeight,
          };
        },
      ),
    }));
    assert.ok(sizes.metrics.length >= 3);
    for (const m of sizes.metrics) assert.deepEqual(m, ["24px", "32px", "600"]);
    assert.ok(sizes.fingerprints.length > 0);
    for (const f of sizes.fingerprints) {
      assert.equal(f.h, 20);
      assert.ok(f.w <= 180);
      assert.equal(f.size, "11px");
      assert.equal(f.line, "16px");
    }
    await page.screenshot({
      path: `${out}/registration-history-analytics.png`,
    });
  }
  // R04: settings, template save/load/export, weekdays and quota use existing keys.
  await reset(
    ctx,
    { mode: "gptmail" },
    {
      "kiro-register-schedule-week-mask": "62",
      "kiro-register-dailyquota-limit": "4",
      "kiro-register-mixed-weights": {
        outlook: 2,
        tempmail: 1,
        proton: 1,
        gptmail: 1,
      },
    },
  );
  await page.getByRole("button", { name: /Templates \(0\)/ }).click();
  await button(page, "Save current").click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("kiro-register-templates")).length,
    ),
    1,
  );
  await page
    .getByRole("button", { name: "Export all templates", exact: true })
    .click();
  await until(page, () =>
    window.__downloads.some((d) => d.type === "application/json"),
  );
  const exported = await page.evaluate(() =>
    JSON.parse(
      window.__downloads.find((d) => d.type === "application/json").text,
    ),
  );
  assert.equal(exported[0].config.gptMailPrivatePassword, "fake-private");
  assert.equal(exported[0].config.batchCount, 2);
  await page.getByRole("button", { name: /Fixture template/ }).click();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("kiro-register-schedule-week-mask"),
    ),
    "62",
  );
  await page.getByRole("button", { name: /Templates \(1\)/ }).click();
  const imported = [
    { ...exported[0], id: "fixture-import", name: "Imported template" },
    { ...exported[0], name: "Updated duplicate" },
  ];
  await page.locator("input[type=file]").setInputFiles({
    name: "templates.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await until(
    page,
    () =>
      JSON.parse(localStorage.getItem("kiro-register-templates")).length === 2,
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("kiro-register-templates")).find(
          (t) => t.id !== "fixture-import",
        ).name,
    ),
    "Updated duplicate",
  );
  await page.waitForTimeout(100);
  if (!process.env.UI_BEFORE)
    assert.equal(await page.locator("input[type=file]").inputValue(), "");
  report.push({
    id: "R04",
    templateImport:
      "JSON import merges by ID with file priority; both original fields and format preserved",
  });

  // Existing quota blocks before creating an IPC task.
  const now = new Date();
  const key = `kiro-register-quota-${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  await reset(
    ctx,
    { mode: "gptmail" },
    { "kiro-register-dailyquota-limit": "1", [key]: "1" },
  );
  await button(page, "Start Batch").click();
  assert.equal((await calls(page, "registrationStartAuto")).length, 0);
  assert.ok(
    (await page.evaluate(() => window.__alerts)).some((t) =>
      t.includes("配额"),
    ),
  );
  // An immediately matching clock is ignored when its weekday is excluded.
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  await reset(
    ctx,
    { mode: "gptmail" },
    {
      "kiro-register-schedule-enabled": "1",
      "kiro-register-schedule-time": time,
      "kiro-register-schedule-week-mask": "0",
    },
  );
  assert.equal((await calls(page, "registrationStartAuto")).length, 0);
  report.push({
    id: "R04",
    flow: "template config/export/apply + original schedule mask + full quota prevents launch + excluded weekday skips matching time",
  });
  const clock = await page.evaluate(() => {
    const d = new Date();
    return {
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      mask: String(1 << d.getDay()),
      quota: `kiro-register-quota-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    };
  });
  await reset(
    ctx,
    { mode: "gptmail" },
    {
      "kiro-register-schedule-enabled": "1",
      "kiro-register-schedule-time": clock.time,
      "kiro-register-schedule-week-mask": clock.mask,
      "kiro-register-dailyquota-limit": "3",
    },
  );
  await until(
    page,
    () =>
      window.__calls.filter((c) => c.name === "registrationStartAuto")
        .length === 2,
  );
  await button(page, "Start Batch").waitFor();
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), clock.quota),
    "2",
  );
  report.push({
    id: "R04",
    flow: "matching time + allowed weekday launches once; two successful accounts consume original daily quota key",
  });
  // R03: configured rate/burst/backoff, automatic risk pause, retry and per-account proxy sessions.
  await reset(
    ctx,
    { mode: "gptmail", batchCount: 3 },
    {
      "kiro-register-ratelimit-enabled": "1",
      "kiro-register-ratelimit-max": "300",
      "kiro-register-ratelimit-burst": "3",
      "kiro-register-backoff-base-sec": "1",
      "kiro-register-backoff-max-sec": "2",
      "kiro-register-autopause-risk": "1",
    },
  );
  await page.evaluate(
    () =>
      (window.__reg.outcomes = [
        {
          success: true,
          result: {
            status: "failed",
            email: "risk@example.invalid",
            error: "AWS-risk-control",
          },
        },
      ]),
  );
  await button(page, "Start Batch").click();
  await button(page, "Resume").waitFor();
  assert.equal((await calls(page, "registrationStartAuto")).length, 1);
  await button(page, "Resume").click();
  await idle(page);
  assert.equal((await calls(page, "registrationStartAuto")).length, 3);
  await page.getByText(/300\/分钟 burst=3/).waitFor();
  await reset(ctx, { mode: "gptmail", batchCount: 1, batchRetries: 1 });
  await page.evaluate(async () => {
    window.__reg.outcomes = [
      {
        success: true,
        result: {
          status: "failed",
          email: "retry@example.invalid",
          error: "network timeout",
        },
      },
    ];
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const store = useAccountsStore.getState();
    store.addProxy("http://fixture_area-us:fake-password@192.0.2.1:8080");
    useAccountsStore.setState({
      proxyPoolConfig: {
        ...store.proxyPoolConfig,
        enabled: true,
        upstreamProxy: "socks5://192.0.2.2:1080",
      },
    });
  });
  await button(page, "Start Batch").click();
  await idle(page);
  const proxyCalls = await calls(page, "registrationStartAuto");
  assert.equal(proxyCalls.length, 2);
  for (const c of proxyCalls) {
    assert.equal(c.args[0].strictProxy, true);
    assert.equal(c.args[0].upstreamProxy, "socks5://192.0.2.2:1080");
    assert.match(c.args[0].proxy, /_session-[a-zA-Z0-9]{8}/);
  }
  assert.notEqual(proxyCalls[0].args[0].proxy, proxyCalls[1].args[0].proxy);
  report.push({
    id: "R03",
    flow: "rate300/burst3/backoff1–2s + immediate risk pause/resume + automatic retry with distinct proxy session/upstream/strict flags",
  });
  await fs.writeFile(
    `${out}/registration.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    "通过：R01–R05、S04 注册来源、阶段、跨页、批量暂停/重试/停止、模板/配额/星期与 CSV 样例",
  );
}
