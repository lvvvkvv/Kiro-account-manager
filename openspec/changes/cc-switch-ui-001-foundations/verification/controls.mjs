import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function verifyControls(page, out) {
  await page.evaluate(async () => {
    const { createElement: h, useState, createRoot } = await import('/__foundation_test__.js')
    const ui = await import('/src/components/ui/index.ts')
    window.__uiCounts = { action: 0, select: 0, toggle: 0, switch: 0, checkbox: 0, submit: 0, input: 0 }
    const host = document.createElement('div')
    host.id = 'foundation-fixture'
    host.style.cssText = 'padding:24px;max-width:760px;margin:auto'
    document.body.append(host)
    document.getElementById('root').style.display = 'none'
    function Fixture() {
      const [value, setValue] = useState('second')
      const [text, setText] = useState('')
      const [toggle, setToggle] = useState(false)
      const [checked, setChecked] = useState(false)
      const [compact, setCompact] = useState(true)
      return h('form', { onSubmit: event => { event.preventDefault(); window.__uiCounts.submit++ }, className: 'space-y-4' },
        h('h1', { className: 'ui-page-title' }, '公共 UI 核对 / UI foundations'),
        h('div', { className: 'ui-toolbar' }, ['default', 'gradient', 'outline', 'secondary', 'ghost', 'link', 'destructive'].map(variant =>
          h(ui.Button, { key: variant, type: 'button', variant, id: `button-${variant}`, onClick: () => window.__uiCounts.action++ }, variant))),
        h(ui.Button, { type: 'button', size: 'sm', id: 'compact' }, 'Compact'),
        h(ui.Button, { type: 'button', disabled: true, 'aria-busy': true, id: 'busy', onClick: () => window.__uiCounts.action++ }, 'Processing…'),
        h(ui.Button, { type: 'button', size: 'icon', 'aria-label': 'Refresh preview', id: 'icon' }, h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M4 12h16', stroke: 'currentColor' }))),
        h(ui.Label, { htmlFor: 'field' }, '名称 / Name'),
        h(ui.Input, { id: 'field', value: text, onChange: event => { window.__uiCounts.input++; setText(event.target.value) } }),
        h(ui.Input, { 'aria-label': 'Invalid input', 'aria-invalid': true, defaultValue: 'Invalid value' }),
        h(ui.Select, { 'aria-label': 'Preview select', value, options: [
          { value: 'first', label: 'First' }, { value: 'second', label: 'Second', description: 'Long option description '.repeat(5) },
          ...Array.from({ length: 24 }, (_, i) => ({ value: `item-${i}`, label: `Option ${i}` }))
        ], onChange: value => { window.__uiCounts.select++; setValue(value) } }),
        h('div', { className: 'ui-toolbar' },
          h(ui.Toggle, { 'aria-label': 'Toggle preview', checked: toggle, onChange: value => { window.__uiCounts.toggle++; setToggle(value) } }),
          h(ui.Switch, { 'aria-label': 'Switch preview', checked, onCheckedChange: value => { window.__uiCounts.switch++; setChecked(value) } }),
          h(ui.Switch, { 'aria-label': 'Compact switch', size: 'sm', checked: compact, onCheckedChange: value => { window.__uiCounts.compactSwitch = (window.__uiCounts.compactSwitch || 0) + 1; setCompact(value) } }),
          h(ui.Toggle, { 'aria-label': 'Compact toggle', size: 'sm', checked: true, onChange: () => {} }),
          h(ui.Switch, { 'aria-label': 'Disabled switch', checked: false, disabled: true, onCheckedChange: () => window.__uiCounts.switch++ }),
          h('label', {}, h('input', { type: 'checkbox', onChange: () => window.__uiCounts.checkbox++ }), ' Native checkbox')),
        h(ui.Alert, { variant: 'destructive' }, h(ui.AlertTitle, {}, 'Validation error'), h(ui.AlertDescription, {}, '错误说明 / Validation failed')),
        h('div', { className: 'ui-toolbar' }, ['default', 'secondary', 'destructive', 'outline', 'success'].map(variant => h(ui.Badge, { key: variant, variant }, variant))),
        ...['glass', 'glass-strong', 'glass-subtle', 'solid', 'elevated'].map(variant => h(ui.Card, { key: variant, variant, 'data-card': variant },
          h(ui.CardHeader, {}, h(ui.CardTitle, {}, variant)), h(ui.CardContent, {}, '正文 / Card content'))),
        h(ui.Progress, { value: 50, 'aria-label': 'Normal usage' }),
        h(ui.Progress, { value: 90, 'aria-label': 'Warning usage' }),
        h(ui.Progress, { value: 98, 'aria-label': 'Danger usage' }))
    }
    window.__fixtureRoot = createRoot(host)
    window.__fixtureRoot.render(h(Fixture))
  })
  const fixture = page.locator('#foundation-fixture')
  await fixture.getByRole('button', { name: 'default', exact: true }).click()
  await fixture.getByRole('button', { name: 'default', exact: true }).press('Enter')
  assert.equal(await page.evaluate(() => window.__uiCounts.action), 2)
  assert.equal(await fixture.locator('#busy').isDisabled(), true)
  await fixture.locator('#busy').evaluate(el => el.click())
  assert.equal(await page.evaluate(() => window.__uiCounts.action), 2)
  await fixture.getByLabel('名称 / Name').fill('中文 IME / English')
  assert.equal(await fixture.getByLabel('名称 / Name').inputValue(), '中文 IME / English')
  for (const name of ['Toggle preview', 'Switch preview']) {
    const control = fixture.getByRole('switch', { name, exact: true })
    await control.click()
    assert.equal(await control.getAttribute('aria-checked'), 'true')
    await control.press('Space')
    assert.equal(await control.getAttribute('aria-checked'), 'false')
    await control.press('Enter')
    assert.equal(await control.getAttribute('aria-checked'), 'true')
  }
  const checkbox = fixture.getByRole('checkbox', { name: 'Native checkbox' })
  await checkbox.click()
  await checkbox.press('Space')
  const select = fixture.getByRole('button', { name: 'Preview select' })
  await select.click()
  assert.equal(await page.getByRole('option', { name: /^Second/ }).evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__uiCounts.select), 1)
  assert.equal(await select.textContent(), 'First')
  await select.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.__uiCounts.select), 1)
  assert.equal(await select.evaluate(el => el === document.activeElement), true)
  await select.click()
  await page.getByRole('option', { name: /^Second/ }).click()
  assert.equal(await page.evaluate(() => window.__uiCounts.select), 2)
  assert.deepEqual(await page.evaluate(() => {
    const { toggle, switch: switchCount, checkbox, submit } = window.__uiCounts
    return [toggle, switchCount, checkbox, submit]
  }), [3, 3, 2, 0])
  await fixture.getByRole('switch', { name: 'Compact switch', exact: true }).click()
  assert.equal(await fixture.getByRole('switch', { name: 'Compact switch', exact: true }).getAttribute('aria-checked'), 'false')
  await fixture.getByRole('switch', { name: 'Compact switch', exact: true }).press('Space')
  assert.equal(await fixture.getByRole('switch', { name: 'Compact switch', exact: true }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.evaluate(() => window.__uiCounts.compactSwitch), 2)
  await select.press('Tab')
  await page.keyboard.press('Shift+Tab')
  assert.match(await select.evaluate(el => getComputedStyle(el).boxShadow), /3px/, '选择器与 Input 同为3px焦点环')
  const metrics = await fixture.evaluate(host => {
    const css = selector => getComputedStyle(host.querySelector(selector))
    return {
      regularHeight: css('#button-default').height, compactHeight: css('#compact').height,
      buttonRadius: css('#button-default').borderRadius, buttonPadding: css('#button-default').paddingInline,
      fontSize: css('#button-default').fontSize, buttonGap: css('#button-default').gap,
      inputHeight: css('#field').height, inputRadius: css('#field').borderRadius,
      cardRadius: css('[data-card="solid"]').borderRadius,
      cardPadding: css('[data-card="solid"] > div').padding,
      switchSize: [css('[aria-label="Switch preview"]').width, css('[aria-label="Switch preview"]').height],
      iconSize: [css('#icon svg').width, css('#icon svg').height],
      compactSwitch: [css('[aria-label="Compact switch"]').width, css('[aria-label="Compact switch"]').height, css('[aria-label="Compact switch"] > span').width, css('[aria-label="Compact switch"] > span').height],
      compactToggle: [css('[aria-label="Compact toggle"]').width, css('[aria-label="Compact toggle"]').height, css('[aria-label="Compact toggle"] > span').width, css('[aria-label="Compact toggle"] > span').height],
      ghostBorder: css('#button-ghost').borderLeftWidth,
      secondaryBorder: css('#button-secondary').borderLeftWidth,
      secondaryBackground: css('#button-secondary').backgroundColor,
      blur: [...host.querySelectorAll('[data-card]')].map(el => getComputedStyle(el).backdropFilter)
    }
  })
  assert.deepEqual(metrics, {
    regularHeight: '32px', compactHeight: '28px', buttonRadius: '6px', buttonPadding: '14px',
    fontSize: '13px', buttonGap: '6px', inputHeight: '32px', inputRadius: '6px', cardRadius: '10px',
    cardPadding: '16px', switchSize: ['30px', '18px'], iconSize: ['16px', '16px'],
    compactSwitch: ['26px', '16px', '12px', '12px'], compactToggle: ['26px', '16px', '12px', '12px'],
    ghostBorder: '0px', secondaryBorder: '0px', secondaryBackground: 'rgba(0, 0, 0, 0)', blur: Array(5).fill('none')
  })
  await page.keyboard.press('Tab')
  await fixture.locator('#icon').focus()
  assert.equal(await fixture.locator('#icon').evaluate(el => el.matches(':focus-visible')), true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.getByRole('progressbar', { name: 'Danger usage' }).getAttribute('aria-valuenow'), '98')
  assert.equal(await page.getByRole('progressbar', { name: 'Normal usage' }).locator('div').evaluate(el => getComputedStyle(el).transitionProperty), 'none')
  await fs.writeFile(`${out}/control-metrics.json`, JSON.stringify(metrics, null, 2))
  for (const mode of ['light', 'dark']) {
    await page.evaluate(async mode => { const { useAccountsStore } = await import('/src/store/accounts.ts'); useAccountsStore.getState().setTheme(mode) }, mode)
    await page.waitForTimeout(250)
    assert.equal(await fixture.locator('#button-outline').evaluate(el => getComputedStyle(el).backgroundColor), mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(46, 46, 51)')
    await page.screenshot({ path: `${out}/controls-${mode}.png`, fullPage: true })
  }
  await page.evaluate(() => {
    const overlay = document.createElement('div')
    overlay.id = 'presentation-dialog'
    overlay.className = 'ui-dialog-overlay'
    const panel = document.createElement('section')
    panel.className = 'ui-dialog-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Presentation preview')
    panel.innerHTML = '<header class="ui-dialog-header"><h2>长内容 / Long content preview</h2></header><div class="ui-dialog-body">' + '<p>这是长文本说明。Long explanatory content that must remain readable and scrollable.</p>'.repeat(80) + '</div><footer class="ui-dialog-footer"><button type="button">Cancel preview</button></footer>'
    overlay.append(panel)
    document.body.append(overlay)
  })
  const preview = page.getByRole('dialog', { name: 'Presentation preview' })
  const footer = await preview.locator('.ui-dialog-footer').boundingBox()
  const heading = await preview.getByRole('heading').boundingBox()
  assert.equal(footer.y + footer.height <= 600 && heading.y >= 16, true)
  await preview.locator('.ui-dialog-body').evaluate(el => { el.scrollTop = el.scrollHeight })
  assert.deepEqual(await preview.locator('.ui-dialog-footer').boundingBox(), footer)
  await page.screenshot({ path: `${out}/presentation-long-dialog-800.png` })
  await page.locator('#presentation-dialog').evaluate(el => el.remove())
  await page.evaluate(() => { window.__fixtureRoot.unmount(); document.getElementById('foundation-fixture').remove(); document.getElementById('root').style.display = '' })
  console.log('通过：基础控件尺寸、间距、圆角、字体、键鼠单次事件、禁用、焦点与减少动效')
}
