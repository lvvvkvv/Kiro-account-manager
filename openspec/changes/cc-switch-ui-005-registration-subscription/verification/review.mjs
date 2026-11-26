import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { savedConfig } from "./fixtures.mjs";
export async function verifyReview({ page, out, navigate, setAppearance }) {
  const capture = !!process.env.UI_CAPTURE_REVIEW,
    result = {};
  const g = (e) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return {
      h: r.height,
      w: r.width,
      x: r.left,
      y: r.top,
      right: r.right,
      bottom: r.bottom,
      size: s.fontSize,
      line: s.lineHeight,
      r: s.borderRadius,
      pad: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
      gap: s.gap,
      overflow: s.overflow,
      whiteSpace: s.whiteSpace,
      scrollH: e.scrollHeight,
      clientH: e.clientHeight,
      scrollW: e.scrollWidth,
      clientW: e.clientWidth,
    };
  };
  await page.evaluate((config) => {
    localStorage.setItem(
      "kiro-register-config",
      JSON.stringify({ ...config, mode: "mixed" }),
    );
    localStorage.setItem(
      "kiro-register-mixed-sources",
      JSON.stringify(["tempmail", "gptmail"]),
    );
  }, savedConfig);
  await navigate("register");
  result.source = await page
    .getByRole("button", { name: "GPTmail", exact: true })
    .last()
    .evaluate(g);
  if (!capture) {
    assert.equal(result.source.h, 32);
    assert.equal(result.source.size, "13px");
    assert.equal(result.source.gap, "6px");
    assert.equal(result.source.pad[1], "14px");
  }
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    const base = useAccountsStore.getState().accounts.get("pro-a"),
      accounts = new Map();
    for (let i = 0; i < 61; i++) {
      const id = `review-${i}`;
      accounts.set(id, {
        ...base,
        id,
        email: `review-${i}@example.invalid`,
        subscription: {
          ...base.subscription,
          title: i === 0 ? "Pro " + "long-plan-name ".repeat(25) : "Pro",
        },
      });
    }
    useAccountsStore.setState({ accounts, selectedIds: new Set() });
  });
  await navigate("subscription");
  await page
    .getByRole("button", { name: "Manage Subscriptions", exact: true })
    .click();
  const row = page
    .getByText("review-0@example.invalid", { exact: true })
    .locator("..");
  await row.waitFor();
  await row.scrollIntoViewIfNeeded();
  result.badge = await row.locator(".text-badge").evaluate(g);
  result.columns = await row.evaluate((e) => {
    const body = e.closest('[style*="contain"]'),
      head = body.previousElementSibling;
    const m = (n) => {
      const r = n.getBoundingClientRect();
      return [r.x, r.width];
    };
    return { head: [...head.children].map(m), row: [...e.children].map(m) };
  });
  if (!capture) {
    assert.equal(result.badge.h, 20);
    assert.equal(result.badge.size, "11px");
    assert.equal(result.badge.whiteSpace, "nowrap");
    assert.equal(
      await row.locator(".text-badge").getAttribute("title"),
      await row.locator(".text-badge").textContent(),
    );
    assert.equal(result.badge.scrollH, result.badge.clientH);
    for (let i = 0; i < result.columns.head.length; i++) {
      assert.ok(
        Math.abs(result.columns.head[i][0] - result.columns.row[i][0]) < 1,
        `column ${i}`,
      );
      assert.ok(
        Math.abs(result.columns.head[i][1] - result.columns.row[i][1]) < 1,
        `column width ${i}`,
      );
    }
  }
  await page.screenshot({ path: `${out}/long-plan.png` });
  await page.evaluate((config) => {
    localStorage.setItem(
      "kiro-register-config",
      JSON.stringify({ ...config, mode: "gptmail" }),
    );
    localStorage.setItem(
      "kiro-register-templates",
      JSON.stringify(
        Array.from({ length: 30 }, (_, i) => ({
          id: `tpl-${i}`,
          name: `Template ${i}`,
          config,
          createdAt: Date.now(),
        })),
      ),
    );
  }, savedConfig);
  await navigate("register");
  const trigger = page.getByRole("button", {
    name: "Templates (30)",
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate((e) => {
    const scroller =
      document.querySelector(".ui-page-header").parentElement.lastElementChild;
    scroller.scrollTop += e.getBoundingClientRect().bottom - (innerHeight - 40);
  });
  await trigger.click();
  await page.waitForTimeout(100);
  result.menu = await page.locator(".ui-menu").evaluate(g);
  await page.screenshot({ path: `${out}/template-bottom.png` });
  if (!capture) {
    assert.ok(result.menu.y >= 16);
    assert.ok(result.menu.bottom <= 584);
    assert.ok(result.menu.x >= 16 && result.menu.right <= 784);
    const menu = page.locator(".ui-menu");
    for (const viewport of [
      { width: 1200, height: 800 },
      { width: 800, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await trigger.scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      const box = await menu.boundingBox();
      assert.ok(box.y >= 16 && box.y + box.height <= viewport.height - 16);
      assert.ok(box.x >= 16 && box.x + box.width <= viewport.width - 16);
    }
    await trigger.click();
    await trigger.evaluate((e) => {
      const root =
        document.querySelector(".ui-page-header").parentElement
          .lastElementChild;
      root.scrollTop += e.getBoundingClientRect().top - 100;
    });
    await trigger.click();
    await page.waitForTimeout(80);
    const below = await menu.boundingBox();
    assert.ok(below.y >= 16 && below.y + below.height <= 584);

    await menu.evaluate((e) => (e.scrollTop = e.scrollHeight));
    await menu.getByRole("button", { name: /Template 29/ }).click();
    assert.equal(await menu.count(), 0);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("kiro-register-config")).mode,
      ),
      "manual",
    );
  }

  await fs.writeFile(`${out}/review.json`, JSON.stringify(result, null, 2));
  console.log(
    capture
      ? "已捕获审查前边界与尺寸"
      : "通过：混合源按钮尺度、长方案徽标、表头/行列对齐、视口底部模板选择",
  );
}
