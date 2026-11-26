// 对改前命名函数变量、状态与副作用 Hook、IPC 和 JSX 业务属性做结构比较；运行回归另测接线和结果。
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../../../package.json", import.meta.url),
);
const ts = require("typescript");
export const files = [
  "pages/SettingsPage.tsx",
  "pages/MachineIdPage.tsx",
  "pages/KiroSettingsPage.tsx",
  "pages/WebhooksPage.tsx",
  "pages/DiagnosePage.tsx",
  "pages/ConfigSyncPage.tsx",
  "pages/LogsPage.tsx",
  "pages/AboutPage.tsx",
  "kiro/McpServerEditor.tsx",
  "kiro/SteeringEditor.tsx",
];
export function fingerprint(source, file) {
  const ast = ts.createSourceFile(file, source, 99, true, 4),
    entries = {};
  const shape = (n) => {
    // Prettier removes quotes around valid object keys (e.g. 'ok'); their semantics are identical.
    if (
      (ts.isIdentifier(n) || ts.isStringLiteral(n)) &&
      n.parent &&
      (ts.isPropertyAssignment(n.parent) || ts.isPropertySignature(n.parent)) &&
      n.parent.name === n
    )
      return `property-key:${n.text}`;
    // Prettier converts JSX whitespace into {" "}; compare the rendered text, not that representation.
    if (ts.isJsxText(n))
      return n.text.trim() ? `jsx-text:${n.text.trim()}` : "";
    if (
      ts.isJsxExpression(n) &&
      n.expression &&
      ts.isStringLiteral(n.expression)
    )
      return n.expression.text.trim()
        ? `jsx-text:${n.expression.text.trim()}`
        : "";

    if (ts.isParenthesizedExpression(n) || ts.isParenthesizedTypeNode(n))
      return shape(n.expression || n.type);
    if (
      ts.isJsxAttribute(n) &&
      [
        "className",
        "style",
        "title",
        "aria-label",
        "role",
        "aria-modal",
        "aria-labelledby",
        "aria-pressed",
        "aria-selected",
        "data-proxy-id",
      ].includes(n.name.getText(ast))
    )
      return "";
    if (
      ts.isIdentifier(n) ||
      ts.isStringLiteral(n) ||
      ts.isNumericLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isRegularExpressionLiteral(n)
    )
      return `${n.kind}:${n.text}`;
    const children = [];
    ts.forEachChild(n, (c) => {
      const v = shape(c);
      if (v) children.push(v);
    });
    return `${n.kind}(${children.join(",")})`;
  };
  const add = (key, n) => {
    const index = Object.keys(entries).filter((k) =>
      k.startsWith(key + "#"),
    ).length;
    entries[key + "#" + index] = crypto
      .createHash("sha256")
      .update(shape(n))
      .digest("hex");
  };
  function visit(n) {
    // Freeze module ownership, storage keys and initial data in addition to hooks/callbacks.
    if (
      ts.isVariableDeclaration(n) &&
      ts.isSourceFile(n.parent?.parent?.parent)
    )
      add("module:" + n.name.getText(ast), n);

    if (
      ts.isCallExpression(n) &&
      (/^(useEffect|useMemo|useCallback|useState|useRef|useVirtualizer)$/.test(
        n.expression.getText(ast),
      ) ||
        n.expression.getText(ast).startsWith("window.api."))
    )
      add(n.expression.getText(ast), n);
    if (
      ts.isJsxAttribute(n) &&
      /^(on[A-Z]|value$|checked$|disabled$|min$|max$|step$|readOnly$|type$|ref$|accounts$|mappings$|logs$|selectedAccountId$|apiKeys$|availableModels$|config$|setConfig$|isRunning$|filtered$|selectedIds$)/.test(
        n.name.getText(ast),
      )
    )
      add("jsx:" + n.name.getText(ast), n);
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer))
    )
      add("fn:" + n.name.getText(ast), n.initializer);
    if (ts.isFunctionDeclaration(n) && n.name) {
      let hasJsx = false;
      const inspect = (c) => {
        if (
          ts.isJsxElement(c) ||
          ts.isJsxSelfClosingElement(c) ||
          ts.isJsxFragment(c)
        )
          hasJsx = true;
        else ts.forEachChild(c, inspect);
      };
      inspect(n);
      if (!hasJsx) add("function:" + n.name.text, n);
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return entries;
}
export async function verifySource(appRoot) {
  const root = path.join(appRoot, "src/renderer/src/components"),
    goldenUrl = new URL("./business-contract.json", import.meta.url);
  if (process.env.UI_CAPTURE_SOURCE) {
    const golden = {};
    for (const file of files)
      golden[file] = fingerprint(
        await fs.readFile(
          path.join(process.env.UI_CAPTURE_SOURCE, file),
          "utf8",
        ),
        file,
      );
    await fs.writeFile(goldenUrl, JSON.stringify(golden, null, 2) + "\n");
  }
  const golden = JSON.parse(await fs.readFile(goldenUrl, "utf8"));
  for (const [file, expected] of Object.entries(golden)) {
    const actual = fingerprint(
      await fs.readFile(path.join(root, file), "utf8"),
      file,
    );
    assert.deepEqual(
      actual,
      expected,
      `${file}: 原 Hook/IPC/处理器/业务属性保持`,
    );
  }
  console.log(
    `通过：${Object.values(golden).reduce((n, e) => n + Object.keys(e).length, 0)} 项原 Hook / IPC / 处理器 / 业务属性结构核对`,
  );
}
