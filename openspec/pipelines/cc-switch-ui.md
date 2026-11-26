# CC Switch 风格 UI 与交互改版执行计划

- 日期：2026-11-26（Asia/Shanghai）
- 规划根／代码仓库：`/Users/kang/Kiro-account-manager`；应用目录：`Kiro-account-manager/`。
- Schema：`spec-driven`；store：未使用，规划随当前仓库维护。
- 需求：视觉与交互参照 `/Users/kang/cc-switch` 当前 v7；完整保留当前应用功能。初始阶段只完成 OpenSpec 规划；用户后续分别授权实施001、002，结果见执行记录。
- 代码基线：`8f11db50f64cc4faf3f9c0dff8eca543c01cdc15`；起始分支：`main`。
- 参考项目基线：`/Users/kang/cc-switch`，提交 `f29d0804b05ce374ee650c64706399cd0da01805`；不修改参考项目。
- 功能依据：[功能保留清单](../baselines/cc-switch-ui-function-preservation.md)。统一复核记录：[规划复核](../reviews/cc-switch-ui-plan-review.md)。

## 交付与边界

保留 15 个 PageType、全部操作能力、业务参数、校验、确认／取消含义、IPC、后台任务及既有持久化。可调整导航分组、工具栏排列、按钮层级、信息分区、菜单与反馈呈现。Kiro 品牌保留；不引入 CC Switch 的供应商、路由模式等业务。

公共颜色、尺寸和交互外观只由 001 定义；公共页面框架由 002 定义。领域弹窗的内容、关闭条件与业务操作由各领域成员负责。其余成员引用前置规范，不另起主题或窗口系统。

## 成员、依赖与验收

编号是执行顺序；003～006 的硬依赖均为 001、002，跨领域调用只消费现有 API，不互相引入新业务依赖。建议串行实施 001 → 002 → 003 → 004 → 005 → 006，便于逐步回归。

| 成员 | 直接依赖 | 目标范围 | 核心验收 | 规划 | 实现／简化／代码审查 |
|---|---|---|---|---|---|
| [001 foundations](../changes/cc-switch-ui-001-foundations/proposal.md) | 无 | Token、基础组件、公共交互外观 | 中性实色、固定橙色操作；三档外观、中文／英文、账号遮罩与控件契约 | 完整／已复核 | 完成（9/9）／未开始／本地复核及修复完成，DM网络受阻 |
| [002 shell-home](../changes/cc-switch-ui-002-shell-home/proposal.md) | 001 | 窗口框架、导航、首页、任务中心、全局关闭／更新弹窗 | 15 页可达；窗口操作、任务与后台生命周期等价 | 完整／已复核 | 完成（11/11）／未开始／本地复核及修复完成，DM HTTP403受阻 |
| [003 accounts](../changes/cc-switch-ui-003-accounts/proposal.md) | 001、002 | 账号卡片／列表、工具栏、筛选、全部账号弹窗 | 导入导出、选择、切换、分组标签、订阅和绑定入口不丢失 | 完整／已复核 | 未开始／未开始／未开始 |
| [004 proxies](../changes/cc-switch-ui-004-proxies/proposal.md) | 001、002 | API 反代、KProxy、代理池及其弹窗 | 服务配置、证书、API Key、账号绑定、验活和日志保持 | 完整／已复核 | 未开始／未开始／未开始 |
| [005 registration-subscription](../changes/cc-switch-ui-005-registration-subscription/proposal.md) | 001、002 | 注册、批量订阅／超额／订阅管理 | 6 种注册模式与三类订阅工作流、批量生命周期保持 | 完整／已复核 | 未开始／未开始／未开始 |
| [006 settings-utilities](../changes/cc-switch-ui-006-settings-utilities/proposal.md) | 001、002 | 机器码、Kiro 设置、Webhook、诊断、配置同步、系统日志、设置、关于 | 8 页操作、两条配置同步、全部设置兼容；无业务变更 | 完整／已复核 | 未开始／未开始／未开始 |

## 页面归属

| PageType | 成员 |
|---|---|
| home | 002 |
| accounts | 003 |
| proxy、kproxy、proxyPool | 004 |
| register、subscription | 005 |
| machineId、kiroSettings、webhooks、diagnose、configSync、logs、settings、about | 006 |

