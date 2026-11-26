import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { proxyFixture } from "../../cc-switch-ui-004-proxies/verification/fixtures.mjs";
export async function verifyIntegration({
  page,
  navigate,
  setAppearance,
  out,
}) {
  await page.evaluate(proxyFixture);
  const views = [
    "home",
    "accounts",
    "proxy",
    "kproxy",
    "proxyPool",
    "register",
    "subscription",
    "settings",
    "machineId",
    "kiroSettings",
    "webhooks",
    "diagnose",
    "configSync",
    "logs",
    "about",
  ];
  const report = [];
  for (const language of ["en", "zh"])
    for (const mode of ["light", "dark"]) {
      await setAppearance(language, mode);
      await page.setViewportSize({ width: 800, height: 600 });
      await page.evaluate(async () => {
        const { useAccountsStore: s } = await import("/src/store/accounts.ts");
        s.getState().setPrivacyMode(true);
      });
      for (const view of views) {
        await navigate(view);
        const count = await page.locator(".ui-page-header").count();
        assert.equal(count, 1, `${view} header`);
        assert.ok(await page.locator(".ui-page-header h1").innerText());
        report.push({ view, language, mode });
        await page.screenshot({
          path: `${out}/integration-${view}-${language}-${mode}.png`,
        });
      }
    }
  await setAppearance("en", "light");
  await navigate("accounts");
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    s.setState({ selectedIds: new Set(["fixture-0", "fixture-1"]) });
  });
  // Original account toolbar carries selected IDs into liveness; no navigation-triggered requests.
  await page.getByRole("button", { name: /Liveness|Test Alive/i }).click();
  await page.getByText("Account Liveness Test", { exact: true }).waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Test Selected (2)", exact: true })
      .count(),
  );
  const mutationNames = [
    "machineIdSet",
    "saveKiroSettings",
    "saveMcpServer",
    "saveKiroSteeringFile",
    "diagnoseRun",
    "diagnoseAccountLiveness",
    "proxyStart",
    "kproxyStart",
  ];
  assert.deepEqual(
    await page.evaluate(
      (names) => window.__calls.filter((c) => names.includes(c.name)),
      mutationNames,
    ),
    [],
  );
  await fs.writeFile(
    `${out}/integration.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    `通过：${report.length} 组 15 页语言 / 明暗 / 隐私入口检查及账号 → 诊断交叉入口`,
  );
}
