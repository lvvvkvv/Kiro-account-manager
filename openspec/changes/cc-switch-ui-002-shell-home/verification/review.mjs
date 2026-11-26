import assert from "node:assert/strict";
import fs from "node:fs/promises";

// 审查发现：必须验证实际组件经过cn合并后的样式，不能只验证原始Token类。
export async function verifyReview({ page, out }) {
  await page.setViewportSize({ width: 800, height: 600 });
  const sidebar = page.locator("aside");
  if ((await sidebar.boundingBox()).width !== 64)
    await sidebar
      .getByRole("button", { name: "Collapse", exact: true })
      .click();
  const alignment = await sidebar.evaluate((el) => {
    const logo = el
      .querySelector('[aria-label="Kiro"]')
      .getBoundingClientRect();
    const nav = el.querySelector("nav button").getBoundingClientRect();
    return { logo: logo.x + logo.width / 2, nav: nav.x + nav.width / 2 };
  });
  assert.equal(alignment.logo, alignment.nav);
  const nav = sidebar.locator("nav button").first();
  await nav.hover();
  assert.equal(
    (await page.getByRole("tooltip").boundingBox()).x -
      (await nav.boundingBox()).x -
      (await nav.boundingBox()).width,
    6,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  await page.evaluate(() => window.__emit("onShowCloseConfirmDialog"));
  const close = page.getByRole("dialog", { name: "Close Window", exact: true });
  await close.waitFor();
  const choices = await close
    .getByRole("button")
    .filter({ has: page.locator("span") })
    .evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect(),
          s = getComputedStyle(el),
          text = el.querySelector("span").getBoundingClientRect();
        return {
          height: b.height,
          padding: s.paddingTop,
          contentTop: text.top - b.top,
          contentBottom: b.bottom - text.bottom,
        };
      }),
    );
  assert.equal(choices.length, 2);
  for (const choice of choices)
    assert.deepEqual(choice, {
      height: 64,
      padding: "12px",
      contentTop: 13,
      contentBottom: 13,
    });
  await page.screenshot({ path: `${out}/review-close-800.png` });
  await close.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.evaluate(async () => {
    const { createElement: h, createRoot } =
      await import("/__shell_fixture__.js");
    const { cn } = await import("/src/lib/utils.ts");
    const { Badge } = await import("/src/components/ui/badge.tsx");
    const { Button } = await import("/src/components/ui/button.tsx");
    const { PageHeader } =
      await import("/src/components/layout/PageHeader.tsx");
    const host = document.createElement("div");
    host.id = "review-fixture";
    host.className = "fixed inset-0 z-40 bg-background";
    document.body.append(host);
    const roles = [
      ["text-badge", 11, 16, 500],
      ["text-caption", 12, 18, 400],
      ["text-body", 13, 20, 400],
      ["text-strong", 14, 20, 500],
      ["text-section", 15, 22, 600],
      ["text-title", 16, 24, 600],
      ["text-page", 18, 26, 600],
      ["text-metric", 24, 32, 600],
    ];
    window.__reviewRoot = createRoot(host);
    window.__reviewRoot.render(
      h(
        "div",
        null,
        h(PageHeader, {
          title: "Home",
          subtitle: "Overview",
          titleExtra: h(Badge, { "data-review-badge": true }, "Beta"),
          actions: h(Button, null, "Add account"),
        }),
        ...roles.map(([role, font, line, weight]) =>
          h(
            "div",
            {
              key: role,
              "data-font-role": role,
              "data-expected": `${font}/${line}/${weight}`,
              className: cn(role, "text-foreground"),
            },
            role,
          ),
        ),
        ...["default", "secondary", "success", "destructive", "outline"].map(
          (variant) =>
            h(
              Badge,
              { key: variant, variant, "data-badge-variant": variant },
              variant,
            ),
        ),
        h(
          Button,
          { className: "h-9", "data-size-override": true },
          "36px override",
        ),
        h(
          "div",
          {
            className: cn("rounded-control", "rounded-panel"),
            "data-radius-override": true,
          },
          "10px panel",
        ),
      ),
    );
  });
  const host = page.locator("#review-fixture");
  await host.locator("[data-font-role]").first().waitFor();
  const fonts = await host.locator("[data-font-role]").evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return {
        role: el.dataset.fontRole,
        expected: el.dataset.expected,
        actual: [
          parseFloat(s.fontSize),
          parseFloat(s.lineHeight),
          Number(s.fontWeight),
        ].join("/"),
      };
    }),
  );
  for (const font of fonts) assert.equal(font.actual, font.expected, font.role);
  const badges = await host.locator("[data-badge-variant]").evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return [
        s.fontSize,
        s.lineHeight,
        s.fontWeight,
        el.getBoundingClientRect().height,
      ];
    }),
  );
  for (const badge of badges)
    assert.deepEqual(badge, ["11px", "16px", "500", 20]);
  const extraGap = await host
    .locator("[data-review-badge]")
    .evaluate(
      (el) =>
        el.getBoundingClientRect().left -
        el.previousElementSibling.getBoundingClientRect().right,
    );
  assert.equal(extraGap, 4);
  assert.equal(
    (await host.locator("[data-size-override]").boundingBox()).height,
    36,
  );
  assert.equal(
    await host
      .locator("[data-radius-override]")
      .evaluate((el) => getComputedStyle(el).borderRadius),
    "10px",
  );
  await page.screenshot({ path: `${out}/review-merged-fonts-800.png` });
  await fs.writeFile(
    `${out}/review-geometry.json`,
    JSON.stringify({ alignment, choices, fonts, badges, extraGap }, null, 2),
  );
  await page.evaluate(() => {
    window.__reviewRoot.unmount();
    document.querySelector("#review-fixture").remove();
  });
  console.log(
    "通过：实际组件合并后的八种字号／五种徽标、尺寸与圆角覆盖、关闭选项内距、折叠品牌居中、6px提示及Escape、4px标题附加区",
  );
}
