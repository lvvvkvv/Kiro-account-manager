# UI 改版功能保留清单

日期：2026-11-26。依据提交 `8f11db50f64cc4faf3f9c0dff8eca543c01cdc15` 的源码静态核对，尚未启动应用或调用线上服务。下文是改版必须保留的能力与验证方法，不是运行测试通过记录。实现路径均相对仓库根；`R/` 表示 `Kiro-account-manager/src/renderer/src/`。

## 保留口径

- 保留操作能力、目标集合、参数值／默认值、验证规则、确认／取消／重试含义、请求及其结果映射，保留现有存储键与导入导出格式。
- 可改变位置、分组、外观、折叠方式与反馈组件；动作触发时机、已有确认节点和后台副作用必须等价。不得将取消对话框变为取消任务，不得新增自动提交或额外业务步骤。
- 以源码为功能依据，README／截图为辅助资料。现有异常路径也不能在改版中擅自重新定义；发现缺陷另行记录。
- 用户于 2026-11-26 实施阶段更新 G02：主题改为与 CC Switch 一致的跟随系统／浅色／深色，删除多色主题；语言仅中文／英文；保留账号信息遮罩。旧颜色键解析为跟随系统，旧 auto 语言解析为系统对应的中文或英文，其他偏好不重置。
- 每项由对应成员验收，并记录改前／改后操作、输入、结果及截图；当前所有运行验收均为“未执行”。

## 全局与首页（001、002）

| ID | 必须保留 | 源码依据 | 未来验收 |
|---|---|---|---|
| G01 | 15 个 PageType 与 navigate-page 跳转；侧栏展开／收起，初始折叠 | R/App.tsx、components/layout/Sidebar.tsx | 逐页往返、深层跳转、收起后逐项可达 |
| G02 | 跟随系统／浅色／深色、中文／英文、账号隐私遮罩、用量精度 | R/components/pages/SettingsPage.tsx、store/accounts.ts、hooks/useTranslation.ts | 旧配置加载、切换与重启后保持；隐私掩码不回退 |
| G03 | macOS 红绿灯留位、拖动；Windows/Linux 最小化／最大化／还原／关闭 | R/components/layout/TitleBar.tsx；src/main/index.ts | 可用平台实测；其余平台明确待测，不把按钮纳入拖动区 |
| G04 | 关闭确认的最小化到托盘／退出／取消及记住选择 | R/components/CloseConfirmDialog.tsx | 逐分支核对 response 与 rememberChoice，遮罩取消保持 |
| G05 | 更新检查事件、下载进度／错误／重试、下载与安装入口；关于页检查更新 | R/components/UpdateDialog.tsx、pages/AboutPage.tsx | 使用可控事件验证全部展示状态，不实际安装更新 |
| G06 | 任务中心按已有条件出现、任务排序／进度、按回调显示暂停恢复、活动项取消、取消全部确认、完成历史持久化／移除／清理 | R/components/layout/TaskCenter.tsx、store/tasks.ts | 无暂停／恢复回调不显示对应按钮；活动项取消沿原规则；关闭抽屉不停止任务，重启历史不变 |
| G07 | 自动刷新、托盘账号同步、防抖批处理、IDE Token 变更订阅、封禁通知、退出前保存 | R/App.tsx、store/accounts.ts | 改版前后比较订阅次数与触发结果；切页不重复注册或终止任务 |
| H01 | 总数、正常、封禁、即将过期统计；风险摘要与相应跳转 | R/components/pages/HomePage.tsx | 相同样例下统计、阈值和跳转结果一致 |
| H02 | 用量汇总、超额提示、当前账号与快捷操作、版本及外链等已有内容 | R/components/pages/HomePage.tsx | 展示条件、数值精度和全部原操作一致 |

## 账号管理（003）

