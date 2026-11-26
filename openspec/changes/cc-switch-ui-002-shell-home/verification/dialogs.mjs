import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function verifyDialogs({ page, out, setAppearance }) {
  const close = () =>
    page.getByRole("dialog", { name: "Close Window", exact: true });
  const cases = [
    ["minimize", false, "Minimize to Tray"],
    ["minimize", true, "Minimize to Tray"],
    ["quit", false, "Exit Application"],
    ["quit", true, "Exit Application"],
    ["cancel", true, "Cancel"],
    ["cancel", false, "Close"],
    ["cancel", true, "backdrop"],
  ];
  await page.evaluate(() => {
    window.__calls.length = 0;
  });
  for (const [action, remember, label] of cases) {
    await page.evaluate(() => window.__emit("onShowCloseConfirmDialog"));
    assert.equal(await close().getByRole("checkbox").isChecked(), false);
    if (remember) await close().getByRole("checkbox").check();
    if (label === "backdrop")
      await page
        .locator("[data-close-backdrop]")
        .click({ position: { x: 2, y: 2 } });
    else
      await close()
        .getByRole("button", {
          name: label,
          exact: label === "Close" || label === "Cancel",
        })
        .click();
    assert.equal(await close().count(), 0);
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__calls
            .filter((x) => x.name === "sendCloseConfirmResponse")
            .at(-1).args,
      ),
      [action, remember],
    );
  }
  assert.equal(
    await page.evaluate(
      () =>
        window.__calls.filter((x) => x.name === "sendCloseConfirmResponse")
          .length,
    ),
    cases.length,
  );
  await page.evaluate(() => window.__emit("onShowCloseConfirmDialog"));
  await close().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await close().isVisible(), true); // 原弹窗无 Escape 关闭策略。
  const geometry = await close().evaluate((el) => {
    const b = el.getBoundingClientRect(),
      s = getComputedStyle(el),
      h = el.querySelector(".ui-dialog-header"),
      hs = getComputedStyle(h),
      title = getComputedStyle(h.querySelector("h2"));
    return {
      width: b.width,
      radius: s.borderRadius,
      maxHeight: s.maxHeight,
      left: hs.paddingLeft,
      top: hs.paddingTop,
      gap: hs.gap,
      font: title.fontSize,
      line: title.lineHeight,
      weight: title.fontWeight,
    };
  });
  assert.deepEqual(geometry, {
    width: 512,
    radius: "14px",
    maxHeight: "540px",
    left: "24px",
    top: "20px",
    gap: "4px",
    font: "16px",
    line: "24px",
    weight: "600",
  });
  await fs.writeFile(
    `${out}/dialog-geometry.json`,
    JSON.stringify(geometry, null, 2),
  );
  await close().getByRole("button", { name: "Cancel", exact: true }).click();

  const update = () =>
    page.getByRole("dialog", { name: "New Version Available", exact: true });
  const available = async () => {
    await page.evaluate(() =>
      window.__emit("onUpdateAvailable", {
        version: "1.8.0",
        releaseNotes: "<h2>Changes</h2><p>Fixture release notes.</p>".repeat(
          20,
        ),
      }),
    );
    await page.getByRole("dialog").waitFor();
  };
  await page.evaluate(() => window.__emit("onUpdateChecking"));
  assert.equal(await update().count(), 0); // 检查事件本身不自动打开。
  await available();
  await page.evaluate(() => window.__emit("onUpdateChecking"));
  await update().getByText("Checking for updates…", { exact: true }).waitFor();
  assert.equal(
    await update()
      .getByText("Checking for updates…", { exact: true })
      .isVisible(),
    true,
  );
  await page.evaluate(() => window.__emit("onUpdateNotAvailable"));
  await update().getByText("You are up to date.", { exact: true }).waitFor();
  assert.equal(
    await update()
      .getByText("You are up to date.", { exact: true })
      .isVisible(),
    true,
  );
  await available();
  await update()
    .getByRole("button", { name: "Download Now", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((x) => x.name === "downloadUpdate").length,
    ),
    1,
  );
  assert.equal(
    await update().getByRole("button", { name: "Close", exact: true }).count(),
    0,
  );
  await page
    .locator("[data-update-backdrop]")
    .click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Escape");
  assert.equal(await update().isVisible(), true);
  await page.evaluate(() =>
    window.__emit("onUpdateDownloadProgress", {
      percent: 42.56,
      bytesPerSecond: 1024,
      transferred: 1024 * 1024,
      total: 3 * 1024 * 1024,
    }),
  );
  await update().getByText("42.6%", { exact: true }).waitFor();
  assert.equal(
    await update().getByText("42.6%", { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await update().getByText("1.0 MB / 3.0 MB", { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await update().getByText("1.0 KB/s", { exact: true }).isVisible(),
    true,
  );
  await page.screenshot({ path: `${out}/update-progress-800.png` });
  await page.evaluate(() =>
    window.__emit("onUpdateDownloaded", { version: "1.8.0" }),
  );
  await update()
    .getByRole("button", { name: "Restart Now", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((x) => x.name === "installUpdate").length,
    ),
    1,
  );
  await update()
    .getByRole("button", { name: "Install Later", exact: true })
    .click();
  await available();
  await page.evaluate(() =>
    window.__emit("onUpdateError", "Fixture update failure. ".repeat(80)),
  );
  await update()
    .getByText(/^Update check failed:/)
    .waitFor();
  assert.equal(
    await update()
      .getByText(/^Update check failed:/)
      .isVisible(),
    true,
  );
  await update()
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await available();
  await page
    .locator("[data-update-backdrop]")
    .click({ position: { x: 2, y: 2 } });
  assert.equal(await update().count(), 0);

  for (const language of ["zh", "en"])
    for (const mode of ["light", "dark"]) {
      const isEn = language === "en";
      await setAppearance(language, mode);
      await page.evaluate(() => window.__emit("onShowCloseConfirmDialog"));
      await page.screenshot({
        path: `${out}/close-${language}-${mode}-800.png`,
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: isEn ? "Cancel" : "取消", exact: true })
        .click();
      await available();
      await page.screenshot({
        path: `${out}/update-${language}-${mode}-800.png`,
      });
      await page
        .getByRole("dialog")
        .getByRole("button", {
          name: isEn ? "Remind Me Later" : "稍后提醒",
          exact: true,
        })
        .click();
    }
  console.log(
    "通过：G04 七种 response/remember 分支与原取消策略；G05 检查／最新／可更新／下载进度／完成／长错误、关闭限制、下载及安装 IPC（无真实安装）",
  );
}
