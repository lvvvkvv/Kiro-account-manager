# 应用更新

## 用户流程

更新状态由主进程统一维护，关于页、侧栏、后台任务和托盘共用。启动约 1 秒后检查更新；自动下载默认关闭。打开开关会立即检查并下载，后台另有启动 60 秒后的检查及每 6 小时一次的检查。

发现新版时关于页显示“更新到 vX”，侧栏显示红点；自动下载完成后右下角提示“稍后 / 立即安装”。“稍后”按版本持久化，同一版本不重复提示，关于页和托盘安装入口保留。关闭自动下载会清除待安装状态。下载好的包不会随普通退出自动安装。

点击安装会重新检查发行版。已撤回或不再可用的包不会安装；联网失败时可以使用本地已验签的缓存。签名错误不属于可使用缓存绕过的网络错误。手动下载链接始终可用；不支持自安装的位置/包格式、旧发行版缺少签名清单或更新失败时，都可以前往本仓库 Releases。

## macOS 安装机制

保留 Electron 和 ad-hoc 应用签名，不依赖 Apple Developer ID、Apple 公证、Squirrel.Mac 或用户安装的 Node/Python。

- 发布的 `kiro-update-mac-arm64.json` / `kiro-update-mac-x64.json` 是 Ed25519 签名信封，包含 base64 编码的 JSON payload 和签名。payload 绑定版本、架构、bundle ID、应用名、ZIP 文件名、大小和 SHA-256。
- 公钥保存在 `resources/update-public-key.json`，同时编入主进程和原生辅助程序。下载时主进程验签并流式检查大小/摘要，辅助程序安装前独立重验。
- `build/macos-updater/main.swift` 使用 Foundation、CryptoKit 和 Darwin 系统 API。`scripts/build-mac-updater.mjs` 编译 x86_64/arm64 通用程序，`build/after-pack.cjs` 将其加入 `.app/Contents/Resources/kiro-updater`，再对应用执行 ad-hoc 签名。
- 安装前先在旧应用仍可用时检查当前/目标应用标识、版本、代码签名、架构、ZIP 路径及 bundle 内符号链接，并将目标应用解压到安装目录同一卷上的独立暂存目录。
- 页面先确认账号状态已保存，然后主进程停止反代、刷新存储与备份、保存日志、关闭刷新调度器和 TLS worker。清理超时会取消更新，不在辅助程序失效后盲目退出。
- 辅助程序脱离应用运行，等待旧 PID 退出后使用 `renamex_np(RENAME_SWAP)` 原子交换整个 `.app`。正常安装路径始终存在，旧包保留在 `.kiro-update-<事务 ID>/Kiro Account Manager.app`。
- 新版通过 LaunchServices 启动。页面挂载并完成账号加载后，通过受主窗口限制的 IPC 写健康回执；回执绑定随机启动 token、版本、PID 和执行路径。60 秒内未就绪会停止新版、原子恢复旧包并重启。
- 独立监控进程在安装辅助程序中断时启动恢复入口。事务日志和当前实际 bundle 版本共同判断原子交换是否完成，覆盖交换成功但日志尚未更新的情况。若所有进程均被系统终止，下次启动会恢复未完成事务。恢复辅助程序确认就绪前，当前应用保持打开。安装中止时显式取消等待退出的辅助程序，避免普通退出误触发安装。
- 更新失败信息在关于页展示；恢复失败时保留旧包和事务证据，不删除唯一备份。回滚替换的是应用包，不倒退用户业务数据；未来涉及不兼容数据迁移的版本必须另行设计迁移兼容策略。

事务、缓存和开关保存在 Electron userData 的 `app-updates/`。当前保留更新事务及旧包用于恢复/诊断，未自动清理历史事务；多次升级后可在确认成功且无需恢复时清理旧事务及对应的 `.kiro-update-*` 目录。不要在安装进行中清理。

