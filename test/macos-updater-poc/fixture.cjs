// Deliberately tiny Electron app: never loads production application code/data.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const configPath = process.argv[process.argv.indexOf('--poc-config') + 1]
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
app.setPath('userData', config.userData)
app.setPath('sessionData', path.join(config.userData, 'session'))
app.dock?.hide()
const version = app.getVersion()
const record = { version, pid: process.pid, token: config.token, executable: process.execPath }
const save = (file, value) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
save(config.instancePath, record)
fs.appendFileSync(config.eventsPath, JSON.stringify({ event: 'started', ...record }) + '\n')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<title>macOS updater isolated probe</title><p>Ready</p>')
  const rendererReady = await win.webContents.executeJavaScript('document.readyState === "complete"')
  const sentinelPath = path.join(config.userData, 'sentinel.json')
  if (!fs.existsSync(sentinelPath)) save(sentinelPath, { createdBy: version, value: config.sentinel })
  const sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'))
  if (!(config.failNewHealth && version === '0.0.2')) {
    save(config.healthPath, { ...record, rendererReady, sentinel })
  }
  if (version === '0.0.1' && !fs.existsSync(config.requestedPath)) {
    fs.writeFileSync(config.requestedPath, 'requested', { flag: 'wx' })
    const log = fs.openSync(config.helperLogPath, 'a')
    const helper = spawn(config.nodePath, [config.helperPath, config.jobPath, String(process.pid)], {
      detached: true, stdio: ['ignore', log, log]
    })
    helper.unref()
    fs.closeSync(log)
    fs.appendFileSync(config.eventsPath, JSON.stringify({ event: 'old-exiting', ...record }) + '\n')
    app.quit()
  }
}).catch(error => {
  fs.appendFileSync(config.eventsPath, JSON.stringify({ event: 'fixture-error', error: String(error) }) + '\n')
  app.exit(1)
})
