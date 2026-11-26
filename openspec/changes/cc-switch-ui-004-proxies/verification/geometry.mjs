import assert from "node:assert/strict";
import fs from "node:fs/promises";
export async function verifyGeometry({ page, out, navigate, setAppearance }) {
  const results = [];
  const measure = async (view) => {
    const m = await page.evaluate(() => {
      const g = (e) => {
        const s = getComputedStyle(e),
          r = e.getBoundingClientRect();
        return {
          font: s.fontFamily,
          size: s.fontSize,
          line: s.lineHeight,
          radius: s.borderRadius,
          padding: [
            s.paddingTop,
            s.paddingRight,
            s.paddingBottom,
            s.paddingLeft,
          ],
          gap: s.gap,
          h: r.height,
          w: r.width,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        };
      };
      const visible = (e) => !!e.getBoundingClientRect().height;
      return {
        viewW: innerWidth,
        viewH: innerHeight,
        page: g(document.querySelector("h1")),
        header: g(document.querySelector(".ui-page-header")),
        dialogs: [...document.querySelectorAll("[role=dialog]")].map((e) => ({
          rect: g(e),
          header: g(e.querySelector(".ui-dialog-header")),
          title: g(e.querySelector(".text-title,h2")),
          body: g(
            e.querySelector(".ui-dialog-body") ||
              e.querySelector("[class*=flex-1]"),
          ),
        })),
        cards: [
          ...document.querySelectorAll(".glass-card:not(.ui-dialog-panel)"),
        ].map(g),
        footers: [...document.querySelectorAll(".ui-dialog-footer")].map(g),
        buttons: [...document.querySelectorAll("button.whitespace-nowrap")]
          .filter(visible)
          .map(g),
        sections: [...document.querySelectorAll(".text-section")]
          .filter(visible)
          .map(g),
        fields: [
          ...document.querySelectorAll("input:not([type=checkbox]),select"),
        ]
          .filter(visible)
          .map(g),
        switches: [...document.querySelectorAll("[role=switch]")]
          .filter(visible)
          .map(g),
        badges: [...document.querySelectorAll(".text-badge")]
          .filter(visible)
          .map(g),
      };
    });
    assert.equal(m.page.size, "18px", view);
    assert.equal(m.page.line, "26px", view);
    assert.ok(Math.abs(m.header.h - 52) < 0.1, view);
    for (const c of m.cards)
      assert.equal(c.radius, "10px", `${view}:panel radius`);
    for (const b of m.buttons) {
      assert.ok(
        [28, 32, 36].some((h) => Math.abs(b.h - h) < 0.1),
        `${view}:button height ${b.h}`,
      );
      assert.equal(b.size, "13px");
      assert.equal(b.gap, "6px");
    }
    for (const f of m.footers)
      assert.deepEqual(f.padding, ["12px", "24px", "20px", "24px"]);
    for (const s of m.sections) {
      assert.equal(s.size, "15px");
      assert.equal(s.line, "22px");
    }
    for (const f of m.fields) {
      assert.ok(Math.abs(f.h - 32) < 0.1, `${view}:field height`);
      assert.equal(f.size, "13px", `${view}:field font`);
      assert.equal(f.radius, "6px", `${view}:field radius`);
    }
    for (const sw of m.switches) {
      assert.ok(Math.abs(sw.w - 30) < 0.1);
      assert.ok(Math.abs(sw.h - 18) < 0.1);
    }
    for (const b of m.badges) {
      assert.equal(b.size, "11px");
      assert.ok(Math.abs(b.h - 20) < 0.1);
    }
    for (const d of m.dialogs) {
      assert.equal(d.rect.radius, "14px");
      assert.deepEqual(d.header.padding, ["20px", "24px", "12px", "24px"]);
      if (
        !view.startsWith("Proxy Detailed Logs") &&
        !view.startsWith("反代详细日志") &&
        d.body
      ) {
        assert.equal(d.body.padding[1], "24px");
        assert.equal(d.body.padding[3], "24px");
      }
      assert.equal(d.title.size, "16px");
      assert.equal(d.title.line, "24px");
      assert.ok(
        d.rect.left >= 15 && d.rect.right <= m.viewW - 15,
        `${view}:dialog horizontal reachability`,
      );
      assert.ok(
        d.rect.top >= 15 && d.rect.bottom <= m.viewH - 15,
        `${view}:dialog vertical reachability`,
      );
    }
    results.push({ view, ...m });
  };
  const screenshot = async (name) =>
    page.screenshot({ path: `${out}/${name}.png` });
  for (const [width, height] of [
    [800, 600],
    [1200, 1200],
  ]) {
    await page.setViewportSize({ width, height });
    for (const language of ["zh", "en"])
      for (const mode of ["light", "dark"]) {
        await setAppearance(language, mode);
        for (const view of ["proxy", "kproxy", "proxyPool"]) {
          await navigate(view);
          await measure(`${view}-${language}-${mode}-${width}`);
          await screenshot(`${view}-${language}-${mode}-${width}`);
          // Every visible action remains inside the page scroll area; horizontal proxy tables own their overflow.
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
        }
        // Render all dialogs through real page controls with bounded panels and independent scrolling.
        await page.evaluate(() => {
          window.__proxy.running = false;
          window.__proxy.config.enableMultiAccount = false;
        });
        await navigate("home");
        await navigate("proxy");
        const en = language === "en";
        for (const [trigger, title] of [
          [
            en ? "First Available" : "第一个可用账号",
            en ? "Select Account" : "选择账号",
          ],
          [
            en ? "View Models" : "查看模型",
            en ? "Available Models" : "可用模型",
          ],
          [
            en ? "Configure Clients" : "一键配置",
            en ? "One-Click Client Configuration" : "一键配置客户端",
          ],
          [en ? "View All" : "查看全部", en ? "Request Logs" : "请求日志"],
          [
            en ? "Detailed Logs" : "详细日志",
            en ? "Proxy Detailed Logs" : "反代详细日志",
          ],
        ]) {
          if (trigger === (en ? "View Models" : "查看模型"))
            await page
              .getByRole("button", {
                name: en ? "Start Service" : "启动服务",
                exact: true,
              })
              .click();
          await page
            .getByRole("button", { name: trigger, exact: true })
            .click();
          const d = page.getByRole("dialog", { name: title, exact: true });
          await d.waitFor();
          await page.waitForTimeout(100);
          await measure(`${title}-${language}-${mode}-${width}`);
          await screenshot(
            `dialog-${trigger.replaceAll(" ", "-")}-${language}-${mode}-${width}`,
          );
          if (trigger === (en ? "View Models" : "查看模型")) {
            await d
              .getByRole("button", {
                name: en ? "Mapping" : "映射",
                exact: true,
              })
              .click();
            const mapping = page.getByRole("dialog", {
              name: en ? "Model Mapping" : "模型映射",
              exact: true,
            });
            await mapping.waitFor();
            await measure(`mapping-${language}-${mode}-${width}`);
            await mapping
              .getByTitle(en ? "Close" : "关闭", { exact: true })
              .click();
          } else
            await d.getByTitle(en ? "Close" : "关闭", { exact: true }).click();
        }
        await page
          .getByTitle(en ? "Manage Multiple API Keys" : "管理多个 API Key", {
            exact: true,
          })
          .click();
        let d = page.getByRole("dialog", {
          name: en ? "API Key Management" : "API Key 管理",
          exact: true,
        });
        await d.getByText("Fixture key", { exact: true }).waitFor();
        await measure(`keymanager-${language}-${mode}-${width}`);
        await d.getByText("Fixture key", { exact: true }).click();
        await d
          .getByRole("button", {
            name: en ? "View Details" : "查看详情",
            exact: true,
          })
          .click();
        const usage = page.getByRole("dialog", {
          name: en ? "Usage Details" : "用量详情",
          exact: true,
        });
        await usage.waitFor();
        await measure(`usage-${language}-${mode}-${width}`);
        await screenshot(`usage-${language}-${mode}-${width}`);
        await usage.getByTitle(en ? "Close" : "关闭", { exact: true }).click();
        await d.getByTitle(en ? "Close" : "关闭", { exact: true }).click();
      }
  }
  // System mode follows the browser media preference using the same existing store path.
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await setAppearance("en", "system");
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      ),
      colorScheme === "dark",
    );
  }
  await fs.writeFile(`${out}/geometry.json`, JSON.stringify(results, null, 2));
  console.log(
    "通过：三页和全部8类弹窗，中文/英文×明/暗×800/1200，公共字体、32px字段、14px弹窗、开关/徽标与系统外观",
  );
}
