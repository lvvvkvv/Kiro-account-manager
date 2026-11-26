import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { installFixture } from "./fixtures.mjs";

const pageIds = [
  "home",
  "accounts",
  "machineId",
  "kiroSettings",
  "proxy",
  "kproxy",
  "proxyPool",
  "register",
  "subscription",
  "webhooks",
  "diagnose",
  "configSync",
  "logs",
  "settings",
  "about",
];
export async function verifyShell({ page, out, navigate }) {
  const aside = page.locator("aside");
  const buttons = aside.locator("nav button");
  assert.equal(await buttons.count(), 15);
  assert.equal((await aside.boundingBox()).width, 64);
  assert.deepEqual(
    await page.locator("main").evaluate((el) => {
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return { x: rect.x, y: rect.y, radius: style.borderRadius };
    }),
    { x: 64, y: 32, radius: "0px" },
  );
  await buttons.last().scrollIntoViewIfNeeded();
  await buttons.last().hover();
  assert.equal(await page.getByRole("tooltip").innerText(), "About");
  await page.screenshot({ path: `${out}/navigation-collapsed-800.png` });
  for (const [i, id] of pageIds.entries()) {
    await buttons.nth(i).click();
    await page.waitForTimeout(550);
    assert.equal(
      await buttons.nth(i).getAttribute("aria-current"),
      "page",
      `${id}: nav`,
    );
    assert.ok(
      (await page.locator("main").innerText()).trim().length,
      `${id}: rendered`,
    );
    await page.screenshot({ path: `${out}/route-${id}-800.png` });
    await navigate("home");
    await navigate(id);
    assert.equal(
      await buttons.nth(i).getAttribute("aria-current"),
      "page",
      `${id}: deep link`,
    );
  }
  await navigate("home");
  assert.equal((await aside.boundingBox()).width, 64);
  const collapsed = await buttons.first().evaluate((el) => {
    const b = el.getBoundingClientRect(),
      svg = el.querySelector("svg").getBoundingClientRect();
    return { width: b.width, height: b.height, icon: svg.width };
  });
  assert.deepEqual(collapsed, { width: 32, height: 32, icon: 20 });
  await aside.getByRole("button", { name: "Expand", exact: true }).click();
  const metrics = await buttons.first().evaluate((el) => {
    const b = el.getBoundingClientRect(),
      s = getComputedStyle(el),
      svg = el.querySelector("svg").getBoundingClientRect();
    return {
      width: b.width,
      height: b.height,
      font: s.fontSize,
      line: s.lineHeight,
      weight: s.fontWeight,
      radius: s.borderRadius,
      gap: s.gap,
      padding: s.paddingLeft,
      image: s.backgroundImage,
      icon: svg.width,
    };
  });
  assert.equal((await aside.boundingBox()).width, 200);
  assert.deepEqual(metrics, {
    width: 184,
    height: 28,
    font: "13px",
    line: "20px",
    weight: "500",
    radius: "6px",
    gap: "8px",
    padding: "8px",
    image: "none",
    icon: 18,
  });
  const selectedBg = await buttons.first().evaluate(el => getComputedStyle(el).backgroundColor);
  await buttons.first().hover();
  await page.waitForTimeout(200);
  assert.equal(await buttons.first().evaluate(el => getComputedStyle(el).backgroundColor), selectedBg);
  const header = await page.locator("main header").evaluate((el) => {
    const b = el.getBoundingClientRect(),
      s = getComputedStyle(el),
      h = getComputedStyle(el.querySelector("h1"));
    return {
      height: b.height,
      paddingLeft: s.paddingLeft,
      paddingRight: s.paddingRight,
      gap: s.gap,
      font: h.fontSize,
      line: h.lineHeight,
      weight: h.fontWeight,
      icon: el.querySelector(".ui-page-icon").getBoundingClientRect().width,
    };
  });
  assert.deepEqual(header, {
    height: 52,
    paddingLeft: "24px",
    paddingRight: "16px",
    gap: "20px",
    font: "18px",
    line: "26px",
    weight: "600",
    icon: 22,
  });
  await page.screenshot({ path: `${out}/navigation-expanded-800.png` });
  await fs.writeFile(
    `${out}/shell-geometry.json`,
    JSON.stringify({ collapsed, expanded: metrics, header }, null, 2),
  );
  await aside.getByRole("button", { name: "Collapse", exact: true }).click();

  // 在独立呈现插槽中测试标题／操作的长文本，App 和后台订阅保持挂载。
  await page.evaluate(async () => {
    const { createElement: h, createRoot } =
      await import("/__shell_fixture__.js");
    const { PageHeader } =
      await import("/src/components/layout/PageHeader.tsx");
    const { Button } = await import("/src/components/ui/button.tsx");
    const host = document.createElement("div");
    host.id = "header-fixture";
    host.style.width = "600px";
    host.className = "fixed inset-0 z-40 bg-background";
    document.body.append(host);
    window.__headerRoot = createRoot(host);
    window.__headerRoot.render(
      h(PageHeader, {
        title: "VeryLongSessionTitle".repeat(12),
        subtitle: "Subtitle ".repeat(20),
        actions: [
          h(Button, { key: 1 }, "Save changes"),
          h(Button, { key: 2, variant: "outline" }, "Open configuration"),
        ],
      }),
    );
  });
  await page.locator("#header-fixture header").waitFor();
  assert.equal(
    await page
      .locator("#header-fixture")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  assert.equal(
    await page
      .locator("#header-fixture header")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  assert.equal(await page.locator("#header-fixture button").count(), 2);
  await page.screenshot({ path: `${out}/page-header-long-800.png` });
  await page.evaluate(() => {
    window.__headerRoot.unmount();
    document.querySelector("#header-fixture").remove();
  });

  for (const platform of ["darwin", "win32", "linux"]) {
    const testPage = await page.context().newPage();
    await testPage.addInitScript(installFixture, { platform });
    await testPage.goto(page.url());
    await testPage.getByText("Total Accounts", { exact: true }).waitFor();
    const titlebar = testPage.locator("#root > div > div").first();
    assert.equal(
      await titlebar.evaluate((el) => el.style.webkitAppRegion),
      "drag",
    );
    if (platform === "darwin") {
      assert.equal(
        await titlebar.evaluate((el) => el.style.paddingLeft),
        "80px",
      );
      assert.equal(
        await titlebar
          .getByRole("button", { name: "Minimize", exact: true })
          .count(),
        0,
      );
    } else {
      await titlebar
        .getByRole("button", { name: "Minimize", exact: true })
        .click();
      await titlebar
        .getByRole("button", { name: "Maximize", exact: true })
        .click();
      await titlebar
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await titlebar
        .getByRole("button", { name: "Close", exact: true })
        .click();
      assert.deepEqual(
        await testPage.evaluate(() =>
          window.__calls
            .filter((x) => String(x.name).startsWith("window."))
            .map((x) => x.name),
        ),
        [
          "window.minimize",
          "window.maximizeToggle",
          "window.maximizeToggle",
          "window.close",
        ],
      );
      assert.equal(
        await titlebar
          .getByRole("button", { name: "Minimize", exact: true })
          .evaluate((el) => el.parentElement.style.webkitAppRegion),
        "no-drag",
      );
    }
    await testPage.screenshot({ path: `${out}/titlebar-${platform}-800.png` });
    await testPage.close();
  }
  console.log(
    "通过：G01 15 页导航／深层跳转、初始折叠及滚动；PageHeader 几何／长文；G03 三平台 renderer IPC 与 drag/no-drag（非原生窗口实测）",
  );
}
