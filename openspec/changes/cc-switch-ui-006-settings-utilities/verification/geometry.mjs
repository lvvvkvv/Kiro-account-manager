import assert from "node:assert/strict";
import fs from "node:fs/promises";
const views = [
  "settings",
  "machineId",
  "kiroSettings",
  "webhooks",
  "diagnose",
  "configSync",
  "logs",
  "about",
];
export async function verifyGeometry({ page, out, navigate, setAppearance }) {
  const report = [];
  for (const viewport of [
    { width: 800, height: 600 },
    { width: 1200, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    for (const language of ["en", "zh"])
      for (const mode of ["light", "dark"]) {
        await setAppearance(language, mode);
        for (const view of views) {
          await navigate(view);
          await page.locator(".ui-page-header").waitFor();
          const data = await page.locator(".ui-page-header").evaluate((h) => {
            const box = (e) => {
              const r = e.getBoundingClientRect(),
                s = getComputedStyle(e);
              return {
                tag: e.tagName,
                x: r.x,
                y: r.y,
                w: r.width,
                h: r.height,
                font: s.fontSize,
                line: s.lineHeight,
                weight: s.fontWeight,
                radius: s.borderRadius,
                pad: s.padding,
                gap: s.gap,
                overflow: s.overflowY,
              };
            };
            const root = h.parentElement;
            return {
              header: box(h),
              title: box(h.querySelector("h1")),
              root: { width: root.clientWidth, scroll: root.scrollWidth },
              fields: [
                ...root.querySelectorAll(
                  "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=range]),select",
                ),
              ].map(box),
              rows: [...root.querySelectorAll(".ui-setting-row")].map(box),
              sections: [...root.querySelectorAll(".ui-section")].map(box),
              dark: document.documentElement.classList.contains("dark"),
            };
          });
          report.push({ view, language, mode, viewport, ...data });
          assert.equal(data.title.font, "18px", `${view}: title font`);
          assert.equal(data.title.line, "26px");
          assert.equal(data.title.weight, "600");
          assert.equal(data.dark, mode === "dark");
          assert.ok(data.header.h >= 51.9);
          assert.ok(
            data.root.scroll <= data.root.width + 1,
            `${view} horizontal overflow ${JSON.stringify(data.root)}`,
          );
          for (const f of data.fields) {
            assert.ok(
              Math.abs(f.h - 32) < 0.05,
              `${view}: field height ${f.h}`,
            );
            assert.equal(f.radius, "6px");
            assert.equal(f.font, "13px");
            assert.equal(f.line, f.tag === "SELECT" ? "normal" : "20px");
          }
          for (const r of data.rows) {
            assert.ok(r.h >= 51.9);
            assert.equal(r.gap, "16px");
          }
          await page.screenshot({
            path: `${out}/${view}-${language}-${mode}-${viewport.width}.png`,
          });
        }
      }
  }
  // System mode follows the OS without resetting language/privacy.
  await setAppearance("en", "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(100);
  assert.ok(
    await page.locator("html").evaluate((h) => h.classList.contains("dark")),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("html").evaluate((h) => h.classList.contains("dark")),
    false,
  );
  await fs.writeFile(`${out}/geometry.json`, JSON.stringify(report, null, 2));
  console.log(`通过：${report.length} 组八页语言 / 明暗 / 窗口几何检查`);
}
