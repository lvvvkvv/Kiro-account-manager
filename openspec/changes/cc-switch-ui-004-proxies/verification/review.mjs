import assert from "node:assert/strict";
import fs from "node:fs/promises";
export async function verifyReview({ page, out, navigate, setAppearance }) {
  const capture = !!process.env.UI_CAPTURE_REVIEW,
    records = [];
  await page.setViewportSize({ width: 800, height: 600 });
  await setAppearance("en", "light");
  await navigate("proxy");
  await page.evaluate(() => {
    window.__proxy.detailed = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      level: "INFO",
      category:
        `category-${String(i).padStart(2, "0")}-` +
        "very-long-category-".repeat(10),
      message: `Review log ${i}`,
    }));
  });
  await page
    .getByRole("button", { name: "Detailed Logs", exact: true })
    .click();
  let d = page.getByRole("dialog", {
    name: "Proxy Detailed Logs",
    exact: true,
  });
  const category = d
    .locator(".ui-toolbar > div")
    .nth(2)
    .locator("button")
    .first();
  await category.click();
  let m = await d.locator(".ui-menu").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      scrollHeight: el.scrollHeight,
    };
  });
  records.push({ kind: "category-menu", ...m });
  await page.screenshot({ path: `${out}/review-category.png` });
  if (!capture) {
    assert.ok(m.left >= 16 && m.right <= 784, JSON.stringify(m));
    assert.ok(m.bottom <= 540, JSON.stringify(m));
    await d.locator(".ui-menu button").last().click();
    await d.getByText("Review log 59", { exact: true }).waitFor();
    const selected = await category.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    records.push({ kind: "selected-category", ...selected });
    assert.ok(
      selected.width <= 240 && selected.right <= 784,
      JSON.stringify(selected),
    );
    await d.getByTitle("Copy log", { exact: true }).click();
    assert.match(
      await page.evaluate(() => window.__clipboard),
      /Review log 59/,
    );
    await category.click();
    await d
      .getByRole("heading", { name: "Proxy Detailed Logs", exact: true })
      .click();
    assert.equal(await d.locator(".ui-menu").count(), 0);
    await category.click();
    for (const width of [1200, 800]) {
      await page.setViewportSize({ width, height: 600 });
      const r = await d.locator(".ui-menu").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom };
      });
      assert.ok(
        r.left >= 16 && r.right <= width - 16 && r.bottom <= 540,
        JSON.stringify(r),
      );
    }
    await d.locator(".ui-menu button").first().click();
    await d.getByText("Review log 59", { exact: true }).waitFor();
  }
  if (capture) {
    await d.locator(".ui-menu button").last().click();
    const selected = await category.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    records.push({ kind: "selected-category", ...selected });
    await page.screenshot({ path: `${out}/review-category-selected.png` });
  }
  await d.getByTitle("Close", { exact: true }).click();
  // Account selection still exposes the same targets while row typography follows reference.
  await page.locator("#multiAccount").click();
  await page
    .getByRole("button", { name: "First Available", exact: true })
    .click();
  d = page.getByRole("dialog", { name: "Select Account", exact: true });
  const row = await d
    .getByText("First Available", { exact: true })
    .evaluate((el) => {
      const desc = el.nextElementSibling,
        s = getComputedStyle(el),
        ds = getComputedStyle(desc),
        r = el.closest("[class*=cursor-pointer]"),
        rs = getComputedStyle(r);
      return {
        name: [s.fontSize, s.lineHeight, s.fontWeight],
        description: [ds.fontSize, ds.lineHeight],
        radius: rs.borderRadius,
        padding: [
          rs.paddingTop,
          rs.paddingRight,
          rs.paddingBottom,
          rs.paddingLeft,
        ],
      };
    });
  records.push({ kind: "account-row", ...row });
  if (!capture) {
    assert.deepEqual(row.name, ["14px", "20px", "500"]);
    assert.deepEqual(row.description, ["12px", "18px"]);
    assert.equal(row.radius, "10px");
    assert.deepEqual(row.padding, ["10px", "12px", "10px", "8px"]);
  }
  await d.getByTitle("Close", { exact: true }).click();
  // Mapping source/targets and their actions must fit even for unbroken model IDs.
  await page.evaluate(() => {
    window.__proxy.config.modelMappings = [
      {
        id: "review",
        name: "Long rule",
        enabled: true,
        type: "replace",
        sourceModel: "source-".repeat(60),
        targetModels: ["target-".repeat(60)],
        priority: 0,
      },
    ];
  });
  await navigate("home");
  await navigate("proxy");
  await page
    .getByRole("button", { name: "Start Service", exact: true })
    .click();
  await page.getByRole("button", { name: "View Models", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Available Models" })
    .getByRole("button", { name: /Mapping/ })
    .click();
  d = page.getByRole("dialog", { name: "Model Mapping", exact: true });
  await d.getByText("Long rule", { exact: true }).click();
  await page.waitForTimeout(100);
  const map = await d.evaluate((el) => {
    const rule = el.querySelector(".ui-dialog-body > div > div");
    const actions = [...el.querySelectorAll("button")].find((b) =>
      b.querySelector("svg.lucide-trash-2"),
    )?.parentElement;
    const control = el.querySelector("select");
    const s = getComputedStyle(control);
    return {
      bodyWidth: el.querySelector(".ui-dialog-body").clientWidth,
      bodyScroll: el.querySelector(".ui-dialog-body").scrollWidth,
      actionGap: actions ? getComputedStyle(actions).gap : null,
      select: {
        h: control.getBoundingClientRect().height,
        font: s.fontSize,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        line: s.lineHeight,
      },
      ruleWidth: rule?.getBoundingClientRect().width,
    };
  });
  records.push({ kind: "mapping", ...map });
  await page.screenshot({ path: `${out}/review-mapping.png` });
  if (!capture) {
    assert.equal(map.actionGap, "8px");
    assert.ok(map.bodyScroll <= map.bodyWidth + 1, JSON.stringify(map));
    assert.deepEqual(
      [map.select.paddingTop, map.select.paddingBottom],
      ["0px", "0px"],
    );
  }
  await d.getByPlaceholder("Enter rule name").fill("Unsaved rule");
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__proxy.config.modelMappings[0].name),
    "Long rule",
  );
  await navigate("kproxy");
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  await page.evaluate(() => window.__emit("onKproxyError", "Review error"));
  const notice = await page.locator(".ui-notice").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      radius: s.borderRadius,
      gap: s.gap,
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
    };
  });
  records.push({ kind: "notice", ...notice });
  assert.deepEqual(notice, {
    radius: "10px",
    gap: "10px",
    padding: ["10px", "14px", "10px", "19px"],
  });
  await page.getByTitle("Dismiss error", { exact: true }).click();
  assert.equal(
    await page.getByText("Review error", { exact: true }).count(),
    0,
  );
  await page.evaluate(async () => {
    const { useAccountsStore: s } = await import("/src/store/accounts.ts");
    const proxies = new Map([
      [
        "review-proxy",
        {
          id: "review-proxy",
          url: "http://review.invalid:8080",
          host: "review.invalid",
          port: 8080,
          protocol: "http",
          status: "alive",
          enabled: true,
          usedCount: 1,
          failCount: 0,
          createdAt: Date.now(),
        },
      ],
    ]);
    s.setState({
      proxyPool: proxies,
      accountProxyBindings: { "fixture-0": "review-proxy" },
    });
  });
  await navigate("proxyPool");
  const panel = page
    .getByText("Reverse Proxy: Account-to-IP Bucketing", { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(@class,"glass-card")][1]');
  const metric = await panel.locator(".text-metric").evaluateAll((els) =>
    els.map((e) => {
      const s = getComputedStyle(e);
      return [s.fontSize, s.lineHeight, s.fontWeight];
    }),
  );
  records.push({ kind: "binding-metrics", values: metric });
  assert.equal(metric.length, 4);
  assert.ok(metric.every((m) => m.join("/") === "24px/32px/600"));
  await page.getByRole("button", { name: /Show binding details/ }).click();
  const chip = await panel.locator("span.text-badge").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      size: s.fontSize,
      line: s.lineHeight,
      weight: s.fontWeight,
      h: el.getBoundingClientRect().height,
    };
  });
  records.push({ kind: "binding-chip", ...chip });
  assert.deepEqual(chip, { size: "11px", line: "16px", weight: "500", h: 20 });
  const columns = await page
    .locator("[data-proxy-id]")
    .first()
    .evaluate((row) => {
      const header =
        row.closest(".glass-card").firstElementChild.firstElementChild;
      const pos = (e) =>
        [...e.children].map((c) => {
          const r = c.getBoundingClientRect();
          return [r.left, r.width];
        });
      return { header: pos(header), row: pos(row) };
    });
  records.push({ kind: "pool-columns", ...columns });
  assert.equal(columns.header.length, columns.row.length);
  assert.ok(
    columns.row.every((r, i) => Math.abs(r[0] - columns.header[i][0]) < 1),
  );
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  for (const mode of ["light", "dark"]) {
    await setAppearance("en", mode);
    for (const view of ["proxy", "kproxy", "proxyPool"]) {
      await navigate(view);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: `${out}/review-expanded-${view}-${mode}.png`,
      });
    }
  }
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await fs.writeFile(`${out}/review.json`, JSON.stringify(records, null, 2));
  console.log("审查边界测量", JSON.stringify(records));
}