| ID | 必须保留 | 源码依据 | 未来验收 |
|---|---|---|---|
| A01 | OIDC／SSO Token／登录三类添加路径；Builder ID、Google、GitHub、IAM SSO，区域、私密登录、验证／轮询／取消、本机凭据加载 | R/components/accounts/AddAccountDialog.tsx | 每条路径输入与 API 参数等价；关闭和取消沿原有清理流程 |
| A02 | JSON／CSV／TXT／卡密识别与批量导入、现有分组归属及重复／失败汇总 | R/components/accounts/AccountManager.tsx、AddAccountDialog.tsx | 固定有效／无效／重复样例对比导入条目与分组 |
| A03 | 卡片／列表切换及 accounts_viewMode；搜索、筛选、排序、分组 Tab、选择／全选和结果统计；网格与列表虚拟滚动、网格随容器调整列数 | R/components/accounts/AccountToolbar.tsx、AccountFilter.tsx、AccountGrid.tsx、AccountList.tsx | 筛选组合下目标集合与偏好一致；缩放窗口、侧栏开合与滚动后无遗漏／重叠 |
| A04 | 账号详情／编辑、凭据查看复制、隐私显示；IDE／CLI／两者切换目标、刷新信息／Token、登出、删除、解除 suspended 标记 | R/components/accounts/AccountCard.tsx、AccountListRow.tsx、AccountDetailDialog.tsx、EditAccountDialog.tsx | 两种视图中的动作语义等价；子按钮不误触账号选择 |
| A05 | 分组／标签增删改及颜色、批量移动／增删标签、刷新／检查／删除的已有范围及确认 | R/components/accounts/GroupManageDialog.tsx、TagManageDialog.tsx、AccountToolbar.tsx | 选中子集、全部／当前分组以及取消确认的结果保持 |
| A06 | json、oidc、txt、csv、kami、clipboard 六类导出；有选中导出选中，否则全部；格式预览／复制与原字段 | R/components/accounts/ExportDialog.tsx、AccountManager.tsx | 比较固定样例的语义字段与选择集合，保留文件／剪贴板行为 |
| A07 | 账号代理绑定／解绑与批量绑定、代理标签；计划选择／订阅链接／订阅管理入口 | R/components/accounts/AccountToolbar.tsx、AccountCard.tsx、AccountListRow.tsx | 与 004 的池内绑定结果一致；与 005 的链接行为一致 |

## 代理管理（004）

| ID | 必须保留 | 源码依据 | 未来验收 |
|---|---|---|---|
| P01 | API 反代启动停止、状态、host／port／API Key、自启动及现有运行中配置应用方式 | R/components/proxy/ProxyPanel.tsx | 相同配置传给相同 API；host 变更原有重启时机保持 |
| P02 | 单／多账号选择、分组范围、调度策略、耗尽切换；账号同步与用量／请求／积分／Token 统计重置 | R/components/proxy/ProxyPanel.tsx、AccountSelectDialog.tsx | 账号 ID 集合、统计范围、重置操作一致 |
| P03 | 模型列表刷新、模型映射、客户端配置生成／复制、请求重试／负载大小／端点／工具与 Agent／workspace 等全部现有高级设置 | R/components/proxy/ProxyPanel.tsx、ModelsDialog.tsx、ModelMappingDialog.tsx、ClientConfigDialog.tsx | 逐配置字段比对；模型映射和配置文本输出等价 |
| P04 | API Key 增删改／启停／额度与用量弹窗；IP／外部访问／限流／会话亲和／超时／回退端口／指标、TLS／自签证书／审计及重启提示 | R/components/proxy/ApiKeyManager.tsx、ApiKeyUsageDialog.tsx、ProxySecurityPanel.tsx | 字段、验证、权限、统计、证书操作及原生效／重启方式保持 |
| P05 | 请求日志、详细日志、过滤／明细／复制／清理及已有日志保存开关 | R/components/proxy/ProxyLogsDialog.tsx、ProxyDetailedLogsDialog.tsx、ProxyPanel.tsx | 控制样例下输出和清理范围一致；不与系统日志混为一页 |
| P06 | KProxy 初始化／启停／状态、设备 ID 输入与生成、CA 状态／导出／安装／卸载、全部现有配置及请求展示 | R/components/kproxy/KProxyPanel.tsx、pages/KProxyPage.tsx | 证书和设备动作逐项保留；使用可控测试环境验证系统操作 |
| P07 | 代理池单条／批量导入、协议和凭据解析、策略、严格代理／失败停用／刷新／上游链、链路诊断、搜索与高级筛选、验活、标签／复制／启停／删除 | R/components/pages/ProxyPoolPage.tsx | 同一输入解析、筛选及策略字段等价；批量范围和诊断输出一致 |
| P08 | 代理池账号 N:1 绑定、分配未绑定／重新分配、单条／全部解绑及确认 | R/components/pages/ProxyPoolPage.tsx、store/accounts.ts | 池面板与账号页读到同一 accountProxyBindings，删除代理沿用原联动 |

