// 对混合 TSX 中的命名业务处理器与 effect 做结构比较；事件连接由真实组件操作回归验证。
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../../../package.json", import.meta.url),
);
const ts = require("typescript");
function fingerprint(source, file) {
  const ast = ts.createSourceFile(file, source, 99, true, 4),
    entries = {};
  const shape = (n) => {
    if (ts.isParenthesizedExpression(n) || ts.isParenthesizedTypeNode(n))
      return shape(n.expression || n.type);
    if (
      ts.isJsxAttribute(n) &&
      [
        "className",
        "style",
        "title",
        "aria-label",
        "aria-labelledby",
        "aria-modal",
        "role",
        "aria-pressed",
        "aria-selected",
        "id",
        "data-account-id",
      ].includes(n.name.getText(ast))
    )
      return "";
    if (ts.isPropertyAssignment(n))
      return `property:${n.name.text ?? n.name.getText(ast)}:${shape(n.initializer)}`;
    if (ts.isRegularExpressionLiteral(n)) return `regex:${n.text}`;
    if (ts.isIdentifier(n)) return `id:${n.text}`;
    if (
      ts.isStringLiteral(n) ||
      ts.isNumericLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n)
    )
      return `${n.kind}:${n.text}`;
    const children = [];
    ts.forEachChild(n, (c) => {
      const v = shape(c);
      if (v) children.push(v);
    });
    return `${n.kind}(${children.join(",")})`;
  };
  let effect = 0;
  function visit(n) {
    if (
      ts.isVariableDeclaration(n) &&
      /^(handle|parseCSVLine|generateContent|isAccountExists|getExportAccounts|startPolling|startIamSsoPolling|toggleArrayFilter|setRangeFilter)/.test(
        n.name.getText(ast),
      )
    )
      entries[n.name.getText(ast)] = shape(n.initializer);
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "useEffect")
      entries[`effect-${effect++}`] = shape(n);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  if (process.env.UI_DEBUG_SHAPE)
    require("fs").writeFileSync(
      process.env.UI_DEBUG_SHAPE + path.basename(file) + ".json",
      JSON.stringify(entries, null, 2),
    );
  return Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [
      k,
      crypto.createHash("sha256").update(String(v)).digest("hex"),
    ]),
  );
}
export async function verifySource(appRoot) {
  const dir = path.join(appRoot, "src/renderer/src/components/accounts");
  const goldenPath = new URL("./business-contract.json", import.meta.url);
  if (process.env.UI_CAPTURE_SOURCE) {
    const golden = {};
    for (const file of await fs.readdir(process.env.UI_CAPTURE_SOURCE))
      if (file.endsWith(".tsx"))
        golden[file] = fingerprint(
          await fs.readFile(
            path.join(process.env.UI_CAPTURE_SOURCE, file),
            "utf8",
          ),
          file,
        );
    await fs.writeFile(goldenPath, JSON.stringify(golden, null, 2) + "\n");
  }
  const golden = JSON.parse(await fs.readFile(goldenPath, "utf8"));
  for (const [file, expected] of Object.entries(golden))
    assert.deepEqual(
      fingerprint(await fs.readFile(path.join(dir, file), "utf8"), file),
      expected,
      `${file}: 业务处理器/effect 不变`,
    );
  console.log("通过：业务处理器、解析/导出函数及 effect 结构与改前一致");
}
