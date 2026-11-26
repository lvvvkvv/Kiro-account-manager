import assert from "node:assert/strict";
import fs from "node:fs/promises";
export async function verifyReview({ page, navigate, out, setAppearance }) {
  await setAppearance("en", "light");
  await page.setViewportSize({ width: 800, height: 600 });
  const report = { icons: [], separators: [], overflow: [] };
  const icons = async (name, scope) => {
    const measures = await scope.locator("button").evaluateAll((buttons) =>
      buttons
        .filter(
          (b) =>
            !b.textContent.trim() &&
            b.querySelector("svg") &&
            b.getAttribute("role") !== "switch" &&
            b.getBoundingClientRect().width > 0,
        )
        .map((b) => {
          const r = b.getBoundingClientRect(),
            s = getComputedStyle(b);
          return {
            title: b.title || b.getAttribute("aria-label") || "",
            w: r.width,
            h: r.height,
            radius: s.borderRadius,
            padding: s.padding,
            svg: b.querySelector("svg").outerHTML.slice(0, 130),
          };
        }),
    );
    report.icons.push({ name, measures });
    if (!process.env.UI_CAPTURE_REVIEW)
      for (const m of measures) {
        assert.ok(
          Math.abs(m.w - 32) < 0.1 && Math.abs(m.h - 32) < 0.1,
          `${name} icon ${JSON.stringify(m)}`,
        );
        assert.equal(m.radius, "6px", `${name} icon radius`);
        assert.ok(m.title, `${name}: icon action has a name`);
      }
  };
  for (const view of [
    "settings",
    "machineId",
    "kiroSettings",
    "webhooks",
    "diagnose",
    "logs",
    "about",
  ]) {
    await navigate(view);
    if (view === "webhooks")
      await page.evaluate(async () => {
        const { useWebhookStore: s } = await import("/src/store/webhooks.ts");
        s.getState().addWebhook({
          kind: "custom",
          label: "Review fixture",
          url: "https://example.invalid/review",
          enabled: true,
          events: ["batch-completed"],
        });
      });
    await icons(view, page.locator(".ui-page-header").locator(".."));
    if (view === "kiroSettings") {
      report.separators = await page
        .locator(".ui-section > .rounded-panel > *")
        .evaluateAll((nodes) =>
          nodes.filter(n=>n.previousElementSibling).map((n) => ({
            ownTop: getComputedStyle(n).borderTopWidth,
            previousBottom: getComputedStyle(n.previousElementSibling)
              .borderBottomWidth,
          })),
        );
      if (!process.env.UI_CAPTURE_REVIEW)
        for (const m of report.separators)
          assert.ok(
            parseFloat(m.ownTop) + parseFloat(m.previousBottom) <= 1,
            JSON.stringify(m),
          );
      await page
        .getByRole("button", { name: "Add MCP Server", exact: true })
        .click();
      await icons("mcp", page.locator(".ui-dialog-panel"));
      await page.getByPlaceholder("Add argument").fill("review-arg");
      await page.getByPlaceholder("Add argument").press("Enter");
      await page
        .getByRole("button", { name: "Add Env Var", exact: true })
        .click();
      await icons("mcp-filled", page.locator(".ui-dialog-panel"));
      await page.screenshot({ path: `${out}/review-mcp.png` });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByTitle("Edit internally", { exact: true }).click();
      await icons("steering", page.locator(".ui-dialog-panel"));
      await page
        .locator(".ui-dialog-header")
        .getByRole("button")
        .last()
        .click();
    }
    if (view === "machineId") {
      await page.getByText("Account Machine ID", { exact: true }).click();
      await icons("bindings", page.locator(".ui-dialog-panel"));
      await page.getByPlaceholder("Search accounts...").fill("Fixture 0");
      await icons("bindings-search", page.locator(".ui-dialog-panel"));
      await page
        .locator(".ui-dialog-header")
        .getByRole("button")
        .last()
        .click();
    }
  }

  await page.getByRole("button", { name: "Expand", exact: true }).click();
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
    const m = await page
      .locator(".ui-page-header")
      .locator("..")
      .evaluate((e) => ({ width: e.clientWidth, total: e.scrollWidth }));
    report.overflow.push({ view, variant: "expanded-sidebar", ...m });
    if (!process.env.UI_CAPTURE_REVIEW) assert.ok(m.total <= m.width + 1, view);
  }
  await page.evaluate(() => {
    window.__kiro.mcpConfig.mcpServers = {
      "long-server-name": { command: "x".repeat(240), args: ["a".repeat(240)] },
    };
    window.__kiro.settings.trustedCommands = ["x".repeat(240)];
    window.__kiro.settings.trustedTools = { ["tool".repeat(60)]: true };
  });
  await navigate("kiroSettings");
  await page.getByText("Command Config", { exact: true }).click();
  const long = await page
    .locator(".ui-page-header")
    .locator("..")
    .evaluate((e) => ({ width: e.clientWidth, total: e.scrollWidth }));
  report.overflow.push({
    view: "kiroSettings",
    variant: "long-config",
    ...long,
  });
  await page.screenshot({ path: `${out}/review-long-kiro.png` });
  if (!process.env.UI_CAPTURE_REVIEW)
    assert.ok(long.total <= long.width + 1, "long Kiro config");
  await fs.writeFile(`${out}/review.json`, JSON.stringify(report, null, 2));
  console.log("通过：006 图标按钮与分组分隔线专项检查");
}
