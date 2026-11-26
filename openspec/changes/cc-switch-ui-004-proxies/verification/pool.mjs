import assert from "node:assert/strict";
const store = async (page, action, arg) =>
  page.evaluate(
    async ({ action, arg }) => {
      const { useAccountsStore: s } = await import("/src/store/accounts.ts");
      switch (action) {
        case "reset":
          s.setState({ proxyPool: new Map(), accountProxyBindings: {} });
          break;
        case "size":
          return s.getState().proxyPool.size;
        case "parsed":
          return [...s.getState().proxyPool.values()].map(
            ({ protocol, host, port, username, password }) => ({
              protocol,
              host,
              port,
              username,
              password,
            }),
          );
        case "label":
          return s.getState().proxyPool.get(arg).label;
        case "enabled":
          return s.getState().proxyPool.get(arg).enabled;
        case "bindings":
          return s.getState().accountProxyBindings;
        case "bound-proxy":
          return s
            .getState()
            .proxyPool.get(s.getState().accountProxyBindings["fixture-0"]);
        case "virtual": {
          const pool = new Map();
          for (let i = 0; i < 61; i++)
            pool.set("virtual-" + i, {
              id: "virtual-" + i,
              url: "http://fixture" + i + ".invalid:8080",
              host: "fixture" + i + ".invalid",
              port: 8080,
              protocol: "http",
              status: "alive",
              enabled: true,
              usedCount: 0,
              failCount: 0,
              createdAt: Date.now(),
            });
          s.setState({ proxyPool: pool });
          break;
        }
        case "dead":
          s.setState({
            proxyPool: new Map(
              [...s.getState().proxyPool].map(([id, p]) => [
                id,
                { ...p, status: "dead" },
              ]),
            ),
          });
          break;
      }
    },
    { action, arg },
  );
const calls = async (p, n) =>
  p.evaluate(
    (n) => window.__calls.filter((c) => c.name === n).map((c) => c.args),
    n,
  );
