import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { seed, state } from "./accounts.mjs";
export async function mount(page, name, props = {}) {
  await page.evaluate(
    async ({ name, props }) => {
      const { createElement } = await import("/__shell_fixture__.js");
      const { createRoot } = await import("/__shell_fixture__.js");
      if (window.__dialogRoot) window.__dialogRoot.unmount();
      window.__dialogHost?.remove();
      const host = document.createElement("div");
      document.body.append(host);
      window.__dialogHost = host;
      const root = createRoot(host);
      window.__dialogRoot = root;
      window.__closed = 0;
      const close = () => {
        if (window.__dialogRoot !== root) return;
        window.__closed++;
        root.render(null);
      };
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      const s = useAccountsStore.getState();
      if (["AccountDetailDialog", "EditAccountDialog"].includes(name))
        props.account = s.accounts.get(props.accountId || "fixture-0");
      if (name === "ExportDialog") {
        props.accounts = [...s.accounts.values()].filter(
          (a) => !s.selectedIds.size || s.selectedIds.has(a.id),
        );
        props.selectedCount = s.selectedIds.size;
      }
      const { [name]: Component } = await import(
        `/src/components/accounts/${name}.tsx`
      );
      root.render(
        createElement(Component, {
          ...props,
          isOpen: true,
          open: true,
          onClose: close,
          onOpenChange: (open) => {
            if (!open) close();
          },
          onRefresh: () => s.checkAccountStatus("fixture-0"),
        }),
      );
    },
    { name, props },
  );
  await page.getByRole("dialog").last().waitFor();
  await page.waitForTimeout(100);
}
export async function unmount(page) {
  await page.evaluate(() => {
    window.__dialogRoot?.unmount();
    window.__dialogRoot = null;
    window.__dialogHost?.remove();
  });
}
export async function verifyDialogs({ page, out, navigate, setAppearance }) {
  await navigate("home");
  await seed(page);
  const metrics = [];
  for (const language of ["zh", "en"])
    for (const mode of ["light", "dark"]) {
      await page.setViewportSize({ width: 800, height: 600 });
      await setAppearance(language, mode);
      for (const name of [
        "AddAccountDialog",
        "EditAccountDialog",
        "AccountDetailDialog",
        "GroupManageDialog",
        "TagManageDialog",
        "ExportDialog",
      ]) {
        await mount(page, name);
        const dialog = page.getByRole("dialog").last();
        const g = await dialog.evaluate((e) => {
          const h = e.querySelector(".ui-dialog-header"),
            b = e.querySelector(".ui-dialog-body"),
            s = getComputedStyle(e),
            hs = getComputedStyle(h);
          return {
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
            radius: s.borderRadius,
            header: [hs.paddingTop, hs.paddingRight, hs.paddingBottom],
            bodyX: getComputedStyle(b).paddingLeft,
            bodyScroll: getComputedStyle(b).overflowY,
            bottom: e.getBoundingClientRect().bottom,
            controls: [
              ...e.querySelectorAll(
                'input:not([type="checkbox"]):not([type="color"]):not([type="range"]),select',
              ),
            ].map((x) => ({
              height: x.getBoundingClientRect().height,
              radius: getComputedStyle(x).borderRadius,
              font: getComputedStyle(x).fontSize,
            })),
          };
        });
        assert.equal(g.radius, "14px");
        assert.deepEqual(g.header, ["20px", "24px", "12px"]);
        assert.equal(g.bodyX, "24px");
        assert.equal(g.bodyScroll, "auto");
        assert.ok(g.width <= 768 && g.height <= 540 && g.bottom <= 600);
        for (const c of g.controls) {
          assert.equal(c.height, 32);
          assert.equal(c.radius, "6px");
          assert.equal(c.font, "13px");
        }
        metrics.push({ language, mode, name, ...g });
        await page.screenshot({
          path: `${out}/dialog-${name}-${language}-${mode}.png`,
        });
        await unmount(page);
      }
    }
  await setAppearance("en", "light");
  await seed(page);
  await mount(page, "EditAccountDialog");
  const edit = page.getByRole("dialog");
  await edit.locator("input").first().fill("Changed alias");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await state(page, "return s.accounts.get('fixture-0').nickname"),
    "Fixture 0",
  );
  await mount(page, "EditAccountDialog");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__clipboard), "access-0");
  await page
    .getByRole("button", { name: "Verify & Refresh", exact: true })
    .click();
  await page.waitForTimeout(100);
  assert.equal(
    await page
      .getByText("refresh-0@example.invalid", { exact: true })
      .isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await state(page, "return s.accounts.get('fixture-0').email"),
    "fixture0@example.invalid",
  );
  await mount(page, "EditAccountDialog");
  await page.getByRole("dialog").locator("input").first().fill("Changed alias");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  assert.equal(
    await state(page, "return s.accounts.get('fixture-0').nickname"),
    "Changed alias",
  );
  await mount(page, "AccountDetailDialog");
  assert.equal(
    await page.getByText("fixture-model", { exact: true }).isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  assert.equal(
    await state(page, "return s.accounts.get('fixture-0').usage.current"),
    42,
  );
  await unmount(page);
  // 分组/标签创建、编辑、删除和取消均走原 handler。
  for (const [name, noun] of [
    ["GroupManageDialog", "Group"],
    ["TagManageDialog", "Tag"],
  ]) {
    await mount(page, name);
    const d = page.getByRole("dialog");
    await d
      .getByRole("button", {
        name: new RegExp(`(?:Create|New|Add).*${noun}`, "i"),
      })
      .click();
    await d.locator('input[type="text"]').first().fill(`New ${noun}`);
    await d.locator('input[type="color"]').first().fill("#123456");
    await d.getByRole("button", { name: /^(Create|创建)$/ }).click();
    const id = await state(
      page,
      `return [...s.${noun === "Group" ? "groups" : "tags"}.values()].find(x=>x.name==='New ${noun}')?.id`,
    );
    assert.ok(id);
    assert.equal(
      await state(
        page,
        `return s.${noun === "Group" ? "groups" : "tags"}.get(arg).color`,
        id,
      ),
      noun === "Group" ? "#123456" : "#ff123456",
    );
    await d.getByTitle("Manage accounts").last().click();
    await d
      .getByRole("button", { name: "fixture0@example.invalid", exact: true })
      .click();
    assert.equal(
      await state(
        page,
        noun === "Group"
          ? "return s.accounts.get('fixture-0').groupId===arg"
          : "return s.accounts.get('fixture-0').tags.includes(arg)",
        id,
      ),
      true,
    );
    await d.getByRole("button", { name: /^(Done|完成)$/ }).click();
    const row = d;
    await row.getByTitle("Edit").last().click();
    await d.locator('input[type="text"]').first().fill(`Edited ${noun}`);
    await d.getByRole("button", { name: /^(Save|保存)$/ }).click();
    assert.equal(
      await state(
        page,
        `return s.${noun === "Group" ? "groups" : "tags"}.get(arg).name`,
        id,
      ),
      `Edited ${noun}`,
    );
    await d.getByTitle("Delete").last().click();
    assert.ok(
      await state(
        page,
        `return s.${noun === "Group" ? "groups" : "tags"}.has(arg)`,
        id,
      ),
    );
    await page.evaluate(() => (window.__confirmAnswer = true));
    await d.getByTitle("Delete").last().click();
    assert.equal(
      await state(
        page,
        `return s.${noun === "Group" ? "groups" : "tags"}.has(arg)`,
        id,
      ),
      false,
    );
    await page.evaluate(() => (window.__confirmAnswer = false));
    await unmount(page);
  }
  await fs.writeFile(
    `${out}/dialog-geometry.json`,
    JSON.stringify(metrics, null, 2),
  );
  console.log(
    "通过：6类弹窗×4种外观，公共几何、详情刷新、编辑保存/取消、分组标签 CRUD",
  );
}
