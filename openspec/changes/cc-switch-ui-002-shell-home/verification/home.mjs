import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function verifyHome({ page, out, navigate, setAppearance }) {
  const reset = () =>
    page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      useAccountsStore.setState({
        accounts: new Map(
          Object.entries(structuredClone(window.__fixtureAccounts)),
        ),
        activeAccountId: "fixture-0",
        privacyMode: false,
        usagePrecision: true,
      });
    });
  await reset();
  const values = await page
    .locator("[data-home-stats] .text-metric")
    .allTextContents();
  assert.deepEqual(values, ["3", "1", "1", "2"]);
  assert.deepEqual(
    await page.locator("[data-home-usage] .text-metric").allTextContents(),
    ["100", "22", "78", "22.00%"],
  );
  assert.equal(await page.locator('[data-risk="banned"]').count(), 1);
  assert.equal(await page.locator('[data-risk="expiring"]').count(), 1);
  assert.equal(await page.locator('[data-risk="quota"]').count(), 0);
  const fontMetrics = await page
    .locator("[data-home-stats] .text-metric")
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el),
        panel = el.closest(".rounded-panel"),
        p = getComputedStyle(panel);
      return {
        font: s.fontSize,
        line: s.lineHeight,
        weight: s.fontWeight,
        radius: p.borderRadius,
        padding: getComputedStyle(panel.firstElementChild).padding,
      };
    });
  assert.deepEqual(fontMetrics, {
    font: "24px",
    line: "32px",
    weight: "600",
    radius: "10px",
    padding: "16px",
  });
  await fs.writeFile(
    `${out}/home-geometry.json`,
    JSON.stringify(fontMetrics, null, 2),
  );

  // 阈值边界、错误账号与封禁排重；计算均由原首页与store执行。
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const base = window.__fixtureAccounts["fixture-0"];
    const rows = [
      ["normal", "active", 8, 0.899],
      ["boundary", "active", 7, 0.9],
      ["banned", "error", 1, 0.99],
      ["other-error", "error", 20, 0.5],
    ];
    const accounts = new Map(
      rows.map(([id, status, days, ratio]) => [
        id,
        {
          ...structuredClone(base),
          id,
          nickname: id,
          status,
          lastError: id === "banned" ? "Account suspended" : undefined,
          subscription: { ...base.subscription, daysRemaining: days },
          usage: {
            ...base.usage,
            limit: 100,
            current: ratio * 100,
            percentUsed: ratio,
          },
        },
      ]),
    );
    useAccountsStore.setState({ accounts, activeAccountId: "normal" });
  });
  assert.deepEqual(
    await page.locator("[data-home-stats] .text-metric").allTextContents(),
    ["4", "2", "2", "2"],
  );
  for (const kind of ["banned", "expiring", "quota"])
    assert.match(
      await page.locator(`[data-risk="${kind}"]`).innerText(),
      /^1\s/,
    );
  for (const [kind, key, value] of [
    ["banned", "bannedOnly", true],
    ["expiring", "daysRemainingMax", 7],
    ["quota", "usageMin", 0.9],
  ]) {
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      useAccountsStore.setState({ activeGroupTab: "fixture-group" });
    });
    await page.locator(`[data-risk="${kind}"]`).click();
    await page.waitForTimeout(550);
    assert.equal(
      await page
        .locator('aside nav button[aria-current="page"]')
        .getAttribute("aria-label"),
      "Accounts",
    );
    assert.deepEqual(
      await page.evaluate(async (key) => {
        const { useAccountsStore } = await import("/src/store/accounts.ts");
        const s = useAccountsStore.getState();
        return { group: s.activeGroupTab, value: s.filter[key] };
      }, key),
      { group: "all", value },
    );
    await navigate("home");
  }
  await reset();
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const s = useAccountsStore.getState();
    const a = structuredClone(s.accounts.get("fixture-0"));
    a.usage = { ...a.usage, current: 125.678, percentUsed: 1.25678 };
    useAccountsStore.setState({
      accounts: new Map([[a.id, a]]),
      usagePrecision: true,
    });
  });
  assert.deepEqual(
    await page.locator("[data-home-usage] .text-metric").allTextContents(),
    ["100", "125.678", "-25.678", "125.68%"],
  );
  const over = page.locator('[data-variant="danger"]');
  assert.match(await over.innerText(), /Over Quota/);
  assert.match(await over.innerText(), /\+25\.68%/);
  assert.match(await over.innerText(), /25\.68/);
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    useAccountsStore.getState().setUsagePrecision(false);
  });
  await page.getByText("125.7%", { exact: true }).first().waitFor();
  assert.match(await over.innerText(), /\+25\.7%/);
  await over.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/home-overquota-800.png` });

  // 已有账号遮罩函数接入首页姓名／邮箱展示，不改变持久化偏好。
  await reset();
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    useAccountsStore.getState().setPrivacyMode(true);
  });
  await page.waitForFunction(
    () =>
      !document
        .querySelector("[data-home-account]")
        .textContent.includes("fixture0@example.invalid"),
  );
  assert.doesNotMatch(
    await page.locator("[data-home-content]").innerText(),
    /fixture\d@example\.invalid|Fixture [012]/,
  );
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    useAccountsStore.getState().setPrivacyMode(false);
  });
  await page
    .locator("[data-home-account]")
    .getByText("fixture0@example.invalid", { exact: true })
    .waitFor();

  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    useAccountsStore.setState({ accounts: new Map(), activeAccountId: null });
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-home-stats] .text-metric")[0]
        .textContent === "0",
  );
  assert.equal(await page.locator("[data-home-account]").count(), 0);
  assert.equal(await page.locator("[data-home-warnings]").count(), 0);
  assert.equal(await page.locator("[data-home-usage]").count(), 0);
  assert.equal(
    await page.getByText("Quick Tips", { exact: true }).isVisible(),
    true,
  );
  await page.screenshot({ path: `${out}/home-empty-800.png` });

  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    window.__deferLoad = true;
    window.__pendingLoad = useAccountsStore.getState().loadFromStorage();
  });
  await page.waitForFunction(() => typeof window.__resolveLoad === "function");
  assert.equal(await page.locator("main header").isVisible(), true);
  assert.equal(await page.locator("aside nav button").count(), 15);
  await page.evaluate(async () => {
    window.__deferLoad = false;
    window.__resolveLoad();
    await window.__pendingLoad;
  });
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    window.__loadError = true;
    await useAccountsStore.getState().loadFromStorage();
    window.__loadError = false;
  });
  assert.equal(
    await page.getByText("Quick Tips", { exact: true }).isVisible(),
    true,
  );
  await reset();

  for (const size of [
    { width: 800, height: 600 },
    { width: 1200, height: 1200 },
  ]) {
    await page.setViewportSize(size);
    for (const language of ["zh", "en"])
      for (const mode of ["light", "dark"]) {
        await setAppearance(language, mode);
        const content = page.locator("[data-home-content]");
        await content.evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.screenshot({
          path: `${out}/home-${language}-${mode}-${size.width}-top.png`,
        });
        await page.locator("[data-home-account]").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${out}/home-${language}-${mode}-${size.width}-account.png`,
        });
        await content.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.screenshot({
          path: `${out}/home-${language}-${mode}-${size.width}-bottom.png`,
        });
        assert.equal(
          await content.evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      }
  }
  await page.setViewportSize({ width: 800, height: 600 });
  await setAppearance("en", "dark");
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const s = useAccountsStore.getState();
    const a = structuredClone(s.accounts.get("fixture-0"));
    a.nickname = "VeryLongAccountNickname".repeat(12);
    a.email = "verylongaddress".repeat(12) + "@example.invalid";
    a.userId = "fixture-user-id-".repeat(20);
    a.subscription = {
      ...a.subscription,
      title: "KIRO PRO Enterprise Subscription ".repeat(8),
      rawType: "RAW_TYPE_".repeat(20),
      expiresAt: Date.now() + 86400000,
      upgradeCapability: "UPGRADABLE",
      overageCapability: "ENABLED",
    };
    a.usage = {
      ...a.usage,
      baseLimit: 40,
      baseCurrent: 20,
      freeTrialLimit: 20,
      freeTrialCurrent: 2,
      freeTrialExpiry: "2026-12-01",
      nextResetDate: "2026-12-01",
      bonuses: [
        {
          code: "fixture",
          name: "Long bonus name ".repeat(20),
          current: 0,
          limit: 40,
          expiresAt: "2026-12-01",
        },
      ],
    };
    useAccountsStore.setState({ accounts: new Map([[a.id, a]]) });
  });
  await page.locator("[data-home-account]").scrollIntoViewIfNeeded();
  assert.equal(
    await page
      .locator("[data-home-content]")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({ path: `${out}/home-long-dark-800.png` });
  await reset();
  console.log(
    "通过：H01/H02 基线数值、封禁排重、7天/90%边界、风险筛选跳转、超额/精度、隐私、空/加载/失败/长文本；中英文×明暗×两档尺寸首页24张截图",
  );
}