## 注册与订阅（005）

| ID | 必须保留 | 源码依据 | 未来验收 |
|---|---|---|---|
| R01 | manual、outlook、tempmail、proton、gptmail、mixed 六种模式，各源凭据／参数、混合启用与权重 | R/components/pages/RegisterPage.tsx（RegMode、AutoEmailSource） | 六条路径字段、验证与请求参数保持；不按旧 README 缩成四种 |
| R02 | 手动初始化／邮箱／OTP／注册阶段、取消、结果导入账号及获取订阅链接 | R/components/pages/RegisterPage.tsx（Phase、startManual、importAccount） | 正常、失败、取消的阶段顺序和状态一致 |
| R03 | 批量并发、速率／burst／退避、代理 session、风控暂停、失败诊断及分桶重试、停止／暂停／恢复 | R/components/pages/RegisterPage.tsx、store/rateLimiter.ts | 可控响应对比调度参数、重试集合、停止边界和 task 回调 |
| R04 | 每日配额、定时启动／星期掩码、模板保存加载／导入导出、邮箱黑名单／预校验／变体配置 | R/components/pages/RegisterPage.tsx | 相同配置与时钟条件下触发和跳过结果一致，保持原存储键 |
| R05 | 批次进度、日志、结果／历史、重导入、CSV 导出、分析报表和已有页面切换后的恢复范围 | R/components/pages/RegisterPage.tsx | 页面往返的既有行为不变；不承诺新增跨进程继续执行 |
| S01 | overage、links、manage 三个 Tab 及既有页内状态；方案加载、可升级账号筛选和预检 | R/components/pages/SubscriptionPage.tsx | Tab 可达；同一账号集得到同一目标集合与方案 |
| S02 | 链接批量获取／导入、选择／反选／按状态／快捷选取、打开／批量打开、复制／导出、重生成／有效性验证、清理／失败删除和可选同时删除账号 | R/components/pages/SubscriptionPage.tsx | selected／all 的集合、确认文案对应语义和账号联动保持 |
| S03 | 批量超额启停、已订阅账号管理、管理门户单／批量打开和关闭超额 | R/components/pages/SubscriptionPage.tsx | 原确认与 API 参数保持；结果、失败统计及 task 状态一致 |
| S04 | 注册成功后 appendSubscriptionLink／updateSubscriptionLink 的跨页链路 | R/components/pages/RegisterPage.tsx、SubscriptionPage.tsx | 注册结果在订阅页正确出现，UI 调整不移动业务数据所有权 |

## 设置与辅助页面（006）