export async function verifyPool({ page, out, navigate }) {
  await store(page, "reset");
  await navigate("proxyPool");
  await page.getByRole("button", { name: "Bulk", exact: true }).click();
  const bulk = page.locator("textarea");
  await bulk.fill(
    "http://user:pass@fixture.invalid:8080\nhttps://secure.invalid:8443\nsocks5://socks.invalid:1080\nsocks4://four.invalid:1081\nraw.invalid:8888:fixture:password\nhttp://user:pass@fixture.invalid:8080\ninvalid\n# comment",
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  assert.equal(await store(page, "size"), 5);
  assert.ok(
    (await page.evaluate(() => window.__alerts)).some((s) =>
      s.includes("added 5, skipped 1, failed 1"),
    ),
  );
  const parsed = await store(page, "parsed");
  assert.equal(parsed[0].password, "pass");
  assert.deepEqual(
    parsed.map((p) => p.protocol),
    ["http", "https", "socks5", "socks4", "http"],
  );
  const first = page.locator("[data-proxy-id]").first();
  const id = await first.getAttribute("data-proxy-id");
  await first.getByTitle("Copy URL", { exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__clipboard),
    "http://user:pass@fixture.invalid:8080",
  );
  await first.getByTitle("Edit note", { exact: true }).click();
  const note = first.getByPlaceholder("Note");
  await note.fill("Fixture label");
  await note.press("Enter");
  assert.equal(await store(page, "label", id), "Fixture label");
  await first.getByTitle("Disable", { exact: true }).click();
  assert.equal(await store(page, "enabled", id), false);
  await first.getByTitle("Enable", { exact: true }).click();
  await first.getByTitle("Test", { exact: true }).click();
  assert.deepEqual((await calls(page, "proxyPoolValidate")).at(-1)[0], {
    url: "http://user:pass@fixture.invalid:8080",
    testUrl: "https://api.ipify.org?format=json",
    timeoutMs: 8000,
    upstreamProxy: "",
  });
  const search = page.getByPlaceholder(
    "Search any field (host/port/protocol/user/email/label/url)...",
  );
  await search.fill("Fixture label");
  assert.equal(await page.locator("[data-proxy-id]").count(), 1);
  await first.locator("input[type=checkbox]").check();
  await search.fill("");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  // Native filters remain connected to protocol, enabled, latency, last-tested dimensions.
  const filters = page.locator("select");
  await filters.nth(2).selectOption("socks5");
  assert.equal(await page.locator("[data-proxy-id]").count(), 1);
  const before = (await calls(page, "proxyPoolValidate")).length;
  await page
    .getByRole("button", { name: "Test Selected (1)", exact: true })
    .click();
  assert.equal((await calls(page, "proxyPoolValidate")).length, before + 1);
  assert.equal(
    (await calls(page, "proxyPoolValidate")).at(-1)[0].url,
    "http://user:pass@fixture.invalid:8080",
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await search.fill("socks");
  await page.getByRole("button", { name: "Test All (2)", exact: true }).click();
  assert.deepEqual(
    (await calls(page, "proxyPoolValidate"))
      .slice(-2)
      .map((a) => a[0].url)
      .sort(),
    ["socks4://four.invalid:1081", "socks5://socks.invalid:1080"],
  );
  await search.fill("");
  for (const name of ["Random", "Least Used", "Fastest", "Round Robin"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  const upstream = page.getByPlaceholder(
    "e.g. socks5://127.0.0.1:7890 (empty = off)",
  );
  await upstream.fill("socks5://relay.invalid:7890");
  await page.getByRole("button", { name: "Diagnose", exact: true }).click();
  await page.getByText("A) Upstream TCP reachable", { exact: true }).waitFor();
  assert.deepEqual((await calls(page, "proxyPoolDiagnoseChain")).at(-1), [
    {
      targetUrl: "http://user:pass@fixture.invalid:8080",
      upstreamProxy: "socks5://relay.invalid:7890",
    },
  ]);
  // N:1 bindings share the unchanged store and account page.
  await page.getByRole("button", { name: /Auto-Bind Unbound/ }).click();
  let bindings = await store(page, "bindings");
  assert.ok(bindings["fixture-0"]);
  await page
    .getByRole("button", { name: "Re-Distribute All", exact: true })
    .click();
  await page.getByRole("button", { name: /Show binding details/ }).click();
  await page.getByTitle("Unbind", { exact: true }).first().click();
  assert.equal(Object.keys(await store(page, "bindings")).length, 0);
  await page.getByRole("button", { name: /Auto-Bind Unbound/ }).click();
  await page.evaluate(() => (window.__confirmResult = false));
  await page.getByRole("button", { name: "Unbind All", exact: true }).click();
  assert.ok(Object.keys(await store(page, "bindings")).length);
  await page.evaluate(() => (window.__confirmResult = true));
  await page.getByRole("button", { name: "Unbind All", exact: true }).click();
  assert.deepEqual(await store(page, "bindings"), {});
  await page.evaluate(() => (window.__confirmResult = false));
  await page.getByRole("button", { name: "Delete (1)", exact: true }).click();
  assert.equal(await store(page, "size"), 5);
  await page.evaluate(() => (window.__confirmResult = true));
  await page.getByRole("button", { name: "Delete (1)", exact: true }).click();
  assert.equal(await store(page, "size"), 4);
  // Check the other domain reads the same binding after a real page transition.
  await page.getByRole("button", { name: /Auto-Bind Unbound/ }).click();
  const shared = await store(page, "bound-proxy");
  assert.ok(shared);
  await navigate("accounts");
  const badge = page.locator('[title^="Bound proxy:"]').first();
  await badge.waitFor();
  assert.ok(
    (await badge.getAttribute("title")).includes(
      `${shared.host}:${shared.port}`,
    ),
  );
  await navigate("proxyPool");
  assert.ok((await store(page, "bindings"))["fixture-0"]);
  await page.getByRole("button", { name: "Unbind All", exact: true }).click();
  assert.deepEqual(await store(page, "bindings"), {});
  // Keep virtual item count/identity/height in a real 61-row pool, including last row.
  await store(page, "virtual");
  await page.locator('[data-proxy-id="virtual-0"]').waitFor();
  const scroll = page.locator('[style*="contain: strict"]');
  await scroll.scrollIntoViewIfNeeded();
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.locator('[data-proxy-id="virtual-60"]').waitFor();
  const rows = await page.locator("[data-proxy-id]").evaluateAll((els) =>
    els.map((e) => ({
      id: e.dataset.proxyId,
      h: e.getBoundingClientRect().height,
    })),
  );
  assert.ok(rows.every((r) => r.h === 58));
  await page.screenshot({ path: `${out}/pool-virtual.png` });
  // No available proxy preserves the original null result and alert.
  await store(page, "dead");
  await page
    .getByRole("button", { name: "Re-Distribute All", exact: true })
    .click();
  assert.ok(
    (await page.evaluate(() => window.__alerts)).includes(
      "No alive proxies. Validate proxies first.",
    ),
  );
  console.log(
    "通过：P07/P08 协议凭据、筛选与验活目标、策略链路、绑定确认、61条虚拟滚动",
  );
}
