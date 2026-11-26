import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { seed, state } from "./accounts.mjs";
import { mount, unmount } from "./dialogs.mjs";
export async function verifyReview({ page, out, navigate, setAppearance }) {
  await setAppearance("en", "light");
  await page.setViewportSize({ width: 800, height: 600 });
  await navigate("accounts");
  await seed(page);
  await state(
    page,
    `store.setState({groups:new Map(Array.from({length:50},(_,i)=>['long-group-'+i,{id:'long-group-'+i,name:'Long Group '+i+' — example project',color:'#3b82f6',order:i,createdAt:0}])),tags:new Map(Array.from({length:50},(_,i)=>['long-tag-'+i,{id:'long-tag-'+i,name:'Long Tag '+i,color:'#ff3b82f6'}])),proxyPool:new Map(Array.from({length:50},(_,i)=>['long-proxy-'+i,{id:'long-proxy-'+i,url:'http://proxy'+i+'.example.invalid:8080',host:'proxy'+i+'.example.invalid',port:8080,protocol:'http',enabled:true,status:'alive'}])),selectedIds:new Set(['fixture-0','fixture-1'])})`,
  );
  const popovers = [];
  for (const [name, title] of [
    ["groups", "Switch group view / Manage"],
    ["tags", "Set tags for 2 selected"],
    ["proxy", "Bind 2 selected accounts to a proxy"],
    ["filter", "Toggle advanced filter"],
  ]) {
    await page.getByTitle(title, { exact: true }).click();
    const menu = page.locator(".ui-menu").last();
    if (name === "groups" && !process.env.UI_CAPTURE_REVIEW)
      assert.equal(
        await page
          .getByTitle(title, { exact: true })
          .locator(".text-badge")
          .evaluate((e) => getComputedStyle(e).paddingLeft),
        "7px",
      );
    const geometry = await menu.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e),
        row = [...e.querySelectorAll("button")].find((x) =>
          x.textContent.includes("Long Group"),
        );
      const rs = row && getComputedStyle(row);
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        client: e.clientHeight,
        scroll: e.scrollHeight,
        padding: s.padding,
        radius: s.borderRadius,
        row: row && {
          font: getComputedStyle(row.querySelector("span.truncate")).fontSize,
          radius: rs.borderRadius,
          height: row.getBoundingClientRect().height,
        },
      };
    });
    popovers.push({ name, ...geometry });
    await page.screenshot({ path: `${out}/review-${name}.png` });
    if (!process.env.UI_CAPTURE_REVIEW) {
      assert.ok(
        geometry.left >= 16 && geometry.right <= 784,
        JSON.stringify(geometry),
      );
      assert.ok(geometry.bottom <= 584, JSON.stringify(geometry));
      assert.equal(geometry.padding, "4px");
      assert.equal(geometry.radius, "10px");
      if (name === "groups") {
        assert.equal(geometry.row.font, "13px");
        assert.equal(geometry.row.radius, "6px");
        assert.equal(geometry.row.height, 30);
        await menu
          .getByRole("button", { name: "Manage groups", exact: true })
          .scrollIntoViewIfNeeded();
        const last = await menu
          .getByRole("button", { name: "Manage groups", exact: true })
          .boundingBox();
        assert.ok(last.y + last.height <= 584);
      }
    }
    if (name === "groups" && !process.env.UI_CAPTURE_REVIEW) {
      await page.getByTitle("Move 2 selected here").last().click();
      assert.equal(
        await state(page, "return s.accounts.get('fixture-0').groupId"),
        "long-group-49",
      );
    } else if (name === "tags" && !process.env.UI_CAPTURE_REVIEW) {
      await menu
        .getByRole("button", { name: "Long Tag 49", exact: true })
        .click();
      assert.equal(
        await state(
          page,
          "return s.accounts.get('fixture-0').tags.includes('long-tag-49')",
        ),
        true,
      );
      await menu
        .getByRole("button", { name: "Long Tag 49", exact: true })
        .click();
      assert.equal(
        await state(
          page,
          "return s.accounts.get('fixture-0').tags.includes('long-tag-49')",
        ),
        false,
      );
      await page.getByTitle(title, { exact: true }).click();
    } else if (name === "proxy" && !process.env.UI_CAPTURE_REVIEW) {
      await menu
        .getByRole("button", { name: /proxy49.example.invalid:8080/ })
        .click();
      assert.equal(
        await state(page, "return s.accountProxyBindings['fixture-0']"),
        "long-proxy-49",
      );
      await page.getByTitle(title, { exact: true }).click();
      await page
        .locator(".ui-menu")
        .getByRole("button", { name: "Unbind selected (2)", exact: true })
        .click();
      assert.deepEqual(await state(page, "return s.accountProxyBindings"), {});
    } else if (name === "filter" && !process.env.UI_CAPTURE_REVIEW) {
      await menu
        .getByRole("button", { name: "Long Tag 49", exact: true })
        .click();
      assert.deepEqual(await state(page, "return s.filter.tagIds"), [
        "long-tag-49",
      ]);
      await page.getByTitle(title, { exact: true }).click();
    } else await page.getByTitle(title, { exact: true }).click();
  }
  await seed(page);
  await page.getByTitle("Grid view", { exact: true }).click();
  for (const view of ["Grid", "List"]) {
    await page.getByTitle(`${view} view`, { exact: true }).click();
    const geometry = await page
      .locator("[data-account-id]")
      .first()
      .evaluate((e) => {
        const details = e.querySelector('button[title="Details"]'),
          actions = details.parentElement,
          svg = details.querySelector("svg");
        return {
          gap: getComputedStyle(actions).gap,
          icon: getComputedStyle(svg).width,
          stroke: getComputedStyle(svg).strokeWidth,
        };
      });
    if (!process.env.UI_CAPTURE_REVIEW)
      assert.deepEqual(geometry, { gap: "8px", icon: "16px", stroke: "1.5px" });
  }
  await seed(page);
  await navigate("home");
  await mount(page, "AddAccountDialog");
  await page.getByRole("button", { name: "OIDC Token", exact: true }).click();
  const segments = [];
  for (const theme of ["light", "dark"]) {
    await setAppearance("en", theme);
    for (const mode of ["Single", "Batch"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.waitForTimeout(200);
      const g = await page
        .getByRole("button", { name: mode, exact: true })
        .evaluate((e) => {
          const r = e.parentElement,
            s = getComputedStyle(e),
            rs = getComputedStyle(r);
          const sample = document.createElement("i");
          sample.style.backgroundColor = "var(--color-card)";
          document.body.append(sample);
          const card = getComputedStyle(sample).backgroundColor;
          sample.remove();
          return {
            mode: e.textContent.trim(),
            pressed: e.getAttribute("aria-pressed"),
            role: r.getAttribute("role"),
            font: s.fontSize,
            line: s.lineHeight,
            radius: s.borderRadius,
            height: r.getBoundingClientRect().height,
            padding: rs.padding,
            bg: s.backgroundColor,
            card,
          };
        });
      segments.push(g);
      if (!process.env.UI_CAPTURE_REVIEW) {
        assert.equal(g.pressed, "true");
        assert.equal(g.role, "group");
        assert.equal(g.font, "12px");
        assert.equal(g.line, "18px");
        assert.equal(g.height, 28);
        assert.equal(g.padding, "3px");
        assert.equal(g.radius, "5px");
        assert.equal(g.bg, g.card);
      }
    }
  }
  await unmount(page);
  await mount(page, "EditAccountDialog");
  const status = await page
    .getByText("Verified", { exact: true })
    .evaluate((e) => {
      const r = e.closest("div");
      const s = getComputedStyle(r);
      return {
        font: s.fontSize,
        line: s.lineHeight,
        height: r.getBoundingClientRect().height,
        padding: s.padding,
      };
    })
    .catch(() => null);
  await unmount(page);
  await mount(page, "AccountDetailDialog");
  const idp = await page
    .getByRole("dialog")
    .locator("span")
    .filter({ hasText: /^BuilderId$/ })
    .first()
    .evaluate((e) => ({
      font: getComputedStyle(e).fontSize,
      line: getComputedStyle(e).lineHeight,
      height: e.getBoundingClientRect().height,
    }));
  await unmount(page);
  await seed(page, 1);
  await state(
    page,
    `const accounts=new Map(s.accounts);accounts.set('fixture-0',{...accounts.get('fixture-0'),email:'',nickname:'Private Nickname'});store.setState({accounts,privacyMode:true})`,
  );
  await navigate("accounts");
  await page.getByTitle("Grid view", { exact: true }).click();
  const privateCard = page.locator('[data-account-id="fixture-0"]');
  await privateCard.scrollIntoViewIfNeeded();
  const masked = await state(page, "return s.maskNickname('Private Nickname')");
  const privacy = { card: await privateCard.locator("h3").innerText(), masked };
  await privateCard.locator("h3").click();
  privacy.copied = await page.evaluate(() => window.__clipboard);
  await privateCard.getByTitle("Details", { exact: true }).click();
  privacy.detailLeaks = (await page.getByRole("dialog").innerText()).includes(
    "Private Nickname",
  );
  if (!process.env.UI_CAPTURE_REVIEW) {
    assert.equal(privacy.card, masked);
    assert.equal(privacy.detailLeaks, false);
    assert.equal(privacy.copied, "fixture-user-0");
  }
  await page.getByTitle("Close", { exact: true }).click();
  await fs.writeFile(
    `${out}/review-geometry.json`,
    JSON.stringify({ popovers, segments, status, idp, privacy }, null, 2),
  );
  if (!process.env.UI_CAPTURE_REVIEW) {
    assert.equal(idp.font, "11px");
    assert.equal(idp.line, "16px");
    assert.equal(idp.height, 20);
    if (status) {
      assert.equal(status.font, "11px");
      assert.equal(status.line, "16px");
      assert.equal(status.height, 20);
    }
  }
  console.log(
    process.env.UI_CAPTURE_REVIEW
      ? "已捕获：审查前几何"
      : "通过：长菜单完整可达、菜单行字体/圆角、OIDC分段状态和几何、真实身份徽标",
  );
}