`/Volumes`、App Translocation、无写权限的安装目录或缺少辅助程序时禁用自动安装，提供手动下载。此方案没有移除 quarantine、修改 Gatekeeper 设置或提供 Apple 公证，首次下载/启动仍可能需要用户在系统中允许。

## 发布与密钥

本项目使用独立的 Ed25519 更新私钥，和 Apple 证书无关。当前公钥已加入代码；私钥不进入仓库和安装包。

- 本机私钥：`~/.config/kiro-account-manager/update-signing.pem`（权限 `0600`）。应备份并限制访问；不要打印或提交其内容。
- GitHub Actions Secret：`KIRO_UPDATE_PRIVATE_KEY`，配置于 `lvvvkvv/Kiro-account-manager`。
- `.github/workflows/build.yml` 在 macOS 打包后运行 `scripts/sign-mac-updates.mjs`。缺少私钥、私钥不匹配内置公钥，或缺少任一架构 ZIP 时会失败，不发布无签名更新包。
- 私钥配置不会自动触发发布。通过 GitHub Actions 的 Build & Release 手动执行发布，版本号和 tag 必须一致。
- 不要为每个版本重新生成密钥。已安装应用只信任其内置公钥，变更公钥需要专门的信任迁移方案。

本地签发示例（需先完成两个架构的 ZIP）：

```sh
KIRO_UPDATE_PRIVATE_KEY_FILE="$HOME/.config/kiro-account-manager/update-signing.pem" \
  node scripts/sign-mac-updates.mjs dist
```

发布汇总脚本为 Windows 保留各架构的 `latest-x64.yml`、`latest-ia32.yml`、`latest-arm64.yml`，并保留 x64 的旧 `latest.yml`。同名但内容不同的其他产物会报错，避免静默覆盖。Linux armv7l 另补充更新器使用的清单别名。Windows/Linux 保留 electron-updater 安装后端；Linux 非 AppImage 及便携包提供手动下载。

已有旧客户端需要先安装包含本更新器和公钥的版本。若旧 macOS 的 Squirrel 更新链路不可用，这次过渡需要手动下载安装；以后才能使用新机制。升级验证需要两个递增版本，发布 tag 必须为与 package.json 一致的 `v<版本>`。

## 验证

```sh
npm run test:updater       # 签名、元数据、状态并发、离线/撤回、发布清单
npm run test:updater:mac   # 原生辅助程序实测，需要 macOS 桌面会话
npm run build
node test/updater/ui.mjs  # 用真实组件验证交互，使用隔离 API/数据
```

本次验证环境为 macOS 27.2.1 arm64、Electron 38.7.2；未操作真实账号或正式安装位置。

- 11 项单元/发布工具测试通过：包括验签失败拒绝、签名后元数据约束、版本比较、架构清单保留、签发公私钥一致性、重复操作合并、离线缓存安装、撤回清理、IPC 拒绝和损坏更新缓存不阻断应用启动。
- 原生辅助程序 9 个场景通过：正常升级、错误签名、错误摘要、交换前失败、交换后失败、交换后辅助程序中断（监控进程自动恢复）、新版页面健康超时、新版写入启动记录前卡住、安装取消后普通退出。错误签名/摘要在旧应用退出前被拒绝，取消安装保持旧应用可用，其余失败场景恢复并重启旧版。发布工作流也会在 Intel macOS 上运行这些测试。
- UI 行为测试通过：关于页共享状态、侧栏红点、没有旧更新模态框、下载进度、反代中断提示、按版本“稍后”、新版重新提示、手动下载入口与安装按钮锁定。截图及断言输出在 `dist/updater-ui/`。
- 正式 arm64 `.app` 已实际打包，整包 ad-hoc 签名验证通过；内含 x86_64/arm64 通用辅助程序，安装包排除了测试、脚本及旧 dist 产物。

原生测试报告位于 `dist/native-updater-tests/<运行时间>/report.json`。这些是基于生产安装器源码的隔离测试，使用独立测试 bundle ID，未进行公开 Release 的真实联网升级，也未在 Intel/Windows/Linux 实机运行安装测试。
