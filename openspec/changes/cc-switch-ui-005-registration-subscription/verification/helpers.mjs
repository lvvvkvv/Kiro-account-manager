import assert from "node:assert/strict";
import { savedConfig } from "./fixtures.mjs";
export const button = (page, name) =>
  page.getByRole("button", { name, exact: true });
export const field = (page, label) =>
  page
    .locator("label")
    .filter({ hasText: label })
    .first()
    .locator("..")
    .locator("input,textarea")
    .first();
export const calls = (page, name) =>
  page.evaluate((name) => window.__calls.filter((c) => c.name === name), name);
export async function reset({ page, navigate }, config = {}, keys = {}) {
  await page.evaluate(
    ({ config, keys }) => {
      localStorage.setItem("kiro-register-config", JSON.stringify(config));
      for (const key of Object.keys(localStorage))
        if (key.startsWith("kiro-register-") && key !== "kiro-register-config")
          localStorage.removeItem(key);
      localStorage.setItem("kiro-register-ratelimit-enabled", "0");
      for (const [key, value] of Object.entries(keys))
        localStorage.setItem(
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        );
    },
    { config: { ...savedConfig, ...config }, keys },
  );
  await page.reload();
  await page.getByText("Total Accounts", { exact: true }).waitFor();
  await navigate("register");
}
export const until = (page, fn, arg) => page.waitForFunction(fn, arg);
export async function idle(page) {
  await button(page, "Start Batch").waitFor({ state: "visible" });
  await until(page, async () => {
    const { useTaskStore } = await import("/src/store/tasks.ts");
    return [...useTaskStore.getState().tasks.values()].every(
      (t) => t.status !== "running" && t.status !== "paused",
    );
  });
}
export async function assertCall(page, name, args) {
  const list = await calls(page, name);
  assert.deepEqual(list.at(-1)?.args, args, name);
}