| ID | 必须保留 | 源码依据 | 未来验收 |
|---|---|---|---|
| U01 | 机器码读取／复制、随机／自定义更改、原始恢复、文件备份恢复、管理员状态／提权入口 | R/components/pages/MachineIdPage.tsx | 输入验证和原确认保持；可控环境验证读写及返回结果 |
| U02 | 自动随账号切换、绑定／使用绑定码、账号绑定搜索与编辑／随机／删除、历史与清理 | R/components/pages/MachineIdPage.tsx | 配置及绑定不丢失；历史读写一致 |
| U03 | Kiro 设置读取／刷新／保存／外部打开；Agent／模型、MCP 增删改和用户／工作区配置入口、Steering 新建／编辑／删除／默认规则／外部打开、命令信任／拒绝等现有配置 | R/components/pages/KiroSettingsPage.tsx、components/kiro/ | 相同配置保存结构一致；编辑器关闭与保存条件保持 |
| U04 | 六种 Webhook 渠道、七类事件、配置／启停／测试／编辑／删除 | R/components/pages/WebhooksPage.tsx、store/webhooks.ts | 原字段、事件与 test API 保持；本轮不发送测试通知 |
| U05 | 网络／Kiro／AWS／邮箱／代理等原诊断项、自定义探针／代理选择、运行进度和报告导出；账号单／选中批量存活测试、模型／消息、停止、复测失败、标错／删除失败账号 | R/components/pages/DiagnosePage.tsx | 请求参数与批量目标相同；删除确认和账号结果联动保持 |
| U06 | 配置按类别导入导出、代理凭据包含选项、AES-GCM 密码加解密、应用结果与配置重置 | R/components/pages/ConfigSyncPage.tsx | 默认不包含代理密码；按当前实际字段和键比对往返，不扩展敏感数据导出范围 |
| U07 | 系统日志级别／分类／时间／文本筛选、数量偏好、轮询、底部跟随／新日志计数、展开明细、导出和清理 | R/components/pages/LogsPage.tsx | 相同日志样例过滤结果一致；滚动和 systemLogs_displayLimit 保持 |
| U08 | 全部设置：外观／隐私／精度／私密登录、自动刷新间隔并发和同步信息、主动续期、API 类型、KProxy 调用、全局代理、自动切换、导入并发、切换目标、托盘、显示窗口快捷键、数据导入导出清理 | R/components/pages/SettingsPage.tsx、store/accounts.ts | 逐项操作与重启回读；沿用现有校验和应用时机；导出复用 003 |
| U09 | 关于页版本、项目／发布外链、更新查询／失败重试、二维码等已有内容 | R/components/pages/AboutPage.tsx | 外链和更新入口可达；全局 UpdateDialog 仍由 002 管理 |
| U10 | 设置页内嵌 ConfigSyncCard 的 JSON 导入导出、COLLECTED_LS_KEYS、原 ID 与代理池恢复、覆盖确认和重启提示 | R/components/pages/SettingsPage.tsx（ConfigSyncCard） | 保留 type 标识、对象格式代理池与 localStorage 键集合；取消不覆盖，不替换成 U06 的 app 标识／合并／加密流程 |

## 参考风格与实现边界

依据 `/Users/kang/cc-switch/docs/design-system.html`、`src/index.css`、`tailwind.config.cjs`、`src/components/shell/{Sidebar,AppPageHeader}.tsx` 及 `src/components/ui/{button,input,dialog}.tsx`。公共视觉参数的正式约定见 001 的 `ui-foundations` 规格；后续成员不重复定义。

本项目实际采用 React 19、Tailwind 4、Electron、Zustand。README 的技术版本、主题数量与注册模式描述存在滞后：主题按用户最新决定简化，本清单保留源码中的六种注册模式；账号导出没有以代码证明的通用加密入口，不因 README 注释而新增该能力。配置同步的加密能力以 ConfigSyncPage 的实际实现为准，未声明其能导出源码中未包含的所有配置键。设置页内嵌同步 U10 与独立页 U06 是两套现有路径，格式、键集合、覆盖／合并和凭据处理各有差异，本轮不合并或互换。

保留 `src/main/`、`src/preload/`、renderer 的业务 store／调度、API payload、类型与存储格式；领域 TSX 中混合的业务处理也属此边界。今后如为布局拆组件，仅搬移呈现与现有回调连接，不重写这些处理流程。

## 验收方法与限制

1. 基线固定在上述提交；实施时记录截图和动作结果。样例覆盖空数据、正常／封禁／过期账号、部分失败批次、长文本、运行中任务、无权限／服务不可用。
2. 每个领域至少在中文浅色和英文深色完成完整流程；全部页面补查另外两种语言／明暗组合，三档外观、隐私开关，窗口 1200×1200 与最小 800×600。跨平台窗口能力仅将实测平台标为通过。
3. 依据现有生命周期比较切页、关闭弹窗、最小化、重启后的状态；不把原本只在内存中保存的状态升级为永久保存。
4. 未来运行 `npm run typecheck`、`npm run lint`、`npm run build`；已有接口 E2E 需隔离反代实例及测试凭据，且不覆盖 UI。外部登录、证书安装、真实订阅等依赖只在可控测试环境验证，未具备环境的项保持待测，不伪称通过。
5. 本轮只校验规划完整性和 OpenSpec 格式；全部功能验收留待实施。记录不包含账号凭据、真实 Token 或代理密码。

001 的授权例外：仅调整 store 中外观与语言的解析／生效逻辑，沿用持久化字段结构；不实施请求正文隐私过滤。
