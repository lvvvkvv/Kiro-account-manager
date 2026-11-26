// 独立Electron窗口：复用应用窗口尺寸／原生标题栏参数，只加载mock renderer。
// 不启动应用main，不读写真实electron-store，不检查或安装更新。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { installFixture } from "./fixtures.mjs";

export async function verifyNative({ page, out, appRoot }) {
  if (process.platform !== "darwin") {
    console.log("待测：原生macOS窗口（当前不是macOS）");
    return;
  }
  const { _electron } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  );
  const require = createRequire(path.join(appRoot, "package.json"));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cc-shell-native-"));
  const src = path.join(appRoot, "src/renderer/src");
  const names = new Set();
  async function scan(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (/\.tsx?$/.test(entry.name))
        for (const match of (await fs.readFile(file, "utf8")).matchAll(
          /window\.api\.(\w+)/g,
        ))
          names.add(match[1]);
    }
  }
  await scan(src);
  await fs.writeFile(
    path.join(temp, "preload.cjs"),
    `
const {contextBridge,ipcRenderer}=require('electron');
(${installFixture.toString()})({platform:'darwin'});
const api={};for(const name of ${JSON.stringify([...names])})if(name!=='window')api[name]=window.api[name];
api.window={getPlatform:()=>ipcRenderer.invoke('platform'),isMaximized:()=>ipcRenderer.invoke('maximized'),minimize:()=>ipcRenderer.send('minimize'),maximizeToggle:()=>ipcRenderer.send('maximize'),close:()=>ipcRenderer.send('close'),onMaximizeChange:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('maximize-change',listener);return ()=>ipcRenderer.removeListener('maximize-change',listener)}};
contextBridge.exposeInMainWorld('api',api);
`,
  );
  await fs.writeFile(
    path.join(temp, "main.cjs"),
    `
const {app,BrowserWindow,ipcMain}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'data'));
app.whenReady().then(()=>{
const win=new BrowserWindow({width:800,height:600,minWidth:800,minHeight:600,show:true,frame:true,titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:12},webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:false,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
global.fixtureWindow=win;
ipcMain.handle('platform',()=>process.platform);ipcMain.handle('maximized',()=>win.isMaximized());
ipcMain.on('minimize',()=>win.minimize());ipcMain.on('maximize',()=>win.isMaximized()?win.unmaximize():win.maximize());ipcMain.on('close',()=>win.close());
win.on('maximize',()=>win.webContents.send('maximize-change',true));win.on('unmaximize',()=>win.webContents.send('maximize-change',false));
win.loadURL(${JSON.stringify(page.url())});
});
`,
  );
  const electron = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(temp, "main.cjs")],
    timeout: 20000,
  });
  try {
    const native = await electron.firstWindow();
    await native.getByText("Total Accounts", { exact: true }).waitFor();
    assert.deepEqual(
      await electron.evaluate(() =>
        global.fixtureWindow.getWindowButtonPosition(),
      ),
      { x: 14, y: 12 },
    );
    await native.evaluate(() => window.api.window.minimize());
    await native.waitForTimeout(500);
    assert.equal(
      await electron.evaluate(() => global.fixtureWindow.isMinimized()),
      true,
    );
    await electron.evaluate(() => global.fixtureWindow.restore());
    await native.waitForTimeout(500);
    assert.equal(
      await electron.evaluate(() => global.fixtureWindow.isMinimized()),
      false,
    );
    await native.evaluate(() => window.api.window.maximizeToggle());
    await native.waitForTimeout(600);
    assert.equal(
      await electron.evaluate(() => global.fixtureWindow.isMaximized()),
      true,
    );
    await native.evaluate(() => window.api.window.maximizeToggle());
    await native.waitForTimeout(600);
    assert.equal(
      await electron.evaluate(() => global.fixtureWindow.isMaximized()),
      false,
    );
    await native.screenshot({ path: `${out}/native-macos-800.png` });
    const closed = native.waitForEvent("close");
    await native
      .evaluate(() => window.api.window.close())
      .catch((error) => {
        if (!String(error).includes("closed")) throw error;
      });
    await closed;
    await fs.writeFile(
      `${out}/native-window.json`,
      JSON.stringify(
        {
          platform: "darwin",
          electron: require("electron/package.json").version,
          trafficLights: { x: 14, y: 12 },
          minimize: true,
          restore: true,
          maximize: true,
          unmaximize: true,
          close: true,
          manualDrag: "待测",
          windows: "仅renderer模拟",
          linux: "仅renderer模拟",
        },
        null,
        2,
      ),
    );
    console.log(
      "通过：独立Electron macOS原生窗口留位及最小化／恢复／最大化／还原／关闭；真实拖动及Windows/Linux原生待测",
    );
  } finally {
    await electron.close();
  }
}
