// PLAYWRIGHT_MODULE 指向本机 Playwright；不改项目依赖，不启动真实账号服务。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installFixture } from "../cc-switch-ui-002-shell-home/verification/fixtures.mjs";
import { registrationFixture, savedConfig } from "./verification/fixtures.mjs";
import { verifySource } from "./verification/source-contract.mjs";
import { verifyRegistration } from "./verification/registration.mjs";
import { verifyReview } from "./verification/review.mjs";
import { verifySubscription } from "./verification/subscription.mjs";
import { verifyGeometry, verifyCompact } from "./verification/geometry.mjs";

const appRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
const require = createRequire(path.join(appRoot, "package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")));
const { default: react } = await import(
  pathToFileURL(require.resolve("@vitejs/plugin-react"))
);
const { default: tailwind } = await import(
  pathToFileURL(require.resolve("@tailwindcss/vite"))
);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out =
  process.env.UI_CHECK_OUTPUT || "/tmp/cc-registration-20261126/verified";
await fs.mkdir(out, { recursive: true });
const server = await createServer({
  configFile: false,
  cacheDir: path.join(out, ".vite"),
  root: path.join(appRoot, "src/renderer"),
  resolve: { alias: { "@": path.join(appRoot, "src/renderer/src") } },
  plugins: [
    {
      name: "isolated-registration-fixture",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/styles/globals.css"))
          return `${code}\n@source "${fileURLToPath(new URL("./verification/geometry.mjs", import.meta.url))}";`;
      },
      async load(id) {
        if (
          process.env.UI_BEFORE &&
          /\/pages\/(RegisterPage|SubscriptionPage)\.tsx$/.test(id)
        )
          return fs.readFile(
            `/tmp/cc-registration-20261126/before/pages/${path.basename(id)}`,
            "utf8",
          );
        if (id.endsWith("/__shell_fixture__.js"))
          return "export { createElement } from 'react'; export { createRoot } from 'react-dom/client';";
      },
      resolveId(id) {
        if (id === "/__shell_fixture__.js")
          return path.join(appRoot, "src/renderer/src/__shell_fixture__.js");
      },
    },
    react(),
    tailwind(),
  ],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [appRoot, out] } },
});
await server.listen();
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 800, height: 600 },
  colorScheme: "light",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(10000);
await page.addInitScript(installFixture, { platform: "darwin" });
await page.addInitScript(registrationFixture);
await page.addInitScript((config) => {
  if (!localStorage.getItem("kiro-register-config"))
    localStorage.setItem("kiro-register-config", JSON.stringify(config));
  if (!localStorage.getItem("kiro-register-ratelimit-enabled"))
    localStorage.setItem("kiro-register-ratelimit-enabled", "0");
  if (!localStorage.getItem("kiro-register-email-blacklist"))
    localStorage.setItem(
      "kiro-register-email-blacklist",
      JSON.stringify(["used@example.invalid"]),
    );
}, savedConfig);
const navigate = async (view) => {
  await page.evaluate(
    (view) =>
      window.dispatchEvent(new CustomEvent("navigate-page", { detail: view })),
    view,
  );
  await page.waitForTimeout(550);
};
const setAppearance = async (language, mode) => {
  await page.evaluate(
    async ({ language, mode }) => {
      const { useAccountsStore } = await import("/src/store/accounts.ts");
      useAccountsStore.getState().setLanguage(language);
      useAccountsStore.getState().setTheme(mode);
    },
    { language, mode },
  );
  await page.waitForTimeout(220);
};
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByText("Total Accounts", { exact: true }).waitFor();
  if (!process.env.UI_BEFORE) await verifySource(appRoot);
  const checks = {
    registration: verifyRegistration,
    subscription: verifySubscription,
    geometry: verifyGeometry,
    compact: verifyCompact,
    review: verifyReview,
  };
  for (const [stage, check] of Object.entries(checks)) {
    if (process.env.UI_CHECK_STAGE && process.env.UI_CHECK_STAGE !== stage)
      continue;
    await page.reload();
    await page.getByText("Total Accounts", { exact: true }).waitFor();
    await setAppearance("en", "light");
    await navigate("home");
    await check({ page, out, navigate, setAppearance, appRoot });
    const expected = process.env.UI_BEFORE
      ? errors.filter((e) => /Cannot set properties of null.*value/.test(e))
      : [];
    assert.deepEqual(
      errors.filter((e) => !expected.includes(e)),
      [],
      `${stage}: renderer errors`,
    );
    if (expected.length) console.log("改前已知错误：", expected);
  }
  console.log("通过：005 隔离 renderer 验证；所有 IPC 均为内存样例");
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await fs.writeFile(
    `${out}/failure.json`,
    JSON.stringify(
      await page.evaluate(() => ({
        text: document.body.innerText,
        calls: window.__calls,
        alerts: window.__alerts,
      })),
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
