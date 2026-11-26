// PLAYWRIGHT_MODULE 指向本机 Playwright；不改项目依赖，不启动真实账号服务。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installFixture } from "./verification/fixtures.mjs";
import { verifyShell } from "./verification/shell.mjs";
import { verifyDialogs } from "./verification/dialogs.mjs";
import { verifyTasks } from "./verification/tasks.mjs";
import { verifyHome } from "./verification/home.mjs";
import { verifyLifecycle } from "./verification/lifecycle.mjs";
import { verifyNative } from "./verification/native.mjs";
import { verifyReview } from "./verification/review.mjs";

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
  process.env.UI_CHECK_OUTPUT || "/tmp/cc-shell-home-20261126/verified";
await fs.mkdir(out, { recursive: true });
const server = await createServer({
  configFile: false,
  root: path.join(appRoot, "src/renderer"),
  resolve: { alias: { "@": path.join(appRoot, "src/renderer/src") } },
  plugins: [
    {
      name: "isolated-shell-fixture",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/styles/globals.css"))
          return `${code}\n@source "${fileURLToPath(new URL("./verification/shell.mjs", import.meta.url))}";\n@source "${fileURLToPath(new URL("./verification/review.mjs", import.meta.url))}";`;
      },
      resolveId(id) {
        if (id === "/__shell_fixture__.js")
          return path.join(appRoot, "src/renderer/src/__shell_fixture__.js");
      },
      load(id) {
        if (id.endsWith("/__shell_fixture__.js"))
          return "export { createElement } from 'react'; export { createRoot } from 'react-dom/client';";
      },
    },
    react(),
    tailwind(),
  ],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [appRoot] } },
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
  const checks = {
    shell: verifyShell,
    review: verifyReview,
    dialogs: verifyDialogs,
    tasks: verifyTasks,
    home: verifyHome,
    lifecycle: verifyLifecycle,
    ...(process.env.UI_NATIVE_WINDOW === "1" ? { native: verifyNative } : {}),
  };
  for (const [stage, check] of Object.entries(checks)) {
    if (process.env.UI_CHECK_STAGE && process.env.UI_CHECK_STAGE !== stage)
      continue;
    await setAppearance("en", "light");
    await navigate("home");
    await check({ page, out, navigate, setAppearance, appRoot });
    assert.deepEqual(errors, [], `${stage}: renderer errors`);
  }
  console.log("通过：002 隔离 renderer 验证；所有 IPC 均为内存样例");
} finally {
  await browser.close();
  await server.close();
}
