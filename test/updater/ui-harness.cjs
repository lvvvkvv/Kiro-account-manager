const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const output = process.argv[2]
app.setPath('userData', path.join(output, 'user-data'))
app.dock?.hide()
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1050,
      height: 820,
      show: false,
      webPreferences: { sandbox: true }
    })
    const js = (source) => window.webContents.executeJavaScript(source)
    const click = (label) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`
      )
    const screenshot = async (name) =>
      fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG())
    window.webContents.on('console-message', (_event, _level, message) => console.log(message))
    await window.loadFile(path.join(output, 'index.html'))
    await delay(400)
    await click('检查更新')
    await delay(100)
    assert(await js(`document.body.textContent.includes('更新到 v1.8.0')`))
    assert(await js(`!!document.querySelector('[aria-label="有可用更新"]')`))
    assert.equal(await js(`document.querySelectorAll('[role="dialog"]').length`), 0)
    await js(`document.querySelector('[role="switch"]').click()`)
    await delay(100)
    assert(await js(`document.body.textContent.includes('42%')`))
    await screenshot('downloading.png')
    await js(
      `window.updateTest.push({downloading:false,ready:window.updateTest.getState().available,routingInUse:true,progress:100})`
    )
    await delay(150)
    assert(
      await js(
        `document.body.textContent.includes('立即安装') && document.body.textContent.includes('重启将中断')`
      )
    )
    await screenshot('ready.png')
    await click('稍后')
    await delay(100)
    assert.equal(await js(`document.body.textContent.includes('立即安装')`), false)
    assert(await js(`document.body.textContent.includes('更新到 v1.8.0')`))
    await js(
      `window.updateTest.push({ready:{version:'1.8.1',notes:'新版本',installable:true},available:{version:'1.8.1',notes:'新版本',installable:true},error:'更新包校验失败，请手动下载。'})`
    )
    await delay(100)
    assert(await js(`document.body.textContent.includes('立即安装')`))
    await click('手动下载')
    await delay(50)
    assert(await js(`window.updateTest.calls.includes('manual')`))
    await click('立即安装')
    await delay(100)
    assert.equal(await js(`window.updateTest.calls.filter(c=>c==='install').length`), 1)
    assert(
      await js(
        `Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.includes('安装中')).every(b=>b.disabled)`
      )
    )
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          checks: [
            'shared about state',
            'sidebar dot',
            'no update modal',
            'background download',
            'routing warning',
            'dismiss by version',
            'new version reminder',
            'manual fallback',
            'install lock'
          ],
          calls: await js('window.updateTest.calls')
        },
        null,
        2
      )
    )
    console.log('PASS update UI behavior')
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
