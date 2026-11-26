# macOS 无 Developer ID 更新实验

本目录是独立的技术验证，不接入正式更新流程、不导入业务代码，也不访问真实账号、代理配置或生产应用数据。两个测试应用使用项目已安装的 Electron 运行时，版本分别为 `0.0.1` 和 `0.0.2`。

## 运行

在 macOS 上，先确保项目依赖已安装，然后从仓库根目录执行：

```sh
node test/macos-updater-poc/run.mjs
```

依赖本机 Node、`codesign`、`ditto`、`PlistBuddy` 和可用的桌面登录会话。会启动隐藏的 Electron 测试窗口，并在每个场景结束时终止测试应用。完整 `.app` 和 ZIP 会占用数 GB 磁盘；输出保存在已被 Git 忽略的 `dist/macos-updater-poc/<时间>/`。不会修改 `/Applications`、钥匙串或 Gatekeeper 设置。

## 验证机制

- `run.mjs`：复制 Electron 运行时，注入最小测试应用，设置独立 bundle ID，使用项目现有 entitlements 对两个版本执行 `codesign --force --deep --sign -`，并检查签名。
- 更新清单包含版本、架构、应用标识和 ZIP 的 SHA-256，使用本次运行临时生成的 Ed25519 私钥签名。公钥保存在实验目录，私钥仅保存在运行器内存中。借鉴独立更新验签机制，未实现 Tauri/Minisign 文件格式兼容。
- `fixture.cjs`：使用独立 userData/sessionData；真实创建 BrowserWindow、加载页面并执行渲染进程 JavaScript，再写入带随机启动 token 的健康回执。旧版启动外部辅助进程后自行退出。
- `helper.mjs`：等待旧进程退出，验签和校验 ZIP 摘要，解压并验证新 `.app` 签名及标识；在同一安装卷上将旧版改名保留，再放入新版，通过 LaunchServices 的 `open -n` 重启。
- 收到新版主进程和渲染页面的健康回执才判定成功。测试还检查旧版写入的数据哨兵保持不变，以及重启后 PID 确实发生变化。成功时也保留旧包，便于检查。
- 替换或健康检查失败时停止测试实例、恢复旧包并验证旧版能够重新启动。使用事务日志记录阶段。
- 辅助进程中断场景是在旧包移走后执行 `process.exit(86)`，由测试运行器再次调用 `--recover` 恢复。它验证的是恢复入口，不代表已经实现自动守护、断电恢复或生产启动恢复机制。

## 本次实测结果

时间：2026-11-26 19:31（Asia/Shanghai）。

环境：macOS 27.2.1（26B131），Apple Silicon arm64；本地 Electron 38.7.2，Node v26.8.1。

两个版本均通过 `codesign --verify --deep --strict`，签名信息均为 `Signature=adhoc`、`TeamIdentifier=not set`。未使用 Developer ID、Apple 公证或 Apple 私钥。

| 场景 | 结果 | 最终运行版本 | 耗时 |
| --- | --- | --- | --- |
| 正常替换并重启 | 通过 | 0.0.2 | 10.54 秒 |
| 更新清单签名无效 | 拒绝更新，重新启动旧版 | 0.0.1 | 4.37 秒 |
| 旧版移入备份后注入失败 | 恢复旧包并启动 | 0.0.1 | 5.86 秒 |
| 新版替换完成后注入失败 | 恢复旧包并启动 | 0.0.1 | 5.47 秒 |
| 新版不发送健康回执 | 超时后停止新版，恢复旧版 | 0.0.1 | 17.76 秒 |
| 辅助进程在备份后中断 | 再次调用恢复入口，旧版启动成功 | 0.0.1 | 7.66 秒 |

六个场景均验证了最终主进程和渲染页面健康、数据哨兵未改变、重启 PID 与原 PID 不同、最终安装包签名有效。正常升级的 PID 为 `73178 → 73259`。运行结束后检查未发现本次测试应用或辅助进程残留。

原始证据：

- `dist/macos-updater-poc/2026-11-26T11-30-37-547Z/report.json`：机器环境、签名信息、各场景断言结果、PID 和健康回执。
- 同目录 `signatures.json`：两个版本完整的代码签名信息。
- 各场景子目录 `events.jsonl`、`journal.json`、`result.json` 和 `helper.log`：启动、替换、恢复记录。

## Gatekeeper 检查和结论边界

另外对新版执行了只读检查：

```sh
spctl --assess --type execute --verbose=2 '<实验目录>/versions/0.0.2/Kiro Update Probe.app'
```

结果为 `rejected`，退出码 `3`。这与本地测试能够启动并不矛盾：本实验构建的是本地产物，并未模拟浏览器下载后的 quarantine 状态，也没有移除 quarantine、添加系统白名单或关闭安全检查。

本实验已验证：在当前 macOS arm64、本地可写安装位置上，ad-hoc 签名 Electron 应用可以通过独立验签和辅助进程完成替换、重启与指定故障恢复，无需 Apple Developer ID。

尚未验证：浏览器首次下载及系统安全提示、Intel Mac、其他 macOS 版本、受限安装目录及提权、只读 DMG/App Translocation、跨卷、磁盘满、真实断电、下载失败、并发升级、业务数据迁移和真实反代服务退出。测试运行器使用的宿主 Node 路径也不能直接用于正式分发；正式方案需要随包交付且可独立运行的辅助程序。

辅助程序只接受实验目录内的目标路径，但不是面向恶意输入的完整生产安全实现。正式接入前还需要设计密钥生命周期、归档安全解压、恢复入口触发、备份保留策略，以及旧版升级到首个支持新机制版本的过渡方式。当前实验不能直接替换正式 updater。
