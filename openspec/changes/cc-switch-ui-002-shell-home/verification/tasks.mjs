import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function verifyTasks({ page, out, navigate, setAppearance }) {
  await page.evaluate(async () => {
    const { useTaskStore } = await import("/src/store/tasks.ts");
    const s = useTaskStore.getState();
    s.clearAll();
    window.__taskCalls = [];
    const onCancel = (id) => () => window.__taskCalls.push(`cancel:${id}`);
    s.createTask({
      fixedId: "a",
      kind: "register-batch",
      title: "Pausable task",
      subtitle: "Fixture subtitle ".repeat(25),
      total: 10,
      done: 2,
      progress: 20,
      onCancel: onCancel("a"),
      onPause: () => {
        window.__taskCalls.push("pause:a");
        s.updateTask("a", { status: "paused" });
      },
      onResume: () => {
        window.__taskCalls.push("resume:a");
        s.updateTask("a", { status: "running" });
      },
    });
    s.createTask({
      fixedId: "b",
      kind: "account-check",
      title: "No pause callback",
      total: 5,
      done: 1,
      progress: 20,
      onCancel: onCancel("b"),
    });
    s.createTask({
      fixedId: "c",
      kind: "proxy-validation",
      title: "Paused task",
      status: "paused",
      total: 5,
      done: 2,
      progress: 40,
      onCancel: onCancel("c"),
      onResume: () => {
        window.__taskCalls.push("resume:c");
        s.updateTask("c", { status: "running" });
      },
    });
    s.createTask({
      fixedId: "d",
      kind: "token-refresh",
      title: "Finished task",
      total: 2,
      done: 2,
    });
    s.completeTask("d", { successCount: 2 });
    s.createTask({
      fixedId: "e",
      kind: "other",
      title: "Long task title ".repeat(20),
      total: 2,
    });
    s.failTask("e", "Fixture failure. ".repeat(60));
    s.createTask({
      fixedId: "f",
      kind: "other",
      title: "Cancelled task",
      total: 2,
    });
    s.cancelTask("f");
  });
  const trigger = () => page.getByTitle("Task Center", { exact: true });
  await trigger().waitFor();
  assert.match(await trigger().innerText(), /3\s*25%/);
  await trigger().click();
  const drawer = () =>
    page.getByRole("dialog", { name: "Task Center", exact: true });
  const row = (id) => page.locator(`[data-task-id="${id}"]`);
  await drawer().waitFor();
  await page.waitForTimeout(450);
  const metrics = await drawer().evaluate((el) => {
    const s = getComputedStyle(el),
      b = el.getBoundingClientRect(),
      h = getComputedStyle(el.querySelector("h2"));
    const row = el.querySelector("[data-task-id]"),
      rs = getComputedStyle(row);
    return {
      width: parseFloat(s.width),
      radius: s.borderTopLeftRadius,
      font: h.fontSize,
      line: h.lineHeight,
      padding: rs.padding,
      radiusRow: rs.borderRadius,
      button: row.querySelector("button").getBoundingClientRect().height,
    };
  });
  assert.deepEqual(metrics, {
    width: 420,
    radius: "14px",
    font: "15px",
    line: "22px",
    padding: "16px",
    radiusRow: "10px",
    button: 28,
  });
  await fs.writeFile(
    `${out}/task-geometry.json`,
    JSON.stringify(metrics, null, 2),
  );
  assert.equal(
    await row("b").getByRole("button", { name: "Pause", exact: true }).count(),
    0,
  );
  assert.equal(
    await row("c")
      .getByRole("button", { name: "Resume", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await row("b")
      .getByRole("button", { name: "Cancel", exact: true })
      .isVisible(),
    true,
  );
  const order = await drawer()
    .locator("[data-task-id]")
    .evaluateAll((els) => els.map((el) => el.dataset.taskId));
  assert.deepEqual(new Set(order.slice(0, 3)), new Set(["a", "b", "c"]));
  for (const language of ["zh", "en"])
    for (const mode of ["light", "dark"]) {
      await setAppearance(language, mode);
      await page.screenshot({
        path: `${out}/tasks-${language}-${mode}-800.png`,
      });
    }
  await setAppearance("en", "light");
  await row("a").getByRole("button", { name: "Pause", exact: true }).click();
  await row("a").getByRole("button", { name: "Resume", exact: true }).click();
  await row("c").getByRole("button", { name: "Resume", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__taskCalls), [
    "pause:a",
    "resume:a",
    "resume:c",
  ]);
  await drawer().getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForTimeout(400);
  await navigate("about");
  await page.evaluate(async () => {
    const { useTaskStore } = await import("/src/store/tasks.ts");
    useTaskStore
      .getState()
      .updateTask("a", {
        done: 7,
        progress: 70,
        lastMessage: "Continued while drawer closed",
      });
  });
  await trigger().click();
  await row("a")
    .getByText("Continued while drawer closed", { exact: true })
    .waitFor();
  assert.match(await row("a").innerText(), /7\/10/);
  await row("f").getByRole("button", { name: "Remove", exact: true }).click();
  assert.equal(await row("f").count(), 0);
  await drawer()
    .getByRole("button", { name: "Clear finished", exact: true })
    .click();
  assert.equal(await drawer().locator("[data-task-id]").count(), 3);
  page.once("dialog", (dialog) => dialog.dismiss());
  await drawer()
    .getByRole("button", { name: "Cancel all", exact: true })
    .click();
  assert.equal(
    await page.evaluate(async () => {
      const { useTaskStore } = await import("/src/store/tasks.ts");
      return useTaskStore.getState().getActiveCount();
    }),
    3,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await drawer()
    .getByRole("button", { name: "Cancel all", exact: true })
    .click();
  assert.deepEqual(
    (await page.evaluate(() => window.__taskCalls)).slice(3).sort(),
    ["cancel:a", "cancel:b", "cancel:c"],
  );
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kiro-task-history")),
  );
  assert.equal(history.length, 3);
  assert.ok(
    history.every(
      (t) =>
        t.status === "cancelled" && !t.onCancel && !t.onResume && !t.onPause,
    ),
  );
  await page.reload();
  await page.getByText("Total Accounts", { exact: true }).waitFor();
  await trigger().click();
  assert.equal(await drawer().locator("[data-task-id]").count(), 3);
  assert.equal(
    await drawer()
      .getByRole("button", { name: "Cancel all", exact: true })
      .count(),
    0,
  );
  await drawer()
    .getByRole("button", { name: "Clear finished", exact: true })
    .click();
  await trigger().waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  console.log(
    "通过：G06 排序／聚合进度／按回调暂停恢复／无回调取消／取消全部确认／移除清理／完成历史重载；收起及切页后任务继续",
  );
}
