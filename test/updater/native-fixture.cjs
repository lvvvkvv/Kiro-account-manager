const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const appPath = path.resolve(process.execPath, '../../..')
const directory = path.dirname(appPath)
const config = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.json'), 'utf8'))
app.setPath('userData', path.join(directory, 'user-data'))
app.setPath('sessionData', path.join(directory, 'user-data', 'session'))
app.dock?.hide()
const index = process.argv.indexOf('--kiro-update-token')
const token = index >= 0 ? process.argv[index + 1] : 'initial'
const version = app.getVersion()
if (config.failEarly && version === '0.0.2') {
  // Alive, but never reaches updater initialization or writes its own PID/health record.
  app.whenReady().then(() => setInterval(() => {}, 1000))
  return
}
const record = { pid: process.pid, version, token, executable: process.execPath }
const save = (file, data) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data))
  fs.renameSync(file + '.tmp', file)
}
save(path.join(directory, 'fixture-instance.json'), record)
fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(record) + '\n')
if (token !== 'initial') save(path.join(config.transaction, 'instance.json'), record)
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await window.loadURL('data:text/html,<p>Native updater integration fixture</p>')
    if (!(await window.webContents.executeJavaScript('document.readyState === "complete"')))
      throw new Error('Renderer not ready')
    const sentinel = path.join(directory, 'user-data', 'sentinel')
    if (!fs.existsSync(sentinel)) fs.writeFileSync(sentinel, 'created-by-0.0.1')
    if (fs.readFileSync(sentinel, 'utf8') !== 'created-by-0.0.1') throw new Error('Lost data')
    if (token === 'initial') {
      save(path.join(directory, 'fixture-ready.json'), record)
      const timer = setInterval(() => {
        if (!fs.existsSync(path.join(directory, 'install-now'))) return
        clearInterval(timer)
        const log = fs.openSync(path.join(directory, 'native.log'), 'a')
        const helper = spawn(
          config.helper,
          ['install', path.join(config.transaction, 'transaction.json')],
          { detached: true, stdio: ['ignore', log, log] }
        )
        helper.unref()
        fs.closeSync(log)
        const armed = setInterval(() => {
          if (fs.existsSync(path.join(config.transaction, 'armed'))) {
            clearInterval(armed)
            if (config.cancelInstall) {
              const file = path.join(config.transaction, 'transaction.json')
              save(file, { ...JSON.parse(fs.readFileSync(file, 'utf8')), phase: 'cancelled' })
              return
            }
            app.quit()
          }
        }, 50)
      }, 50)
    } else if (!(config.failHealth && version === '0.0.2')) {
      save(path.join(config.transaction, 'health.json'), record)
    }
  })
  .catch((error) => {
    fs.writeFileSync(path.join(directory, 'fixture-error.txt'), String(error))
    app.exit(1)
  })
