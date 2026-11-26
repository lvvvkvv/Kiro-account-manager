# CC Switch UI 改版规划统一复核

日期：2026-11-26（Asia/Shanghai）。复核方式：主模型重新读取总计划、功能清单、六个成员的 proposal／design／tasks 与全部 delta specs，对照已采纳需求和相关源码核对，再执行 OpenSpec 严格校验及静态一致性检查。

## 结论

六个成员的完整规划已就绪，没有尚未解决的规划阻塞。15 个页面、43 项功能保留条目均有归属；17 个能力规格包含 56 条要求。72 个未来实现／验证任务全部未勾选。本轮只新增 `openspec/` 配置、元数据与文档，未修改业务代码、依赖或参考项目。

此结论仅表示规划覆盖与格式检查通过，不代表应用功能或视觉验收通过。未启动应用、未运行构建或功能测试、未调用登录／订阅／证书／Webhook 服务。

## 需求和依赖核对

- 视觉及交互参照 CC Switch 当前 v7：以固定参考提交及真实 Token／组件为依据，避免使用 README 的过时截图作为唯一标准。
- 功能保持：参数、目标集合、校验、确认、取消、默认业务行为、后台生命周期和存储格式均列为等价要求。
- 当前阶段：只初始化、基线、完整规划、统一复核；没有启动 apply、归档或主规格同步。
- 拆分：001 定义公共视觉，002 定义框架，003～006 消费前置；依赖图无环，建议按编号串行。跨领域现有调用没有引入新的接口依赖。
- 归属：TaskCenter／UpdateDialog／CloseConfirmDialog 归 002，ExportDialog 归 003，MCP／Steering 编辑器归 006；领域样式不通过全局强制覆盖处理。
- 技术：保留 Electron、React 19、Tailwind 4、Zustand；不移植 Tauri 拖动属性、Tailwind 3 配置或参考项目业务模型。

## 本轮复核修正

1. **两条配置同步路径分别保留。** 源码中 SettingsPage 内嵌 ConfigSyncCard 使用 type 标识、对象代理池和覆盖恢复；独立 ConfigSyncPage 使用 app 标识、数组／合并、可选脱敏和加密。已补 U10、settings-ui 的内嵌同步要求及独立任务，限制 config-transfer-ui 作用域，禁止合并两条业务路径。
2. **补充两种虚拟化视图。** 除 AccountList 外，AccountGrid 也使用虚拟器与 ResizeObserver 自适应列数。已补基线 A03、浏览场景、设计及滚动／列数验收，防止紧凑布局造成遗漏和重叠。
3. **修正任务控制条件。** 原 UI 按 onPause／onResume 显示对应操作，而活动任务取消并不以 onCancel 是否存在决定可见性。已修正规格和 G06，补完成历史保存／重启／清理要求，不新增运行中任务跨重启续跑。
4. **补充反代安全配置。** P04 明列 IP、限流、亲和、超时、回退端口、指标、TLS、自签证书、审计及 needsRestart 反馈，与 004 的规格和任务对齐。
5. **避免默认主题标识误导。** 保留 default 存储键及全部主题项，001 负责默认橙色映射，006 只让默认选项名称与色板对应实际视觉，避免仍用 Sky Blue 标识橙色。
6. **纠正文档与代码的差异依据。** 注册按实际六模式保留；账号导出不新增 README 注释暗示但实现未提供的通用加密；配置同步不补齐原未导出的键。源码既有缺口不混入 UI 改版修复。

## 功能到规划的追踪

下表的任务编号属于对应成员 tasks.md；“～”表示连续范围。每项只有原业务归属，公共视觉由 001 继承。

