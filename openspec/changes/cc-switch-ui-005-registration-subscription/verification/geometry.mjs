import assert from "node:assert/strict";
import fs from "node:fs/promises";
export async function verifyGeometry({ page, out, navigate, setAppearance }) {
  const records = [];
  const measure = async (name) => {
    const data = await page.evaluate(() => {
      const g = (e) => {
        const s = getComputedStyle(e),
          r = e.getBoundingClientRect();
        return {
          size: s.fontSize,
          line: s.lineHeight,
          weight: s.fontWeight,
          font: s.fontFamily,
          radius: s.borderRadius,
          h: r.height,
          w: r.width,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          gap: s.gap,
          padding: [
            s.paddingTop,
            s.paddingRight,
            s.paddingBottom,
            s.paddingLeft,
          ],
        };
      };
      const visible = (e) => e.getBoundingClientRect().height > 0;
      return {
        title: g(document.querySelector("h1")),
        header:
          document.querySelector(".ui-page-header") &&
          g(document.querySelector(".ui-page-header")),
        checkboxes: [...document.querySelectorAll("input[type=checkbox]")]
          .filter(visible)
          .map(g),
        cards: [...document.querySelectorAll(".glass-card")]
          .filter(visible)
          .map(g),
        fields: [
          ...document.querySelectorAll(
            "input:not([type=checkbox]):not([type=file]),select",
          ),
        ]
          .filter(visible)
          .map(g),
        buttons: [...document.querySelectorAll("button.whitespace-nowrap")]
          .filter(visible)
          .map(g),
        badges: [...document.querySelectorAll(".text-badge")]
          .filter(visible)
          .map(g),
        sections: [...document.querySelectorAll(".text-section")]
          .filter(visible)
          .map(g),
        switches: [...document.querySelectorAll("[role=switch]")]
          .filter(visible)
          .map(g),
        groups: [...document.querySelectorAll(".ui-segmented")].map(g),
        dialogs: [...document.querySelectorAll("[role=dialog]")].map((e) => ({
          panel: g(e),
          header: g(e.querySelector(".ui-dialog-header")),
          body: g(e.querySelector(".ui-dialog-body")),
          footer: g(e.querySelector(".ui-dialog-footer")),
          title: g(e.querySelector("h2")),
        })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    if (!process.env.UI_BEFORE) {
      assert.equal(data.title.size, "18px", name);
      assert.equal(data.title.line, "26px");
      assert.equal(data.header.h, 52);
      assert.equal(data.overflow, false, name);
      for (const c of data.checkboxes) {
        assert.equal(c.h, 16);
        assert.equal(c.w, 16);
        assert.equal(c.radius, "4px");
        assert.deepEqual(c.padding, ["0px", "0px", "0px", "0px"]);
      }
      for (const c of data.cards) assert.equal(c.radius, "10px");
      for (const f of data.fields) {
        assert.equal(f.h, 32, name);
        assert.equal(f.size, "13px");
        assert.equal(f.radius, "6px");
      }
      for (const b of data.buttons) {
        assert.ok([28, 32, 36].includes(b.h), `${name}:button ${b.h}`);
        assert.equal(b.size, "13px");
        assert.equal(b.gap, "6px");
        assert.equal(b.radius, "6px");
      }
      for (const b of data.badges) {
        assert.equal(b.h, 20);
        assert.equal(b.size, "11px");
      }
      for (const s of data.sections) {
        assert.equal(s.size, "15px");
        assert.equal(s.line, "22px");
      }
      for (const s of data.switches) {
        assert.equal(s.h, 18);
        assert.equal(s.w, 30);
      }
      for (const g of data.groups) {
        assert.equal(g.h, 36);
        assert.equal(g.radius, "10px");
      }
      for (const d of data.dialogs) {
        assert.equal(d.panel.radius, "14px");
        assert.deepEqual(d.header.padding, ["20px", "24px", "12px", "24px"]);
        assert.deepEqual(d.footer.padding, ["12px", "24px", "20px", "24px"]);
        assert.equal(d.title.size, "16px");
        assert.equal(d.body.padding[1], "24px");
        assert.ok(
          d.panel.left >= 16 &&
            d.panel.right <= (await page.evaluate(() => innerWidth)) - 16,
        );
        assert.ok(
          d.panel.bottom <= (await page.evaluate(() => innerHeight)) - 16,
        );
      }
    }
    records.push({ name, ...data });
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  for (const viewport of [
    { width: 800, height: 600 },
    { width: 1200, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    for (const language of ["zh", "en"])
      for (const mode of ["light", "dark"]) {
        await setAppearance(language, mode);
        await navigate("register");
        const group = process.env.UI_BEFORE
          ? page
              .getByRole("button", {
                name: language === "en" ? "Manual" : "手动",
                exact: true,
              })
              .locator("..")
              .getByRole("button")
          : page.locator(".ui-segmented").first().getByRole("button");
        const labels = await group.allTextContents();
        for (const label of labels) {
          await group.filter({ hasText: label.trim() }).first().click();
          await measure(
            `register-${label.trim()}-${language}-${mode}-${viewport.width}`,
          );
        }
        await navigate("subscription");
        for (const tab of [
          language === "en" ? "Overage Settings" : "超额设置",
          language === "en" ? "Subscription Links" : "获取链接",
          language === "en" ? "Manage Subscriptions" : "订阅管理",
        ]) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          await measure(
            `subscription-${tab}-${language}-${mode}-${viewport.width}`,
          );
        }
        await page
          .getByRole("button", {
            name: language === "en" ? "Subscription Links" : "获取链接",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: language === "en" ? "Import" : "导入链接",
            exact: true,
          })
          .click();
        await page
          .locator("textarea")
          .fill(
            "x".repeat(500) + " https://example.invalid/" + "x".repeat(300),
          );
        await measure(`import-${language}-${mode}-${viewport.width}`);
        await page
          .getByRole("button", {
            name: language === "en" ? "Cancel" : "取消",
            exact: true,
          })
          .click();
      }
  }
  await setAppearance("en", "system");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.locator("html").getAttribute("class"), "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("dark"),
  );
  assert.notEqual(await page.locator("html").getAttribute("class"), "dark");
  await fs.writeFile(`${out}/geometry.json`, JSON.stringify(records, null, 2));
  console.log(
    `通过：${records.length} 项页面/模式/Tab/弹窗几何与截图、系统外观`,
  );
}

// 最小窗口展开侧栏与长模板菜单；这些领域区域各自承担滚动。
export async function verifyCompact({ page, out, navigate, setAppearance }) {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  const records = [];
  for (const mode of ["light", "dark"]) {
    await setAppearance("en", mode);
    await navigate("register");
    const buttons = page.locator(".ui-segmented").first().getByRole("button");
    const names = await buttons.allTextContents();
    for (const name of names) {
      await buttons.filter({ hasText: name.trim() }).first().click();
      const sizes = await page.evaluate(() => {
        const root =
          document.querySelector(".ui-page-header").parentElement
            .lastElementChild;
        return { client: root.clientWidth, scroll: root.scrollWidth };
      });
      assert.ok(
        sizes.scroll <= sizes.client + 1,
        `expanded ${mode} ${name}: page horizontal overflow`,
      );
      records.push({ mode, name: name.trim(), ...sizes });
    }
    await navigate("subscription");
    for (const name of [
      "Overage Settings",
      "Subscription Links",
      "Manage Subscriptions",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({ path: `${out}/expanded-${mode}-${name}.png` });
    }
  }
  await page.evaluate(() =>
    localStorage.setItem(
      "kiro-register-templates",
      JSON.stringify([
        {
          id: "long-template",
          name: "Long template ".repeat(80),
          config: { mode: "gptmail", gptMailDomain: "example.invalid" },
          createdAt: Date.now(),
        },
      ]),
    ),
  );
  await navigate("register");
  await page.getByRole("button", { name: /Templates \(1\)/ }).click();
  const bounds = await page.locator(".ui-menu").evaluate((e) => {
    const r = e.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      width: r.width,
      scroll: e.scrollWidth,
      client: e.clientWidth,
    };
  });
  assert.ok(bounds.left >= 16 && bounds.right <= 784);
  assert.ok(bounds.scroll <= bounds.client + 1);
  await page.screenshot({ path: `${out}/long-template-expanded.png` });
  await fs.writeFile(
    `${out}/compact.json`,
    JSON.stringify({ records, menu: bounds }, null, 2),
  );
  console.log("通过：800×600 展开侧栏六模式/三 Tab，长模板菜单边界与操作可达");
}
