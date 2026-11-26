# Implementation

## Scope

使用变更 `cc-switch-ui-006-settings-utilities`，参考本地 CC Switch 固定提交 `f29d0804b05ce374ee650c64706399cd0da01805` 及 001/ui-contract.md。改前 HEAD 为 `c1cc5eb`，分支 `codex/cc-switch-ui`；005 已由用户提交，本次仅更改八页及两个领域编辑器的呈现，工作区保留。

## UI Contract

- 八页接入 PageHeader：标题 18/26/600，常规页头最低 52；内容左右 24、顶部 16、分节 28。
- 设置和 Kiro 分节标题在面板外，15/22/600；面板圆角 10、内容 16；设置行最低 52、上下 12、图文／控件间距 16。
- 正文 13/20，说明 12/18，指标 24/32；常规／紧凑按钮 32/28，图标 16、图文间距 6；原生输入 32、左右 10、圆角 6。
- 移除英雄区、渐变、光晕和装饰浮动；保留品牌图片、二维码及领域状态语义。主题只保留系统／浅／深、语言只保留中英文；账号遮罩沿 001。
- 机器码绑定／历史、MCP／Steering、关于查询／二维码弹窗统一圆角 14、头部 20/24/12、正文左右 24，正文滚动和窗口边界受控。既有宽编辑器继续允许宽布局。
- 日志容器 ref、1500ms 轮询、虚拟滚动估算和动态测量、明细、离底部计数保留；筛选工具允许换行。注册／订阅及其他前序页面不做业务修改。

## Preserved Behavior

`verification/business-contract.json` 从改前十个文件捕获 **639** 项模块初值、Hook、IPC、命名处理器和 JSX 业务属性，改后逐项比较，不为本次变更添加业务例外。字号、className、style、title、aria 等呈现不参与业务指纹。真实 renderer 的固定样例交互另外验证接线和结果。

| 设置范围 | 原生效方式与兼容边界 |
|---|---|
| theme／language／privacyMode／usagePrecision／loginPrivateMode／switchTarget | 原 store setter 即时；外观三档、语言两种；不新增迁移逻辑 |
| autoRefreshEnabled／interval／concurrency／syncInfo | 各原 setter 即时，间隔下拉值和并发 1～500 保持；手动触发原回调 |
| proactiveRenewalEnabled／leadMinutes | 原主进程 IPC 成功后镜像，不改提前分钟或调度 |
| usageApiType／useKProxyForApi | 原加载和 IPC 即时应用，原禁用／加载条件保留 |
| proxyEnabled／proxyUrl | 输入保留 tempProxyUrl 草稿；原启用动作或“保存”提交，不能打字即提交 |
| autoSwitchEnabled／threshold／interval／batchImportConcurrency | 原 setter 即时；阈值、间隔、并发范围和定时器保持 |
| 托盘／显示主窗口快捷键 | 原字段加载、按项 IPC；快捷键录制／清空／错误保持，不新增按键绑定 |
| 账号导入／导出／清理 | JSON 导入，复用 003 ExportDialog；清理原两次确认 |
| 内嵌 ConfigSyncCard | `type: kiro-account-manager-config`、对象代理池、原 ID、COLLECTED_LS_KEYS；确认后覆盖及重启提示 |
| 独立 ConfigSyncPage | `app: kiro-account-manager`、数组代理池、脱敏／包含凭据选项、REGISTER_LS_KEYS、追加／合并计数、KCFG1/AES-GCM；不复用内嵌解析 |

已确认的原有限制：日志固定样例在改前与改后追加第 101 条时均保持 scrollTop=0、显示 Scrolled up，但浮动按钮仍为 Bottom，新增条数没有出现；不在本次 UI 范围改写原轮询／计数／滚动算法。证据见 `/tmp/cc-utilities-20261126/{before-render,after-render}/baseline-log.json`。另有：store 的 `autoRefreshSyncInfo` 未进入原保存／读取字段，重载恢复为 true；原始机器码首次读取即备份当前值，不能假设它从账号载荷读取。均不借本次 UI 改版修改。原生 macOS Chromium 的 select 计算 line-height 为 normal，输入仍为 20px；选择器的字体 13、外高 32 和圆角 6 固定，平台内部文字布局沿浏览器原行为。

## Verification

所有 IPC、通知 fetch、账号、文件内容、机器码仅使用内存样例；不读取用户凭据、不写真实系统、不发送外部通知、不消耗真实模型额度。