| 基线 ID | 主归属 | 规格 | 任务定位 |
|---|---|---|---|
| G01 | 002 | app-shell | 1.1～1.3 |
| G02 | 001、006 | ui-foundations、settings-ui | 001:1.2、2.4；006:1.1～1.2 |
| G03 | 002 | app-shell | 2.1 |
| G04 | 002 | app-shell | 2.2 |
| G05 | 002，关于入口 006 | app-shell、about-ui | 002:2.3；006:4.2 |
| G06 | 002 | app-shell | 2.4 |
| G07 | 002 | app-shell | 4.1 |
| H01～H02 | 002 | home-overview | 3.1～3.2 |
| A01～A02 | 003 | account-management-ui | 3.1、3.5 |
| A03 | 003 | account-management-ui | 1.1～1.2、2.2 |
| A04 | 003 | account-management-ui | 2.1、3.2 |
| A05 | 003 | account-management-ui | 1.2、3.3 |
| A06 | 003 | account-management-ui | 3.4 |
| A07 | 003 | account-management-ui | 2.1、4.1；004／005 消费同一既有数据 |
| P01 | 004 | api-proxy-ui | 1.1 |
| P02～P03 | 004 | api-proxy-ui | 1.2～1.3、1.6 |
| P04 | 004 | api-proxy-ui | 1.4～1.5 |
| P05 | 004 | api-proxy-ui | 1.6 |
| P06 | 004 | kproxy-ui | 2.1～2.2 |
| P07 | 004 | proxy-pool-ui | 3.1～3.2 |
| P08 | 004 | proxy-pool-ui | 3.3 |
| R01～R02 | 005 | registration-ui | 1.1～1.2 |
| R03 | 005 | registration-ui | 2.1～2.2 |
| R04 | 005 | registration-ui | 1.3 |
| R05 | 005 | registration-ui | 2.2～2.3 |
| S01 | 005 | subscription-ui | 3.1 |
| S02 | 005 | subscription-ui | 3.2～3.3 |
| S03 | 005 | subscription-ui | 3.4 |
| S04 | 005 | registration-ui、subscription-ui | 4.1 |
| U01～U02 | 006 | machine-identity-ui | 1.4～1.5 |
| U03 | 006 | kiro-configuration-ui | 2.1～2.2 |
| U04 | 006 | webhook-ui | 2.3 |
| U05 | 006 | diagnostics-ui | 3.1～3.2 |
| U06 | 006 | config-transfer-ui | 3.3～3.4 |
| U07 | 006 | system-logs-ui | 4.1 |
| U08 | 006 | settings-ui | 1.1～1.2 |
| U09 | 006 | about-ui | 4.2 |
| U10 | 006 | settings-ui | 1.3 |

## 校验结果

在仓库根逐个运行 `openspec status --change <成员> --json` 和 `openspec validate <成员> --strict --json`。从 applyRequires 的 tasks 沿 requires 递归确认 proposal、specs、design、tasks 全部存在，没有条件跳过的产物；每个 proposal 列出的 capability 与实际 delta 路径一致。

| Change | 规格文件 | 要求 | 未完成任务 | 严格校验 |
|---|---:|---:|---:|---|
| cc-switch-ui-001-foundations | 1 | 6 | 9 | 通过，无 issues |
| cc-switch-ui-002-shell-home | 2 | 7 | 11 | 通过，无 issues |
| cc-switch-ui-003-accounts | 1 | 7 | 11 | 通过，无 issues |
| cc-switch-ui-004-proxies | 3 | 9 | 13 | 通过，无 issues |
| cc-switch-ui-005-registration-subscription | 2 | 9 | 12 | 通过，无 issues |
| cc-switch-ui-006-settings-utilities | 8 | 18 | 16 | 通过，无 issues |
| 合计 | 17 | 56 | 72 | 6／6 通过 |

静态一致性核对包括：15 个源码 PageType 与总计划逐一对应；43 项基线 ID 在上表全部出现且无未知项；任务编号无重复且全部未勾选；文档相对链接有效；依赖图无环。`git diff --name-only` 为空，新增文件全部位于 `openspec/`。

OpenSpec 的 artifact status `done`／isComplete 在这里表示规划文档齐备，不表示任务已实施。主规格目录目前为空是预期结果：所有新规格仍是活动 change 内的 delta，本轮没有归档或同步。

## 后续验证限制

- 运行基线尚未采集，所有桌面操作与截图待实施前补录；当前只依据静态源码规划。
- Windows／Linux 窗口、系统权限和证书行为需在相应平台实测；本机不能替代其验收。
- 外部登录、真实订阅、Webhook 与服务依赖用受控响应核对交互，再在具备测试环境时记录真实流程结果；本轮未调用。
- 接口 E2E 依赖隔离运行的反代实例，且有写配置用例，不能作为 UI 覆盖证据；未运行 typecheck、lint、build 或业务测试，避免将规划阶段误报为实现验证。

下一阶段可从 001 开始实施；本轮在规划复核完成处结束。
