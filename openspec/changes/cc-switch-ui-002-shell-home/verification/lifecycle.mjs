import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";

const run = promisify(execFile);
const baseline = "ed7dc85";
export async function verifyLifecycle({ page, out, navigate, appRoot }) {
  const require = createRequire(path.join(appRoot, "package.json"));
  const ts = require("typescript");
  const root = path.dirname(appRoot);
  const printer = ts.createPrinter({ removeComments: true });
  const source = async (file, before) =>
    before
      ? (
          await run(
            "git",
            [
              "show",
              `${baseline}:Kiro-account-manager/src/renderer/src/${file}`,
            ],
            { cwd: root, maxBuffer: 5e6 },
          )
        ).stdout
      : fs.readFile(path.join(appRoot, "src/renderer/src", file), "utf8");
  const canonical = (text) => {
    const sf = ts.createSourceFile(
      "logic.tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (ts.isParenthesizedExpression(node)) return visit(node.expression);
      const children = [];
      ts.forEachChild(node, (child) => {
        children.push(visit(child));
      });
      return [
        node.kind,
        node.kind === ts.SyntaxKind.SourceFile ? null : (node.text ?? null),
        ...children,
      ];
    };
    return visit(sf);
  };
  const collect = (file, text, predicate) => {
    const sf = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
      result = [];
    const visit = (node) => {
      if (predicate(node))
        result.push(
          canonical(printer.printNode(ts.EmitHint.Unspecified, node, sf)),
        );
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return result;
  };
  const effects = (node) =>
    ts.isCallExpression(node) && node.expression.getText() === "useEffect";
  const memoNames = new Set([
    "warnings",
    "usageStats",
    "activeAccount",
    "sortedTasks",
    "cancelAllActive",
    "handleAction",
    "handleDownload",
    "handleInstall",
    "handleClose",
    "formatBytes",
    "formatSpeed",
    "formatDuration",
  ]);
  const logic = (node) =>
    (ts.isVariableDeclaration(node) && memoNames.has(node.name.getText())) ||
    (ts.isFunctionDeclaration(node) && node.name?.text === "formatDuration");
  const results = {};
  for (const file of [
    "App.tsx",
    "components/layout/TitleBar.tsx",
    "components/layout/TaskCenter.tsx",
    "components/pages/HomePage.tsx",
    "components/CloseConfirmDialog.tsx",
    "components/UpdateDialog.tsx",
  ]) {
    const before = await source(file, true),
      after = await source(file, false);
    const oldEffects = collect(file, before, effects),
      newEffects = collect(file, after, effects);
    assert.deepEqual(newEffects, oldEffects, `${file}: effects`);
    assert.deepEqual(
      collect(file, after, logic),
      collect(file, before, logic),
      `${file}: callbacks/calculations`,
    );
    if (file === "App.tsx")
      assert.equal(
        after.slice(0, after.indexOf("  return (")),
        before.slice(0, before.indexOf("  return (")),
      );
    results[file] = { effects: oldEffects.length, logicUnchanged: true };
  }
  const protectedPaths = [
    "Kiro-account-manager/src/main",
    "Kiro-account-manager/src/preload",
    "Kiro-account-manager/src/renderer/src/store",
    "Kiro-account-manager/package.json",
    "Kiro-account-manager/package-lock.json",
  ];
  assert.equal(
    (
      await run(
        "git",
        ["diff", baseline, "--name-only", "--", ...protectedPaths],
        { cwd: root },
      )
    ).stdout.trim(),
    "",
  );

  const names = [
    "onKiroIdeTokenChanged",
    "onProxyWebhookTrigger",
    "onTrayRefreshAccount",
    "onTraySwitchAccount",
    "onBackgroundRefreshResult",
    "onBackgroundCheckResult",
    "onProxyAccountSuspended",
    "onProxyAccountUpdate",
    "onShowCloseConfirmDialog",
    "onUpdateChecking",
    "onUpdateAvailable",
    "onUpdateDownloadProgress",
    "onUpdateDownloaded",
    "onUpdateError",
  ];
  const subscriptions = () =>
    page.evaluate(
      (names) =>
        Object.fromEntries(
          names.map((name) => [
            name,
            {
              registered: window.__subscriptions[name],
              active: (window.__listeners[name] || []).length,
            },
          ]),
        ),
      names,
    );
  const initial = await subscriptions();
  for (const view of ["accounts", "about", "settings", "home"])
    await navigate(view);
  await page.evaluate(() => window.api.window.minimize());
  await page.waitForTimeout(150);
  assert.deepEqual(await subscriptions(), initial);
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    window.__data.accounts = structuredClone(window.__fixtureAccounts);
    window.__data.activeAccountId = "fixture-0";
    window.__calls.length = 0;
    window.__emit("onKiroIdeTokenChanged", {
      accountId: "fixture-0",
      reason: "fixture",
    });
  });
  await page.waitForTimeout(600);
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((x) => x.name === "loadAccounts").length,
    ),
    1,
  );
  const afterReload = await subscriptions();
  const expectedReload = structuredClone(initial);
  expectedReload.onTraySwitchAccount.registered++;
  assert.deepEqual(afterReload, expectedReload);
  await page.evaluate(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    let previous = useAccountsStore.getState().accounts;
    window.__mapChanges = 0;
    window.__stopMapProbe = useAccountsStore.subscribe((state) => {
      if (state.accounts !== previous) {
        previous = state.accounts;
        window.__mapChanges++;
      }
    });
    window.__calls.length = 0;
    for (const [id, current] of [
      ["fixture-0", 33],
      ["fixture-2", 44],
    ])
      window.__emit("onBackgroundRefreshResult", {
        id,
        success: true,
        data: { usage: { current, limit: 100 } },
      });
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__mapChanges), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__calls.filter((x) => x.name === "updateTrayAccountList").length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      return useAccountsStore.getState().accounts.get("fixture-0").usage
        .current;
    }),
    33,
  );
  await page.evaluate(() => {
    window.__mapChanges = 0;
    window.__calls.length = 0;
    for (const [id, current] of [
      ["fixture-0", 34],
      ["fixture-2", 45],
    ])
      window.__emit("onBackgroundCheckResult", {
        id,
        success: true,
        data: { usage: { current, limit: 100 } },
      });
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__mapChanges), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__calls.filter((x) => x.name === "updateTrayAccountList").length,
    ),
    1,
  );
  await page.evaluate(() => window.__stopMapProbe());
  await page.evaluate(() =>
    window.__emit("onProxyAccountSuspended", {
      id: "fixture-0",
      reason: "TEMPORARILY_SUSPENDED",
      message: "Fixture suspension",
    }),
  );
  await page.waitForFunction(async () => {
    const { useAccountsStore } = await import("/src/store/accounts.ts");
    return (
      useAccountsStore.getState().accounts.get("fixture-0").status === "error"
    );
  });
  await page.evaluate(() =>
    window.__emit("onProxyAccountUpdate", {
      id: "fixture-0",
      profileArn: "fixture-profile",
    }),
  );
  assert.equal(
    await page.evaluate(async () => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      return useAccountsStore.getState().accounts.get("fixture-0").credentials
        .profileArn;
    }),
    "fixture-profile",
  );
  const saves = await page.evaluate(
    () => window.__calls.filter((x) => x.name === "saveAccounts").length,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  await page.waitForTimeout(50);
  assert.ok(
    (await page.evaluate(
      () => window.__calls.filter((x) => x.name === "saveAccounts").length,
    )) > saves,
  );
  const finalSubscriptions = await subscriptions();
  for (const name of names) {
    assert.equal(finalSubscriptions[name].active, initial[name].active);
    if (name !== "onTraySwitchAccount")
      assert.equal(
        finalSubscriptions[name].registered,
        initial[name].registered,
      );
  }
  await fs.writeFile(
    `${out}/lifecycle.json`,
    JSON.stringify(
      {
        baseline,
        source: results,
        subscriptions: { initial, afterReload, final: finalSubscriptions },
        checks: {
          ideReload: 1,
          refreshBatch: 1,
          checkBatch: 1,
          trayDebounced: 1,
          beforeUnloadSave: true,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    "通过：G07 App逻辑及六组件effects／回调源码等价；切页／最小化无重复订阅、IDE reload一次、两类结果批处理各一次、托盘防抖、封禁/profile同步及退出保存",
  );
}