`layout/TaskCenter.tsx`、`UpdateDialog.tsx`、`CloseConfirmDialog.tsx` 的唯一实施归属是 002；各领域负责原有任务生产与结果呈现。`accounts/ExportDialog.tsx` 的唯一归属是 003，006 的设置导出入口复用它。账号上的订阅入口由 003 保留，订阅页由 005 调整。代理绑定入口在 003、代理池绑定面板在 004，均复用现有 store。`kiro/McpServerEditor.tsx` 和 `SteeringEditor.tsx` 归 006。

006 同时保留 SettingsPage 内嵌 ConfigSyncCard 和独立 ConfigSyncPage；两者格式、键集合、覆盖／合并规则不同，不能为减少重复代码而合并业务。

## 验证与实施约束

1. 实施前按成员清单捕获当前界面与操作结果，使用测试账号／可控样例；先确认基线，再改呈现。不得把现有缺陷修复夹带进本轮 UI 变更。
2. 参考应用的 Token、Sidebar、AppPageHeader、Button、Input、Dialog；保留本项目 React 19、Electron、Tailwind 4、Zustand，不移植 Tauri、Tailwind 3 配置或对方业务状态。
3. 全部页面覆盖浅／深色、跟随系统／浅色／深色、中文／英文、隐私模式；在默认窗口与最小 800×600 检查工具栏、弹窗、滚动和可达性。不新增密度设置，也不改变侧栏初始折叠行为。
4. 未来代码验证在应用目录运行 `npm run typecheck`、`npm run lint`、`npm run build`，记录基线与增量问题；依赖缺失时如实记录，不以规划校验代替运行验证。
5. 已有 `test/e2e-fullsuite` 是需要运行中反代的接口测试，含配置写入用例；只在隔离服务和测试凭据下选择受影响 case。不能把它称为桌面 UI 测试，也不要求为每处纯样式写镜像单测。
6. 每个成员以自己的功能清单与视觉核对验收；全部完成后再统一检查公共样式覆盖、领域交叉入口及事件订阅／任务回调未改变。

## 执行记录

| 阶段 | 状态 | 实际分支 | 本次代码范围 | 验证结果 | 本地补丁 |
|---|---|---|---|---|---|
| 初始化／功能基线／6 个完整规划／统一复核 | 完成 | main（未创建实施分支） | 仅 openspec/ 配置与 Markdown | 严格校验与静态一致性检查见复核记录；未执行功能测试 | 无 |
| 001 foundations 实现 | 完成（9/9） | main（工作区改动） | renderer公共样式／控件，主题和语言生效逻辑；规划引用同步 | typecheck／build／6项OpenSpec校验通过；隔离renderer验证通过；lint遗留371 errors，未新增error。详见001 implementation.md／ui-contract.md | 工作区保留，未提交 |
| 001 公共UI代码审查与修复 | 本地完成，DM网络受阻 | main（工作区改动） | 公共字体／几何与低强调控件修正、参考对照回归 | typecheck／build／renderer回归通过；lint与审查前相同。问题和DM覆盖限制见001 code-review.md | 工作区保留，未提交 |
| 002 shell-home 实现 | 完成（11/11） | main（工作区改动） | renderer外壳、PageHeader、首页、全局关闭／更新弹窗、任务中心；未改main／preload／store | typecheck／build／严格校验、002完整UI、001回归通过；lint371个既有error，无新增；macOS独立原生窗口实测通过，拖动与Windows/Linux原生待测。详见002 implementation.md | 工作区保留，未提交 |
| 002 代码审查与修复 | 本地完成，DM HTTP403受阻 | main（工作区改动） | cn语义Token注册、折叠品牌／提示、PageHeader附加区；实际组件回归 | 3类问题已修复；002完整回归、001回归及build通过，lint无新增error；独立DM覆盖0，详见002 code-review.md | 工作区保留，未提交 |
| 003～006实现及各成员简化、代码审查与修复验证 | 未开始 | 待实施时记录 | 待记录 | 未执行 | 无 |
| 整体集成 | 未开始 | 待记录 | 15 页与交叉入口 | 未执行 | 无 |
| 整体简化／代码审查／修复验证 | 未开始 | 待记录 | 待记录 | 未执行 | 无 |

001 实现完成（9/9），公共UI审查修复已完成；002经用户后续授权实现完成（11/11）。003～006仍未实施。主题／语言／隐私决定见001 implementation.md与ui-contract.md；公共页面框架与平台验证限制见002 implementation.md。
