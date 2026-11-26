import assert from "node:assert/strict";
const calls = async (p, n) =>
  p.evaluate(
    (n) => window.__calls.filter((c) => c.name === n).map((c) => c.args),
    n,
  );
export async function verifyKproxy({ page, out, navigate }) {
  await navigate("kproxy");
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  assert.equal((await calls(page, "kproxyInstallCaCert")).length, 0);
  assert.equal((await calls(page, "kproxyUninstallCaCert")).length, 0);
  const inputs = page.locator("input");
  await inputs.nth(0).fill("9900");
  assert.deepEqual((await calls(page, "kproxyUpdateConfig")).at(-1), [
    { port: 9900 },
  ]);
  await inputs.nth(1).fill("127.0.0.2");
  assert.deepEqual((await calls(page, "kproxyUpdateConfig")).at(-1), [
    { host: "127.0.0.2" },
  ]);
  const device = page.getByPlaceholder("Enter or generate device ID");
  await device.fill("short");
  assert.equal((await calls(page, "kproxySetDeviceId")).length, 0);
  await device.fill("c".repeat(64));
  assert.deepEqual((await calls(page, "kproxySetDeviceId")).at(-1), [
    "c".repeat(64),
  ]);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  assert.deepEqual((await calls(page, "kproxySetDeviceId")).at(-1), [
    "b".repeat(64),
  ]);
  await page.getByTitle("Copy device ID", { exact: true }).click();
  assert.equal(await page.evaluate(() => window.__clipboard), "b".repeat(64));
  for (const sw of await page.getByRole("switch").all()) await sw.click();
  assert.deepEqual((await calls(page, "kproxyUpdateConfig")).slice(-2), [
    [{ logRequests: false }],
    [{ autoStart: true }],
  ]);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  assert.equal((await calls(page, "kproxyStart")).at(-1)[0].port, 9900);
  assert.equal(await inputs.nth(0).isDisabled(), true);
  await page.evaluate(() =>
    window.__emit("onKproxyRequest", {
      timestamp: Date.now(),
      host: "fixture.invalid",
      isMitm: true,
      deviceIdReplaced: true,
    }),
  );
  await page.getByText("fixture.invalid", { exact: true }).waitFor();
  const requests = await page.evaluate(
    () => window.__subscriptions.onKproxyRequest,
  );
  const starts = (await calls(page, "kproxyStart")).length;
  await navigate("home");
  await page.evaluate(() =>
    window.__emit("onKproxyRequest", {
      timestamp: Date.now(),
      host: "offpage.invalid",
      isMitm: false,
    }),
  );
  await navigate("kproxy");
  await page.getByText("offpage.invalid", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__subscriptions.onKproxyRequest),
    requests,
  );
  assert.equal((await calls(page, "kproxyStart")).length, starts);
  await page.evaluate(() => (window.__fail.kproxyStop = "Fixture stop error"));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Fixture stop error", { exact: true }).waitFor();
  await page.evaluate(() => delete window.__fail.kproxyStop);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  await page.evaluate(
    () => (window.__fail.kproxyInstallCaCert = "Fixture permission denied"),
  );
  await page.getByRole("button", { name: "Install", exact: true }).click();
  assert.ok(
    (await page.evaluate(() => window.__alerts)).includes(
      "Fixture permission denied",
    ),
  );
  await page.evaluate(() => delete window.__fail.kproxyInstallCaCert);
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await page.getByRole("button", { name: "Uninstall", exact: true }).click();
  await page.getByRole("button", { name: "Install", exact: true }).waitFor();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  assert.equal((await calls(page, "kproxyExportCaCert")).length, 1);
  await page.screenshot({ path: `${out}/kproxy-actions.png` });
  console.log(
    "通过：P06 初始化、启停失败/成功、设备ID、证书权限结果和跨页单次订阅；系统操作仅为模拟",
  );
}
