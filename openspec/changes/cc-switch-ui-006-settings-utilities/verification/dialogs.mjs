import assert from "node:assert/strict";
import fs from "node:fs/promises";
export async function verifyDialogs({ page, navigate, setAppearance, out }) {
  const report = [];
  const capture = async (name) => {
    const panel = page.locator(".ui-dialog-panel");
    await panel.waitFor();
    const data = await panel.evaluate((p) => {
      const r = p.getBoundingClientRect(),
        s = getComputedStyle(p),
        header = p.querySelector(".ui-dialog-header"),
        h = getComputedStyle(header);
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        right: r.right,
        bottom: r.bottom,
        radius: s.borderRadius,
        backdrop: getComputedStyle(p.parentElement.querySelector(":scope > div.absolute")).backgroundColor,
        padding: h.padding,
        title: getComputedStyle(header.querySelector("h2")).fontSize,
        scroll: p.scrollWidth <= p.clientWidth + 1,
      };
    });
    assert.equal(data.radius, "14px");
    assert.equal(data.backdrop,"rgba(0, 0, 0, 0)","遮罩只由公共 overlay 着色一次");
    assert.equal(data.padding, "20px 24px 12px");
    assert.equal(data.title, "16px");
    assert.ok(
      data.x >= 15 &&
        data.y >= 15 &&
        data.right <= page.viewportSize().width - 15 &&
        data.bottom <= page.viewportSize().height - 15,
      name,
    );
    assert.ok(data.scroll, `${name}: overflow`);
    report.push({ name, ...data });
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  for (const language of ["en", "zh"])
    for (const mode of ["light", "dark"]) {
      await setAppearance(language, mode);
      await page.setViewportSize({ width: 800, height: 600 });
      const suffix = `${language}-${mode}`;
      await navigate("machineId");
      await page
        .getByText(
          language === "en" ? "Account Machine ID" : "账户机器码管理",
          { exact: true },
        )
        .click();
      await capture(`bindings-${suffix}`);
      await page
        .locator(".ui-dialog-header")
        .getByRole("button")
        .last()
        .click();
      await page
        .getByText(language === "en" ? "Change History" : "变更历史记录", {
          exact: true,
        })
        .click();
      await capture(`history-${suffix}`);
      await page
        .locator(".ui-dialog-header")
        .getByRole("button")
        .last()
        .click();
      await navigate("kiroSettings");
      await page
        .getByRole("button", {
          name: language === "en" ? "Add MCP Server" : "添加 MCP 服务器",
          exact: true,
        })
        .click();
      await capture(`mcp-${suffix}`);
      await page
        .getByRole("button", {
          name: language === "en" ? "Cancel" : "取消",
          exact: true,
        })
        .click();
      await page
        .getByTitle(language === "en" ? "Edit internally" : "内部编辑", {
          exact: true,
        })
        .first()
        .click();
      await capture(`steering-${suffix}`);
      await page
        .locator(".ui-dialog-header")
        .getByRole("button")
        .last()
        .click();
      await navigate("about");
      await page
        .getByRole("button", {
          name: language === "en" ? "Check Updates" : "检查更新",
          exact: true,
        })
        .click();
      await capture(`update-${suffix}`);
      await navigate("home");
      await navigate("about");
      await page
        .getByRole("button", {
          name: language === "en" ? "Join Group" : "加入交流群",
          exact: true,
        })
        .click();
      await capture(`qr-${suffix}`);
      await navigate("home");
    }
  await fs.writeFile(`${out}/dialogs.json`, JSON.stringify(report, null, 2));
  console.log(`通过：${report.length} 组六类弹窗语言 / 明暗 / 窄窗口几何检查`);
}
