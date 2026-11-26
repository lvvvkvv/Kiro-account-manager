import assert from "node:assert/strict";
import fs from "node:fs/promises";
export const state = (page, code, arg) =>
  page.evaluate(
    new Function(
      "arg",
      `return import('/src/store/accounts.ts').then(({useAccountsStore})=>{const s=useAccountsStore.getState(),store=useAccountsStore;${code}})`,
    ),
    arg,
  );
export const seed = async (page, count = 8) => {
  await page.evaluate((n) => window.__seed(n), count);
  await page.waitForTimeout(100);
};
export const ids = (page) =>
  state(page, "return s.getFilteredAccounts().map(a=>a.id).sort()");
export async function verifyAccounts({ page, out, navigate, setAppearance }) {
  await navigate("accounts");
  await seed(page);
  assert.equal((await ids(page)).length, 8);
  await page.getByRole("tab", { name: "Group A 4", exact: true }).click();
  assert.deepEqual(await ids(page), [
    "fixture-0",
    "fixture-2",
    "fixture-4",
    "fixture-6",
  ]);
  await page.getByPlaceholder("Search accounts...").fill("fixture0");
  assert.deepEqual(await ids(page), ["fixture-0"]);
  await page.getByTitle("Select all", { exact: true }).click();
  assert.deepEqual(await state(page, "return [...s.selectedIds]"), [
    "fixture-0",
  ]);
  await page.getByTitle("List view", { exact: true }).click();
  assert.deepEqual(await state(page, "return [...s.selectedIds]"), [
    "fixture-0",
  ]);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("accounts_viewMode")),
    "list",
  );
  await page.getByTitle("Grid view", { exact: true }).click();
  await page.getByPlaceholder("Search accounts...").fill("");
  await page.getByTitle("Clear 1 selected", { exact: true }).click();
  assert.equal(await state(page, "return s.selectedIds.size"), 0);
  await page.getByRole("tab", { name: "All 8", exact: true }).click();
  await page.getByTitle("Toggle advanced filter").click();
  await page.getByRole("button", { name: "Expired(1)", exact: true }).click();
  assert.deepEqual(await ids(page), ["fixture-2"]);
  await state(
    page,
    "s.setFilter({statuses:['expired'],tagIds:['tag-a'],usageMin:.1,usageMax:.9,emailDomains:['example.invalid']})",
  );
  assert.deepEqual(await ids(page), ["fixture-2"]);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal((await ids(page)).length, 8);
  await page.getByTitle("Toggle advanced filter").click();
  await state(
    page,
    "store.setState({selectedIds:new Set(['fixture-0','fixture-1'])})",
  );
  await page.getByTitle("Delete 2 selected accounts", { exact: true }).click();
  assert.equal(await state(page, "return s.accounts.size"), 8);
  assert.equal(await state(page, "return s.selectedIds.size"), 2);
  await page.getByTitle("Switch group view / Manage").click();
  await page.getByTitle("Move 2 selected here").last().click();
  assert.equal(
    await state(page, "return s.accounts.get('fixture-0').groupId"),
    "group-b",
  );
  await page.getByTitle("Set tags for 2 selected").click();
  await page.getByRole("button", { name: /^Green/ }).click();
  assert.equal(
    await state(
      page,
      "return s.accounts.get('fixture-1').tags.includes('tag-b')",
    ),
    true,
  );
  await page.getByRole("button", { name: /^Green/ }).click();
  assert.equal(
    await state(
      page,
      "return s.accounts.get('fixture-0').tags.includes('tag-b')",
    ),
    false,
  );
  await page.getByTitle("Bind 2 selected accounts to a proxy").click();
  await page
    .getByRole("button", { name: /proxy.example.invalid:8080/ })
    .click();
  assert.deepEqual(await state(page, "return s.accountProxyBindings"), {
    "fixture-0": "proxy-a",
    "fixture-1": "proxy-a",
  });
  await page.getByTitle("Bind 2 selected accounts to a proxy").click();
  await page
    .getByRole("button", { name: "Unbind selected (2)", exact: true })
    .click();
  assert.deepEqual(await state(page, "return s.accountProxyBindings"), {});
  await page.getByTitle("Refresh 2 access tokens").click();
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .findLast((c) => c.name === "backgroundBatchRefresh")
        .args[0].map((a) => a.id),
    ),
    ["fixture-0", "fixture-1"],
  );
  await page
    .getByTitle("Check 2 accounts info (usage / subscription / banned)")
    .click();
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .findLast((c) => c.name === "backgroundBatchCheck")
        .args[0].map((a) => a.id),
    ),
    ["fixture-0", "fixture-1"],
  );
  await seed(page, 61);
  const seen = {};
  for (const view of ["Grid", "List"]) {
    await page.getByTitle(`${view} view`, { exact: true }).click();
    seen[view] = new Set();
    const scroll = page.locator('div[style*="contain: strict"]');
    for (let i = 0; i < 100; i++) {
      for (const id of await page
        .locator("[data-account-id]")
        .evaluateAll((es) => es.map((e) => e.dataset.accountId)))
        seen[view].add(id);
      const bottom = await scroll.evaluate((e) => {
        const done = e.scrollTop + e.clientHeight >= e.scrollHeight - 2;
        e.scrollTop += Math.max(100, e.clientHeight - 20);
        return done;
      });
      await page.waitForTimeout(25);
      if (bottom) break;
    }
    assert.equal(seen[view].size, 61, `${view}: 每个账号可达`);
    await page
      .getByText("Add Account", { exact: true })
      .last()
      .scrollIntoViewIfNeeded();
    assert.equal(
      await page.getByText("Add Account", { exact: true }).last().isVisible(),
      true,
    );
    await scroll.evaluate((e) => (e.scrollTop = 0));
    const rows = await page.locator("[data-account-id]").evaluateAll((es) =>
      es.map((e) => ({
        id: e.dataset.accountId,
        height: e.getBoundingClientRect().height,
        radius: getComputedStyle(e).borderRadius,
        shadow: getComputedStyle(e).boxShadow,
      })),
    );
    for (const row of rows) {
      assert.equal(row.radius, "10px");
      assert.equal(row.height, view === "Grid" ? 404 : 72);
    }
  }
  await seed(page, 8);
  for (const [width, height] of [
    [800, 600],
    [1200, 1200],
  ])
    for (const language of ["zh", "en"])
      for (const mode of ["light", "dark"])
        for (const view of ["grid", "list"]) {
          await page.setViewportSize({ width, height });
          await setAppearance(language, mode);
          await page
            .getByTitle(
              view === "grid"
                ? language === "en"
                  ? "Grid view"
                  : "卡片视图"
                : language === "en"
                  ? "List view"
                  : "列表视图",
              { exact: true },
            )
            .click();
          const geometry = await page.evaluate(() => {
            const e = document.querySelector(".ui-page-title"),
              h = document.querySelector(".ui-page-header"),
              input = document.querySelector("input[placeholder]");
            return {
              font: getComputedStyle(e).fontSize,
              line: getComputedStyle(e).lineHeight,
              header: h.getBoundingClientRect().height,
              left: getComputedStyle(h).paddingLeft,
              input: input.getBoundingClientRect().height,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.deepEqual(geometry, {
            font: "18px",
            line: "26px",
            header: 52,
            left: "24px",
            input: 32,
            overflow: false,
          });
          await page.screenshot({
            path: `${out}/${language}-${mode}-${width}-${view}.png`,
          });
        }
  await setAppearance("en", "light");
  await page.setViewportSize({ width: 1200, height: 1200 });
  await page.getByTitle("Grid view", { exact: true }).click();
  await seed(page);
  const textGeometry = await page
    .locator("[data-account-id]")
    .first()
    .evaluate((e) => {
      const title = e.querySelector("h3"),
        badge = e.querySelector(".text-badge"),
        button = e.querySelector('button[title="Details"]');
      const t = getComputedStyle(title),
        b = getComputedStyle(badge),
        c = getComputedStyle(button);
      return {
        title: [t.fontSize, t.lineHeight, t.fontWeight],
        badge: [b.fontSize, b.lineHeight],
        control: [c.height, c.width, c.borderRadius],
      };
    });
  assert.deepEqual(textGeometry, {
    title: ["14px", "20px", "500"],
    badge: ["11px", "16px"],
    control: ["28px", "28px", "6px"],
  });
  // ResizeObserver follows sidebar width; the fixed virtual slots always match actual cards.
  for (const width of [800, 1200]) {
    await page.setViewportSize({ width, height: 600 });
    await page
      .locator("aside")
      .getByRole("button", { name: "Expand", exact: true })
      .click();
    await page.waitForTimeout(150);
    const expanded = await page
      .locator("[data-account-id]")
      .first()
      .boundingBox();
    assert.ok(expanded.width >= 300);
    await page
      .locator("aside")
      .getByRole("button", { name: "Collapse", exact: true })
      .click();
    await page.waitForTimeout(150);
    const collapsed = await page
      .locator("[data-account-id]")
      .first()
      .boundingBox();
    assert.ok(collapsed.width >= 300);
    if (width === 800) assert.ok(expanded.width > collapsed.width);
  }
  // Long fields and bound/banned combinations cannot clip their last action.
  await page.setViewportSize({ width: 800, height: 600 });
  await page.getByTitle("List view", { exact: true }).click();
  await state(page, "s.bindAccountsToProxy(['fixture-1'],'proxy-a')");
  const listScroll = page.locator('div[style*="contain: strict"]');
  await listScroll.evaluate((e) => (e.scrollLeft = e.scrollWidth));
  const rowOverflow = await page
    .locator('[data-account-id="fixture-1"]')
    .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  assert.ok(
    rowOverflow.scroll <= rowOverflow.width,
    JSON.stringify(rowOverflow),
  );
  await listScroll.evaluate((e) => (e.scrollLeft = 0));
  await page.getByTitle("Grid view", { exact: true }).click();
  await seed(page, 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Add First Account", exact: true })
      .isVisible(),
    true,
  );
  await page.getByTitle("List view", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Add First Account", exact: true })
      .isVisible(),
    true,
  );
  await seed(page);
  await page.getByTitle("Grid view", { exact: true }).click();
  await state(page, "s.setTheme('system')");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(50);
  assert.equal(
    await page.locator("html").evaluate((e) => e.classList.contains("dark")),
    true,
  );
  await page.emulateMedia({ colorScheme: "light" });
  await fs.writeFile(
    `${out}/virtualization.json`,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(seen).map(([k, v]) => [k, [...v].sort()]),
      ),
      null,
      2,
    ),
  );
  console.log(
    "通过：A03/A05/A07 搜索分组筛选、选中集合、批量目标/取消、代理绑定、61项虚拟滚动、16种视图",
  );
}
