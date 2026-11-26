import fs from "node:fs/promises";
export async function verifyBaseline({ page, navigate, out }) {
  for (const view of [
    "settings",
    "machineId",
    "kiroSettings",
    "webhooks",
    "diagnose",
    "configSync",
    "logs",
    "about",
  ]) {
    await navigate(view);
    await page.screenshot({ path: `${out}/baseline-${view}.png` });
  }
  await navigate("logs");
  await page.waitForTimeout(200);
  const container = page.locator("div.h-full.overflow-y-auto.font-mono");
  await container.evaluate((e) => {
    e.scrollTop = 0;
    e.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => document.body.innerText.slice(-180));
  await page.evaluate(() =>
    window.__logs.push({
      timestamp: new Date().toISOString(),
      level: "INFO",
      category: "Kiro",
      message: "Fixture new entry",
    }),
  );
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => document.body.innerText.slice(-180));
  const metrics = await container.evaluate((e) => ({
    top: e.scrollTop,
    height: e.clientHeight,
    total: e.scrollHeight,
  }));
  await fs.writeFile(
    `${out}/baseline-log.json`,
    JSON.stringify({ before, after, metrics }, null, 2),
  );
  console.log({ before, after, metrics });
}