| 验证 | 结果及证据 |
|---|---|
| 改前十文件 → 当前十文件 | 639 项结构全部相同，无新增业务例外；business-contract.json / source-contract.mjs |
| U01／U02／U08／U10 | 设置即时／显式应用、代理草稿、并发／阈值／间隔、偏好重载、两次清理确认、账号 JSON 导入、内嵌同步覆盖取消与原 ID；机器码读取复制／随机／自定义／原始及文件恢复、三项联动、绑定编辑取消／保存／随机／删除、历史清理、管理员入口；settings.mjs |
| U03 | Agent 开关与命令／工具变更显式保存；MCP 创建／更新／取消／删除、参数／环境；用户／工作区配置打开；Steering 读写、修改关闭确认、默认创建和删除；tools.mjs / remainder.mjs |
| U04 | 六渠道／七事件保存，Telegram chat ID／自定义模板、启停、编辑取消、删除确认／取消；内存 fetch 检查六个 POST，页面切换不发送；用受控 store 结果验证失败反馈；tools.mjs / remainder.mjs |
| U05 | 9 个目标按 4/4/1 调用；直连／指定代理、自定义 URL、失败与报告；单账号模型／消息／绑定代理、选中子集、并发上限 3／停止阻止第四个、单条／失败复测、标错及删除确认取消；tools.mjs |
| U06 | 默认数组格式脱敏／凭据开关、原 app 标识与无账号凭据、明文导入、KCFG1 加密导出／正确密码／错误密码／取消；重置精确原 7+2 键，保留 register-config 和账号；tools.mjs |
| U07 | 级别／分类／时间／文本组合、数量持久化、明细、当前过滤集合导出、1500ms 轮询与阅读位置／返回底部／清理；新增计数异常有改前／改后对照，未宣称修复；tools.mjs / baseline.mjs |
| U09 | 版本、原项目外链、支付与群二维码；不自动检查，失败／重试、新版本信息、发布页打开；不触发全局下载安装；tools.mjs / remainder.mjs |
| 八页语言／明暗／窗口 | 64 组，800×600 和 1200×1200；标题字体、控件 32/6/13、设置行间距、溢出和系统外观；final-geometry/geometry.json |
| 六类弹窗 | 24 组，中文／英文 × 明暗，800×600；绑定、历史、MCP、Steering、查询、群二维码的 14px 圆角、16px 标题、头部 20/24/12、视口边界；final-dialogs/dialogs.json |
| 15 页交叉入口 | 60 组，中文／英文 × 明暗 × 隐私开启；账号选中 → 诊断保留目标且不自动测活；改页不触发系统写入、代理启动、模型消耗；integration.mjs |
| 001 参考对照复跑 | 三档外观／旧配置／保存重载及字体、设置行、分段、页签、弹窗几何与真实本地 CC Switch 一致；foundation.log / foundation/geometry-metrics.json |
| 002 完整复跑 | G01～G07、H01／H02、共享关闭／更新弹窗、任务中心、事件订阅／批处理保持；shell.log |
| 003／004 | 本次额外核对原业务结构，003 全部相同、004 822 项相同；原完整交互记录沿用已完成成员，不冒称本次重新运行全部两套交互 |
| 005 完整复跑 | 602 项结构、R01～R05、S01～S04、80 组几何、窄窗口展开侧栏及审查修复专项；registration.log |
| typecheck／build | npm run build 包含 node／web typecheck，main／preload／renderer 构建通过；build.log |
| lint | 改前／改后均 371 errors，按文件／规则／消息多重集比较无新增；warnings 6549 → 5472；lint-comparison.json |

所有运行证据目录：`/tmp/cc-utilities-20261126/`。完整复跑命令：

```sh
PLAYWRIGHT_MODULE=/Users/kang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs UI_CHECK_OUTPUT=/tmp/cc-utilities-20261126/final node openspec/changes/cc-switch-ui-006-settings-utilities/verification.mjs
```

改前页面截图：before-render/baseline-*.png；改后八页各语言／明暗／尺寸：final-geometry/*.png；六类弹窗：final-dialogs/*.png；15 页全局入口：final/integration-*.png。仅样例数据。旧版截图由保存的改前源码在同一隔离 renderer 渲染，未回退工作区。

## Integration

[43 项功能基线核对表](./integration-checklist.md) 分别记录当前复跑、此前运行记录与外部待测。所有原参数、确认和格式保持，不改变 main、preload、store、API 类型、依赖或 CC Switch 参考仓库。

真实系统机器码、提权、文件对话框与 Kiro 配置目录写入、原生托盘／快捷键、Windows/Linux 原生窗口、外部 Webhook／网络／模型调用、真实登录及计费、证书与更新安装仍待隔离平台环境验证。应用原业务遗留问题不作为本次 UI 功能新增或修复项。


## Final UI QA

最终视觉复查补齐三项呈现细节：弹窗仅由公共 overlay 着色一次（原点击遮罩的关闭回调仍在透明命中层）；Kiro 设置行改为与设置页相同的 12/16 间距；日志分类、Kiro 数量、技术栈及 HTTP 状态统一为 20 高、11/16 字体、左右 7、胶囊圆角。日志搜索框使用公共 Input 的原尺寸，并在 cn 合并后保留左右 32px 的图标空间，避免图标覆盖文本。`final-dialogs.log` 与 `final-badges.log`（100 项徽标及搜索图标内距）单列专项，`final-tools.log` 在这些呈现修正后复跑领域交互。

OpenSpec 严格校验 6/6 通过；006 apply 状态 all_done，16/16。没有提交、暂存或归档本变更。


## Code Review Follow-up

[本地代码审查与修复](./code-review.md) 单列四类问题：Kiro 长配置撑宽／操作移出视口、组合验证的 localStorage 阶段污染、图标按钮尺寸／圆角／命名，以及 Kiro 分组双分隔线。前后可复现证据在 `/tmp/cc-utilities-review-20261126/`；图标改为 32×32／圆角 6、操作组间距 8，长文本完整换行且操作固定在行内，分隔线只保留 1px。

639 项原业务结构继续保持；另对十文件全部非 JSX 业务语句／配置声明与 HEAD 比较均等价。完整 renderer、页面／弹窗／跨页及专项、参考几何和构建完成复核；测试阶段边界清理只作用于隔离 context，各阶段内的持久化与导入回归保持。独立 DM 审查因 HTTP403 鉴权失败，覆盖 0/22，不能视为通过；详情见 code-review.md。
