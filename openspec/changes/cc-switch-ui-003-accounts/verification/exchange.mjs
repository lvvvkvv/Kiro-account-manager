import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { mount, unmount } from "./dialogs.mjs";
import { seed, state } from "./accounts.mjs";
const require = createRequire(
  new URL("../../../../package.json", import.meta.url),
);
const normalize = (content) => {
  try {
    const obj = JSON.parse(content);
    if (obj.exportedAt) obj.exportedAt = 0;
    return JSON.stringify(obj);
  } catch {
    return content;
  }
};
export async function verifyExchange({ page, out, navigate, setAppearance }) {
  await setAppearance("en", "light");
  await page.setViewportSize({ width: 800, height: 600 });
  await navigate("accounts");
  await seed(page);
  const imports = [
    [
      "csv",
      '邮箱,昵称,登录方式,RefreshToken,ClientId,ClientSecret,Region\nnew@example.invalid,"Nick, ""Alias""",Google,token-csv,,,eu-west-1\ninvalid,,,,,,',
      1,
    ],
    ["txt", "new@example.invalid|token-txt|Nickname|Github\ninvalid", 1],
    ["txt", "new@example.invalid,token-comma,Nickname,Google\ninvalid", 1],
    [
      "txt",
      "new@example.invalid----no_password----token-kami----client----secret----Github\ninvalid",
      1,
    ],
    [
      "json",
      JSON.stringify({
        version: "1.7.6",
        accounts: [
          { ...(await state(page, "return s.accounts.get('fixture-0')")) },
          {
            ...(await state(page, "return s.accounts.get('fixture-0')")),
            id: "imported",
            email: "new@example.invalid",
            userId: "new-user",
          },
        ],
        groups: [],
        tags: [],
      }),
      1,
    ],
  ];
  const records = [];
  for (const [format, content, added] of imports) {
    await seed(page);
    await state(page, "s.setActiveGroupTab('group-a')");
    await page.evaluate((file) => (window.__answers.importFromFile = file), {
      format,
      content,
    });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    assert.equal(await state(page, "return s.accounts.size"), 8 + added);
    const acc = await state(
      page,
      "return [...s.accounts.values()].find(a=>a.email==='new@example.invalid')",
    );
    assert.ok(acc);
    assert.equal(acc.groupId, "group-a");
    if (format === "csv") {
      assert.equal(acc.nickname, 'Nick, "Alias"');
      assert.equal(acc.credentials.region, "eu-west-1");
    }
    if (content.includes("no_password")) {
      assert.equal(acc.password, undefined);
      assert.equal(acc.idp, "Github");
    }
    records.push({
      format,
      count: 8 + added,
      alerts: await page.evaluate(() => window.__alerts),
    });
  }
  await seed(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  assert.equal(await state(page, "return s.accounts.size"), 8);
  await page.evaluate(
    () =>
      (window.__answers.importFromFile = {
        format: "json",
        content: "invalid",
      }),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  assert.equal(await state(page, "return s.accounts.size"), 8);
  assert.ok(
    (await page.evaluate(() => window.__alerts)).includes("解析导入文件失败"),
  );
  // JSON skips duplicates; CSV/TXT retain the original append semantics, including duplicates.
  await page.evaluate(
    () =>
      (window.__answers.importFromFile = {
        format: "csv",
        content:
          "email,nickname,idp,token\nfixture0@example.invalid,,Google,duplicate-token",
      }),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  assert.equal(
    await state(
      page,
      "return [...s.accounts.values()].filter(a=>a.email==='fixture0@example.invalid').length",
    ),
    2,
  );
  const goldenPath = new URL("./export-golden.json", import.meta.url);
  let golden = {};
  if (!process.env.UI_CAPTURE_EXPORT)
    golden = JSON.parse(await fs.readFile(goldenPath, "utf8"));
  let baseline;
  if (process.env.UI_CAPTURE_EXPORT) {
    const ts = require("typescript");
    const source = await fs.readFile(
      path.join(process.env.UI_CAPTURE_EXPORT, "ExportDialog.tsx"),
      "utf8",
    );
    const ast = ts.createSourceFile("ExportDialog.tsx", source, 99, true, 4);
    let initializer;
    function visit(n) {
      if (
        ts.isVariableDeclaration(n) &&
        n.name.getText(ast) === "generateContent"
      )
        initializer = n.initializer.getText(ast);
      ts.forEachChild(n, visit);
    }
    visit(ast);
    baseline = new Function(
      "accounts",
      "includeCredentials",
      "exportAccounts",
      "format",
      ts.transpileModule(
        `const generateContent=${initializer};return generateContent(format);`,
        { compilerOptions: { target: 99 } },
      ).outputText,
    );
  }
  for (const scope of ["all", "selected"])
    for (const include of [true, false])
      for (const [format, label] of [
        ["json", "JSON"],
        ["oidc", "OIDC JSON"],
        ["txt", "TXT"],
        ["csv", "CSV"],
        ["kami", "Card Key"],
        ["clipboard", "Clipboard"],
      ]) {
        await seed(page);
        if (scope === "selected")
          await state(
            page,
            "store.setState({selectedIds:new Set(['fixture-1','fixture-3'])})",
          );
        await mount(page, "ExportDialog");
        const d = page.getByRole("dialog");
        await d
          .getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) })
          .click();
        const toggle = d.locator('input[type="checkbox"]');
        if (await toggle.count()) await toggle.setChecked(include);
        // OIDC/卡密沿用原强制包含规则，隐藏开关时状态默认 true。
        const effectiveInclude = (await toggle.count()) ? include : true;
        const exportData = await state(
          page,
          "return s.exportAccounts(s.selectedIds.size?[...s.selectedIds]:undefined)",
        );
        const accounts = await state(
          page,
          "return [...s.accounts.values()].filter(a=>!s.selectedIds.size||s.selectedIds.has(a.id))",
        );
        const key = `${scope}-${include}-${format}`;
        if (baseline)
          golden[key] = normalize(
            baseline(
              accounts,
              effectiveInclude,
              () => structuredClone(exportData),
              format,
            ),
          );
        if (format === "clipboard")
          await d.getByRole("button", { name: "Copy", exact: true }).click();
        else
          await d.getByRole("button", { name: "Export", exact: true }).click();
        const actual =
          format === "clipboard"
            ? await page.evaluate(() => window.__clipboard)
            : await page.evaluate(
                () =>
                  window.__calls.findLast((c) => c.name === "exportToFile")
                    .args[0],
              );
        assert.equal(normalize(actual), golden[key], key);
        if (format === "json") {
          const parsed = JSON.parse(actual);
          assert.equal(parsed.accounts.length, scope === "selected" ? 2 : 8);
          if (!include)
            assert.equal(parsed.accounts[0].credentials.refreshToken, "");
        }
        if (format === "csv") assert.ok(actual.startsWith("\ufeff"));
        await unmount(page);
      }
  await seed(page);
  await state(page, "store.setState({selectedIds:new Set(['fixture-1'])})");
  await navigate("settings");
  await page
    .getByRole("button", { name: "Export", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog", { name: "Export Accounts", exact: true })
    .waitFor();
  assert.ok(await page.getByText("All 8", { exact: true }).isVisible());
  await page.screenshot({ path: `${out}/settings-export.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate("accounts");
  if (baseline)
    await fs.writeFile(goldenPath, JSON.stringify(golden, null, 2) + "\n");
  await fs.writeFile(
    `${out}/import-results.json`,
    JSON.stringify(records, null, 2),
  );
  console.log(
    "通过：A01/A06 JSON/CSV/逗号TXT/竖线TXT/卡密、重复/无效/取消/分组；6导出×2范围×凭证选项与改前内容一致",
  );
}
