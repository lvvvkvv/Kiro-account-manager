import assert from "node:assert/strict";
import { seed, state } from "./accounts.mjs";
export async function verifyActions({ page, out, navigate, setAppearance }) {
  await navigate("accounts");
  await setAppearance("en", "light");
  await page.setViewportSize({ width: 1200, height: 1200 });
  for (const view of ["Grid", "List"]) {
    await page.getByTitle(`${view} view`, { exact: true }).click();
    for (const target of ["ide", "cli", "both"]) {
      await seed(page);
      await state(page, "store.setState({switchTarget:arg})", target);
      const item = page.locator('[data-account-id="fixture-7"]');
      await item.scrollIntoViewIfNeeded();
      await item.getByTitle("Switch to this account", { exact: true }).count();
      await item.locator('button[title^="Switch to"]').click();
      assert.equal(await state(page, "return s.activeAccountId"), "fixture-7");
      const calls = await page.evaluate(() =>
        window.__calls.filter((c) =>
          ["switchAccount", "switchAccountCli"].includes(c.name),
        ),
      );
      assert.deepEqual(
        calls.map((c) => c.name),
        target === "both"
          ? ["switchAccount", "switchAccountCli"]
          : [target === "ide" ? "switchAccount" : "switchAccountCli"],
      );
      assert.equal(calls.at(-1).args[0].refreshToken, "refresh-7");
      assert.equal(await state(page, "return s.selectedIds.size"), 0);
    }
    await seed(page);
    const item = page.locator('[data-account-id="fixture-7"]');
    await item.getByTitle("Check account info", { exact: true }).count();
    await item.locator('button[title^="Check account"]').click();
    await page.waitForTimeout(70);
    assert.equal(
      await state(page, "return s.accounts.get('fixture-7').usage.current"),
      42,
    );
    assert.equal(await state(page, "return s.selectedIds.size"), 0);
    await item.locator("h3").click();
    assert.equal(
      await page.evaluate(() => window.__clipboard),
      "fixture7@example.invalid",
    );
    assert.equal(await state(page, "return s.selectedIds.size"), 0);
    if (view === "Grid") {
      await item.getByTitle("Refresh Token", { exact: true }).click();
      await page.waitForTimeout(70);
      assert.equal(
        await state(
          page,
          "return s.accounts.get('fixture-7').credentials.accessToken",
        ),
        "refreshed-access",
      );
      await item.getByTitle("Copy credentials", { exact: true }).click();
      assert.equal(
        JSON.parse(await page.evaluate(() => window.__clipboard)).refreshToken,
        "refresh-7",
      );
    }
    await item.getByTitle("Delete", { exact: true }).click();
    assert.ok(await state(page, "return s.accounts.has('fixture-7')"));
    await page.evaluate(() => (window.__confirmAnswer = true));
    await item.getByTitle("Delete", { exact: true }).click();
    assert.equal(
      await state(page, "return s.accounts.has('fixture-7')"),
      false,
    );
    await page.evaluate(() => (window.__confirmAnswer = false));
    await seed(page);
    const active = page.locator('[data-account-id="fixture-0"]');
    await active.scrollIntoViewIfNeeded();
    await active.locator('button[title^="Logout"]').click();
    assert.equal(await state(page, "return s.activeAccountId"), "fixture-0");
    await page.evaluate(() => (window.__confirmAnswer = true));
    await active.locator('button[title^="Logout"]').click();
    assert.equal(await state(page, "return s.activeAccountId"), null);
    await page.evaluate(() => (window.__confirmAnswer = false));
    await seed(page);
    const banned = page.locator('[data-account-id="fixture-1"]');
    await banned.scrollIntoViewIfNeeded();
    if (view === "Grid")
      await banned.getByText("Banned", { exact: true }).click();
    await page
      .getByRole("button", { name: "Reset Suspended", exact: true })
      .click();
    await page.waitForTimeout(100);
    assert.equal(
      await state(page, "return s.accounts.get('fixture-1').lastError"),
      undefined,
    );
    if (view === "Grid")
      assert.equal(await page.getByRole("dialog").count(), 0);
    await seed(page);
    await state(page, "s.setPrivacyMode(true)");
    const privateItem = page.locator('[data-account-id="fixture-7"]');
    await privateItem.scrollIntoViewIfNeeded();
    const masks = await state(
      page,
      "return [s.maskEmail('fixture7@example.invalid'),s.maskNickname('Fixture 7')]",
    );
    const text = await privateItem.innerText();
    assert.ok(text.includes(masks[0]) || text.includes(masks[1]));
    assert.ok(!text.includes("fixture7@example.invalid"));
    await page.screenshot({ path: `${out}/privacy-${view}.png` });
  }
  await page.getByTitle("Grid view", { exact: true }).click();
  await seed(page);
  const item = page.locator('[data-account-id="fixture-7"]');
  await item.getByTitle("Click to manage subscription").click();
  await page
    .getByRole("dialog", { name: "Subscription Plans", exact: true })
    .waitFor();
  await page.screenshot({ path: `${out}/subscription-plans.png` });
  await page.getByText("KIRO PRO+", { exact: true }).click();
  await page.waitForTimeout(950);
  const payment = await page.evaluate(() =>
    window.__calls.filter((c) => c.name === "accountGetSubscriptionUrl").at(-1),
  );
  assert.equal(payment.args[1], "PRO_PLUS");
  assert.equal(payment.args.at(-1), "fixture-7");
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "https://billing.example.invalid/manage",
  );
  assert.ok(
    await page.evaluate(() =>
      window.__calls.some((c) => c.name === "openSubscriptionWindow"),
    ),
  );
  await item.getByTitle("Click to manage subscription").click();
  await page
    .getByRole("button", { name: "Manage Billing", exact: true })
    .click();
  const management = await page.evaluate(() =>
    window.__calls.filter((c) => c.name === "accountGetSubscriptionUrl").at(-1),
  );
  assert.equal(management.args[1], undefined);
  await seed(page);
  const single = page.locator('[data-account-id="fixture-7"]');
  await single.getByTitle("Details", { exact: true }).click();
  await page
    .getByRole("button", { name: "+ Bind to Proxy", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /proxy.example.invalid:8080/ })
    .click();
  assert.equal(
    await state(page, "return s.accountProxyBindings['fixture-7']"),
    "proxy-a",
  );
  await page.getByTitle("Close", { exact: true }).click();
  await single.locator('[title^="Bound proxy:"]').click();
  assert.equal(
    await state(page, "return s.accountProxyBindings['fixture-7']"),
    "proxy-a",
  );
  await page.evaluate(() => (window.__confirmAnswer = true));
  await single.locator('[title^="Bound proxy:"]').click();
  assert.equal(
    await state(page, "return s.accountProxyBindings['fixture-7']"),
    undefined,
  );
  await page.evaluate(() => (window.__confirmAnswer = false));
  // The proxy pool and subscription pages read the same store account/binding records.
  await state(page, "s.bindAccountsToProxy(['fixture-7'],'proxy-a')");
  await navigate("proxyPool");
  assert.ok(await page.getByText("Fixture proxy", { exact: true }).count());
  assert.equal(
    await state(page, "return s.accountProxyBindings['fixture-7']"),
    "proxy-a",
  );
  await navigate("subscription");
  assert.ok(await page.getByText("KIRO PRO", { exact: true }).count());
  await navigate("accounts");
  console.log(
    "通过：A04/A07 两种视图的 IDE/CLI/both、刷新、复制、登出、删除取消/确认、解除 suspended、隐私、订阅和跨域绑定",
  );
}
