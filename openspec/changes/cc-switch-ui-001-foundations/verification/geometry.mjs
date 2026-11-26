import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const runGit = promisify(execFile)
const referenceCommit = 'f29d0804b05ce374ee650c64706399cd0da01805'

// 显式供测试构建扫描；这些入口在后续页面使用时也由 Tailwind 正常生成。
const fontClasses = [
  'text-badge',
  'text-caption',
  'text-body',
  'text-strong',
  'text-section',
  'text-title',
  'text-page',
  'text-metric'
]
const radiusClasses = [
  'rounded-sm',
  'rounded-md',
  'rounded-lg',
  'rounded-xl',
  'rounded-2xl',
  'rounded-3xl',
  'rounded-control',
  'rounded-panel',
  'rounded-dialog'
]

async function readReference(referenceRoot) {
  const files = [
    'docs/design-system.html',
    'tailwind.config.cjs',
    'src/components/settings/SettingsLayout.tsx',
    'src/components/ui/dialog.tsx'
  ]
  const [design, config, settings, dialog] = await Promise.all(
    files.map(async (file) => {
      const result = await runGit(
        'git',
        ['-C', referenceRoot, 'show', `${referenceCommit}:${file}`],
        { maxBuffer: 1024 * 1024 }
      )
      return result.stdout
    })
  )
  const fonts = Object.fromEntries(
    [
      ...design.matchAll(
        /<span class="tk">(\w+)<\/span><span class="sz">(\d+) \/ (\d+) · (\d+)<\/span>/g
      )
    ].map(([, name, size, height, weight]) => [name, [`${size}px`, `${height}px`, weight]])
  )
  assert.equal(Object.keys(fonts).length, 8, '参考设计应含八种字体角色')
  const radiusBlock = config.match(/borderRadius:\s*\{([\s\S]*?)\n\s*\}/)[1]
  const radii = Object.fromEntries(
    [...radiusBlock.matchAll(/(\w+):\s*"([\d.]+)(px|rem)"/g)].map(([, name, value, unit]) => [
      name,
      `${Number(value) * (unit === 'rem' ? 16 : 1)}px`
    ])
  )
  // 参考未覆写的 2xl／3xl 沿用 Tailwind 默认档位。
  Object.assign(radii, { '2xl': '16px', '3xl': '24px' })
  const [, py] = settings.match(/cn\("px-\d+ py-(\d+)"/)
  const [, rowMin] = settings.match(/flex min-h-\[(\d+)px\] items-center gap-\d+/)
  const [, dialogVH] = dialog.match(/max-h-\[(\d+)vh\]/)
  assert.match(dialog, /max-w-lg/)
  assert.match(dialog, /flex-col gap-1 px-6 pb-3 pt-5/)
  return {
    fonts,
    radii,
    fontFamily: design.match(/--font-sans:([\s\S]*?);/)[1].trim(),
    fontMono: design.match(/--font-mono:([\s\S]*?);/)[1].trim(),
    settingHeight: Number(rowMin) + Number(py) * 8,
    dialogVH: Number(dialogVH) / 100
  }
}

export async function verifyGeometry(page, out, referenceRoot = process.env.UI_REFERENCE_ROOT) {
  // 无参考 checkout 时仍使用固定提交的验收值；设置 UI_REFERENCE_ROOT 可直接从参考源码读取。
  const expected = referenceRoot
    ? await readReference(referenceRoot)
    : {
        fonts: {
          badge: ['11px', '16px', '500'],
          caption: ['12px', '18px', '400'],
          body: ['13px', '20px', '400'],
          strong: ['14px', '20px', '500'],
          section: ['15px', '22px', '600'],
          title: ['16px', '24px', '600'],
          page: ['18px', '26px', '600'],
          metric: ['24px', '32px', '600']
        },
        radii: {
          sm: '6px',
          md: '8px',
          lg: '12px',
          xl: '14px',
          '2xl': '16px',
          '3xl': '24px',
          control: '6px',
          panel: '10px',
          dialog: '14px'
        },
        settingHeight: 52,
        dialogVH: 0.9
      }
  if (referenceRoot) {
    const actual = await page.evaluate(({ fontFamily, fontMono }) => {
      const probe = document.createElement('span')
      document.body.append(probe)
      probe.style.fontFamily = fontFamily
      const referenceSans = getComputedStyle(probe).fontFamily
      probe.style.fontFamily = 'var(--font-mono)'
      const actualMono = getComputedStyle(probe).fontFamily
      probe.style.fontFamily = fontMono
      const referenceMono = getComputedStyle(probe).fontFamily
      probe.remove()
      return {
        actualSans: getComputedStyle(document.body).fontFamily,
        referenceSans,
        actualMono,
        referenceMono
      }
    }, expected)
    assert.equal(actual.actualSans, actual.referenceSans)
    assert.equal(actual.actualMono, actual.referenceMono)
  }
  await page.setViewportSize({ width: 800, height: 600 })
  await page.evaluate(
    async ({ fontClasses, radiusClasses }) => {
      document.getElementById('root').style.display = 'none'
      const host = document.createElement('main')
      host.id = 'geometry-fixture'
      host.style.cssText =
        'padding:24px;display:flex;flex-direction:column;gap:16px;align-items:flex-start'
      const icon =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" stroke="currentColor"/></svg>'
      host.innerHTML = `<h1 class="ui-page-title">公共规范几何核对 / Geometry</h1>
      <div>${fontClasses.map((name) => `<div data-font="${name.slice(5)}" class="${name}">${name} 字体 / Typography</div>`).join('')}</div>
      <div>${radiusClasses.map((name) => `<div data-radius="${name.slice(8)}" class="${name}"></div>`).join('')}</div>
      <div class="ui-setting-row" id="geometry-setting"><span>无控件设置行 / Setting</span></div>
      <div class="ui-segmented" id="geometry-segment"><button type="button" aria-pressed="true">${icon}<span>System</span></button><button type="button">Light</button></div>
      <div class="ui-segmented ui-segmented-sm" id="geometry-segment-sm"><button type="button" aria-pressed="true">${icon}<span>System</span></button><button type="button">Light</button></div>
      <div class="ui-tabs"><button type="button" role="tab">Tab</button></div>
      <div class="ui-dialog-overlay"><section class="ui-dialog-panel" role="dialog" aria-label="Geometry dialog">
        <header class="ui-dialog-header"><h2>Dialog title</h2><p>Description</p></header>
        <div class="ui-dialog-body">${'<p>Long content 长文本滚动测试。</p>'.repeat(80)}</div>
        <footer class="ui-dialog-footer"><button type="button">Cancel</button><button type="button">Confirm</button></footer>
      </section></div>`
      document.body.append(host)
    },
    { fontClasses, radiusClasses }
  )
  const results = []
  for (const mode of ['light', 'dark']) {
    await page.evaluate(async (mode) => {
      const { useAccountsStore } = await import('/src/store/accounts.ts')
      useAccountsStore.getState().setTheme(mode)
    }, mode)
    const metrics = await page.locator('#geometry-fixture').evaluate((host) => {
      const el = (selector) => host.querySelector(selector)
      const css = (selector) => getComputedStyle(el(selector))
      const rect = (selector) => {
        const r = el(selector).getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      const segment = (id) => ({
        height: rect(id).height,
        radius: css(id).borderRadius,
        padding: css(id).padding,
        button: rect(`${id} > button`),
        buttonRadius: css(`${id} > button`).borderRadius,
        font: [
          css(`${id} > button`).fontSize,
          css(`${id} > button`).lineHeight,
          css(`${id} > button`).fontWeight
        ],
        icon: rect(`${id} svg`),
        label: rect(`${id} span`)
      })
      return {
        fontFamily: getComputedStyle(document.body).fontFamily,
        fonts: Object.fromEntries(
          [...host.querySelectorAll('[data-font]')].map((node) => {
            const c = getComputedStyle(node)
            return [node.dataset.font, [c.fontSize, c.lineHeight, c.fontWeight]]
          })
        ),
        radii: Object.fromEntries(
          [...host.querySelectorAll('[data-radius]')].map((node) => [
            node.dataset.radius,
            getComputedStyle(node).borderRadius
          ])
        ),
        settingHeight: rect('#geometry-setting').height,
        segment: segment('#geometry-segment'),
        smallSegment: segment('#geometry-segment-sm'),
        tabWeight: css('[role=tab]').fontWeight,
        dialog: {
          rect: rect('[role=dialog]'),
          radius: css('[role=dialog]').borderRadius,
          gap: css('.ui-dialog-header').gap,
          title: [
            css('.ui-dialog-header h2').fontSize,
            css('.ui-dialog-header h2').lineHeight,
            css('.ui-dialog-header h2').fontWeight
          ],
          headerPadding: css('.ui-dialog-header').padding,
          footerPadding: css('.ui-dialog-footer').padding,
          header: rect('.ui-dialog-header'),
          footer: rect('.ui-dialog-footer')
        }
      }
    })
    assert.deepEqual(metrics.fonts, expected.fonts)
    assert.deepEqual(metrics.radii, expected.radii)
    assert.equal(metrics.settingHeight, expected.settingHeight)
    for (const [segment, height, radius, innerRadius, iconSize, font] of [
      [metrics.segment, 36, '10px', '7px', 16, expected.fonts.body],
      [metrics.smallSegment, 28, '8px', '5px', 14, expected.fonts.caption]
    ]) {
      assert.equal(segment.height, height)
      assert.equal(segment.radius, radius)
      assert.equal(segment.buttonRadius, innerRadius)
      assert.equal(segment.padding, '3px')
      assert.deepEqual(segment.font, [font[0], font[1], '500'])
      assert.equal(segment.icon.width, iconSize)
      assert.equal(segment.icon.height, iconSize)
      assert.equal(
        segment.icon.y + iconSize / 2,
        segment.button.y + segment.button.height / 2,
        '图标应在按钮中垂直居中'
      )
      assert.equal(segment.label.y + segment.label.height / 2, segment.icon.y + iconSize / 2)
      assert.equal(segment.label.x - segment.icon.x - segment.icon.width, 6)
    }
    assert.equal(metrics.tabWeight, '500')
    assert.equal(metrics.dialog.rect.width, 512, '无调用方宽度补丁时仍应具有参考默认宽度')
    assert.equal(metrics.dialog.rect.height, 600 * expected.dialogVH)
    assert.equal(metrics.dialog.radius, expected.radii.dialog)
    assert.equal(metrics.dialog.gap, '4px')
    assert.deepEqual(metrics.dialog.title, expected.fonts.title)
    assert.equal(metrics.dialog.headerPadding, '20px 24px 12px')
    assert.equal(metrics.dialog.footerPadding, '12px 24px 20px')
    await page.locator('#geometry-fixture .ui-dialog-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    assert.deepEqual(
      await page.locator('#geometry-fixture .ui-dialog-footer').boundingBox(),
      metrics.dialog.footer
    )
    await page.screenshot({ path: `${out}/geometry-dialog-${mode}-800.png` })
    results.push({ mode, ...metrics })
  }
  await page.locator('#geometry-fixture .ui-dialog-overlay').evaluate((el) => el.remove())
  await page.screenshot({
    path: `${out}/geometry-layout-800.png`,
    fullPage: true
  })
  await page.evaluate(() => {
    document.getElementById('geometry-fixture').remove()
    document.getElementById('root').style.display = ''
  })
  await fs.writeFile(
    `${out}/geometry-metrics.json`,
    JSON.stringify(
      {
        reference: referenceRoot || '固定提交验收值',
        commit: referenceCommit,
        results
      },
      null,
      2
    )
  )
  console.log(
    '通过：八种字体角色、圆角别名、设置行、分段图文、页签字重、无宽度补丁的弹窗；明暗模式均与参考一致'
  )
}
