import assert from "node:assert/strict";
import { mount, unmount } from "./dialogs.mjs";
import { seed, state } from "./accounts.mjs";
const calls = (page, name) =>
  page.evaluate((name) => window.__calls.filter((c) => c.name === name), name);
const waitClosed = (page) => page.waitForFunction(() => window.__closed > 0);
export async function verifyLogin({ page, out, navigate, setAppearance }) {
  await navigate("home");
  await setAppearance("en", "light");
  await page.setViewportSize({ width: 800, height: 600 });
  for (const source of ["BuilderId", "Google", "Github", "Enterprise"]) {
    await seed(page);
    await mount(page, "AddAccountDialog");
    const d = page.getByRole("dialog");
    await d
      .getByRole("button", { name: "Private/Incognito Mode", exact: true })
      .click();
    if (source === "BuilderId")
      await d.getByRole("button", { name: /^AWS Builder ID/ }).click();
    else if (source === "Enterprise") {
      await d.getByRole("button", { name: /^Enterprise/ }).click();
      await d.locator("#ssoStartUrl").fill("https://org.example.invalid/start");
      await d.locator("#ssoRegion").selectOption("eu-west-1");
      await d.getByRole("button", { name: "Start Login", exact: true }).click();
      assert.deepEqual((await calls(page, "startIamSsoLogin")).at(-1).args, [
        "https://org.example.invalid/start",
        "eu-west-1",
      ]);
    } else
      await d
        .getByRole("button", {
          name: new RegExp(
            `^${source === "Github" ? "GitHub" : source} Account`,
          ),
        })
        .click();
    if (["BuilderId", "Enterprise"].includes(source)) {
      const external = (await calls(page, "openExternal")).at(-1);
      assert.equal(external.args[1], true);
      if (source === "BuilderId") {
        await d.getByTitle("Copy code").click();
        assert.equal(
          await page.evaluate(() => window.__clipboard),
          "TEST-CODE",
        );
      }
    } else
      assert.deepEqual((await calls(page, "startSocialLogin")).at(-1).args, [
        source,
        true,
      ]);
    await page.screenshot({ path: `${out}/login-${source}-pending.png` });
    const beforeCount = await state(page, "return s.accounts.size");
    await d.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      (
        await calls(
          page,
          source === "BuilderId"
            ? "cancelBuilderIdLogin"
            : source === "Enterprise"
              ? "cancelIamSsoLogin"
              : "cancelSocialLogin",
        )
      ).length,
      1,
    );
    const polls =
      (await calls(page, "pollBuilderIdAuth")).length +
      (await calls(page, "pollIamSsoAuth")).length;
    await page.waitForTimeout(150);
    assert.equal(
      (await calls(page, "pollBuilderIdAuth")).length +
        (await calls(page, "pollIamSsoAuth")).length,
      polls,
    );
    assert.equal(await state(page, "return s.accounts.size"), beforeCount);
    await unmount(page);
    // Success path, including real renderer poll/callback and its original verify payload.
    await mount(page, "AddAccountDialog");
    if (source === "BuilderId" || source === "Enterprise") {
      await page.evaluate(
        (source) =>
          (window.__pollResult = {
            success: true,
            completed: true,
            accessToken: "poll-access",
            refreshToken: `poll-${source}`,
            clientId: "poll-client",
            clientSecret: "poll-secret",
            region: "eu-west-1",
          }),
        source,
      );
      if (source === "BuilderId")
        await page.getByRole("button", { name: /^AWS Builder ID/ }).click();
      else {
        await page.getByRole("button", { name: /^Enterprise/ }).click();
        await page
          .locator("#ssoStartUrl")
          .fill("https://org.example.invalid/start");
        await page.locator("#ssoRegion").selectOption("eu-west-1");
        await page
          .getByRole("button", { name: "Start Login", exact: true })
          .click();
      }
    } else {
      await page.evaluate(
        (source) => (window.__socialProvider = source),
        source,
      );
      await page
        .getByRole("button", {
          name: new RegExp(
            `^${source === "Github" ? "GitHub" : source} Account`,
          ),
        })
        .click();
      await page.waitForFunction(
        () => window.__listeners.onSocialAuthCallback?.length > 0,
      );
      await page.evaluate(() =>
        window.__emit("onSocialAuthCallback", {
          code: "test-code",
          state: "test-state",
        }),
      );
    }
    await waitClosed(page);
    assert.equal(await state(page, "return s.accounts.size"), 9);
    const added = await state(
      page,
      'return [...s.accounts.values()].find(a=>!a.id.startsWith("fixture-"))',
    );
    assert.equal(added.credentials.provider, source);
    assert.equal(
      added.credentials.authMethod,
      ["Google", "Github"].includes(source) ? "social" : "IdC",
    );
    await unmount(page);
  }
  await seed(page);
  await mount(page, "AddAccountDialog");
  await page.getByRole("button", { name: /^Google Account/ }).click();
  await page.waitForFunction(
    () => window.__listeners.onSocialAuthCallback?.length > 0,
  );
  await page.evaluate(() =>
    window.__emit("onSocialAuthCallback", { error: "Fixture denied" }),
  );
  await page.getByText("登录失败: Fixture denied", { exact: true }).waitFor();
  assert.equal(await state(page, "return s.accounts.size"), 8);
  await unmount(page);
  await seed(page);
  await mount(page, "AddAccountDialog");
  await page.evaluate(
    () => (window.__pollResult = { success: false, error: "Fixture denied" }),
  );
  await page.getByRole("button", { name: /^AWS Builder ID/ }).click();
  await page.getByText("Fixture denied", { exact: true }).waitFor();
  const failedPolls = (await calls(page, "pollBuilderIdAuth")).length;
  await page.waitForTimeout(150);
  assert.equal((await calls(page, "pollBuilderIdAuth")).length, failedPolls);
  await unmount(page);
  // OIDC single, local credential import, duplicate and validation.
  await seed(page);
  await state(page, "s.setActiveGroupTab('group-a')");
  await mount(page, "AddAccountDialog");
  await page.getByRole("button", { name: "OIDC Token", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Add Account", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  assert.equal(
    await page.getByPlaceholder("Paste Refresh Token...").inputValue(),
    "local-new",
  );
  await page.getByRole("button", { name: "Add Account", exact: true }).click();
  await waitClosed(page);
  assert.equal(
    await state(
      page,
      'return [...s.accounts.values()].find(a=>a.email==="local-new@example.invalid").groupId',
    ),
    "group-a",
  );
  assert.equal(
    (await calls(page, "verifyAccountCredentials")).at(-1).args[0].region,
    "eu-west-1",
  );
  await unmount(page);
  await mount(page, "AddAccountDialog");
  await page.getByRole("button", { name: "OIDC Token", exact: true }).click();
  await page.getByRole("button", { name: "Social", exact: true }).click();
  await page.getByPlaceholder("Paste Refresh Token...").fill("existing");
  await page.getByRole("button", { name: "Add Account", exact: true }).click();
  await page
    .getByText("This account already exists", { exact: true })
    .waitFor();
  assert.equal(await state(page, "return s.accounts.size"), 9);
  await unmount(page);
  // Both batch grammars retain mixed success/duplicate/failure and only failed input.
  for (const format of ["json", "kami"]) {
    await seed(page);
    await state(page, "s.setActiveGroupTab('group-b')");
    await mount(page, "AddAccountDialog");
    await page.getByRole("button", { name: "OIDC Token", exact: true }).click();
    await page.getByRole("button", { name: "Batch", exact: true }).click();
    const input =
      format === "json"
        ? JSON.stringify([
            { refreshToken: "batch-new", provider: "Github" },
            { refreshToken: "existing", provider: "BuilderId" },
            { refreshToken: "bad", provider: "Google" },
          ])
        : "new@example.invalid----pwd----batch-new----client----secret----Github\nfixture0@example.invalid----pwd----existing----client----secret----BuilderId\nbad@example.invalid----pwd----bad----client----secret----Google";
    await page.getByRole("dialog").locator("textarea").fill(input);
    await page.getByRole("button", { name: /^Batch [Ii]mport/ }).click();
    await page.getByText("Result: 1/3 succeeded", { exact: true }).waitFor();
    assert.equal(await state(page, "return s.accounts.size"), 9);
    assert.equal(
      await state(
        page,
        'return [...s.accounts.values()].find(a=>a.email==="batch-new@example.invalid").groupId',
      ),
      "group-b",
    );
    assert.ok(
      (
        await page.getByRole("dialog").locator("textarea").inputValue()
      ).includes("bad"),
    );
    await page.screenshot({ path: `${out}/oidc-${format}-mixed.png` });
    await unmount(page);
  }
  await seed(page);
  await mount(page, "AddAccountDialog");
  await page.getByRole("button", { name: "SSO Token", exact: true }).click();
  await page.getByRole("dialog").locator("textarea").fill("one\nbad");
  await page
    .getByRole("button", { name: "Batch import 2 accounts", exact: true })
    .click();
  await page.getByText("Result: 1/2 succeeded", { exact: true }).waitFor();
  assert.equal(await state(page, "return s.accounts.size"), 9);
  await page.screenshot({ path: `${out}/sso-mixed.png` });
  await unmount(page);
  console.log(
    "通过：A01/A02 四登录来源成功/取消、私密参数、区域/轮询/回调失败清理、本机导入、OIDC 单个/JSON/卡密/SSO混合批次",
  );
}
