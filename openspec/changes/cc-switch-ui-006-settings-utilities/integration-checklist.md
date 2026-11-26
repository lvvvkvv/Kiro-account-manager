# Integration Checklist

## Status

006 的整体集成核对按原功能基线逐项记录；“通过”指明确写出的 renderer／结构检查，不表示真实系统、服务或计费操作已执行。001～005 的历史完整运行证据沿用各 change 的实施／审查记录；本次额外复跑 001 参考几何、002 全套、005 全套，并核对 003／004 原处理器结构。

当前 15 页在 800×600、中文／英文、浅／深及隐私启用共 60 组导航检查通过；另测账号选中 → 诊断，两个配置导出路径、设置 → 003 ExportDialog。002 复跑覆盖共享关闭／更新弹窗、TaskCenter、事件订阅；005 复跑覆盖注册账号及订阅链接跨页。账号与代理绑定的存储边界由 003／004 原结构及已有运行记录佐证，未改业务 store。

| ID | 功能范围 | 已测／沿用证据 | 待测及既有边界 |
|---|---|---|---|
| G01 | 15 个 PageType 与 navigate-page 跳转；侧栏展开／收起，初始折叠 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| G02 | 跟随系统／浅色／深色、中文／英文、账号隐私遮罩、用量精度 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| G03 | macOS 红绿灯留位、拖动；Windows/Linux 最小化／最大化／还原／关闭 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | macOS 早前原生验证见 002；本次仅三平台 renderer IPC；原生拖动及 Windows/Linux 仍待测 |
| G04 | 关闭确认的最小化到托盘／退出／取消及记住选择 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| G05 | 更新检查事件、下载进度／错误／重试、下载与安装入口；关于页检查更新 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 不下载或安装真实更新；关于页外链、二维码及查询／重试已测 |
| G06 | 任务中心按已有条件出现、任务排序／进度、按回调显示暂停恢复、活动项取消、取消全部确认、完成历史持久化／移除／清理 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 任务抽屉关闭／切页与历史回读本次 002 复跑；不新增跨进程任务续跑 |
| G07 | 自动刷新、托盘账号同步、防抖批处理、IDE Token 变更订阅、封禁通知、退出前保存 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| H01 | 总数、正常、封禁、即将过期统计；风险摘要与相应跳转 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| H02 | 用量汇总、超额提示、当前账号与快捷操作、版本及外链等已有内容 | 本次 002 完整 renderer 及 001 参考对照复跑通过；[证据](../cc-switch-ui-002-shell-home/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A01 | OIDC／SSO Token／登录三类添加路径；Builder ID、Google、GitHub、IAM SSO，区域、私密登录、验证／轮询／取消、本机凭据加载 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A02 | JSON／CSV／TXT／卡密识别与批量导入、现有分组归属及重复／失败汇总 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A03 | 卡片／列表切换及 accounts_viewMode；搜索、筛选、排序、分组 Tab、选择／全选和结果统计；网格与列表虚拟滚动、网格随容器调整列数 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A04 | 账号详情／编辑、凭据查看复制、隐私显示；IDE／CLI／两者切换目标、刷新信息／Token、登出、删除、解除 suspended 标记 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A05 | 分组／标签增删改及颜色、批量移动／增删标签、刷新／检查／删除的已有范围及确认 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A06 | json、oidc、txt、csv、kami、clipboard 六类导出；有选中导出选中，否则全部；格式预览／复制与原字段 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| A07 | 账号代理绑定／解绑与批量绑定、代理标签；计划选择／订阅链接／订阅管理入口 | 003 原交互记录保留；本次结构核对及 15 页入口复查通过；[证据](../cc-switch-ui-003-accounts/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P01 | API 反代启动停止、状态、host／port／API Key、自启动及现有运行中配置应用方式 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P02 | 单／多账号选择、分组范围、调度策略、耗尽切换；账号同步与用量／请求／积分／Token 统计重置 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P03 | 模型列表刷新、模型映射、客户端配置生成／复制、请求重试／负载大小／端点／工具与 Agent／workspace 等全部现有高级设置 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P04 | API Key 增删改／启停／额度与用量弹窗；IP／外部访问／限流／会话亲和／超时／回退端口／指标、TLS／自签证书／审计及重启提示 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P05 | 请求日志、详细日志、过滤／明细／复制／清理及已有日志保存开关 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P06 | KProxy 初始化／启停／状态、设备 ID 输入与生成、CA 状态／导出／安装／卸载、全部现有配置及请求展示 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P07 | 代理池单条／批量导入、协议和凭据解析、策略、严格代理／失败停用／刷新／上游链、链路诊断、搜索与高级筛选、验活、标签／复制／启停／删除 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| P08 | 代理池账号 N:1 绑定、分配未绑定／重新分配、单条／全部解绑及确认 | 004 原交互记录保留；本次 822 项结构及入口复查通过；[证据](../cc-switch-ui-004-proxies/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| R01 | manual、outlook、tempmail、proton、gptmail、mixed 六种模式，各源凭据／参数、混合启用与权重 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| R02 | 手动初始化／邮箱／OTP／注册阶段、取消、结果导入账号及获取订阅链接 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| R03 | 批量并发、速率／burst／退避、代理 session、风控暂停、失败诊断及分桶重试、停止／暂停／恢复 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| R04 | 每日配额、定时启动／星期掩码、模板保存加载／导入导出、邮箱黑名单／预校验／变体配置 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| R05 | 批次进度、日志、结果／历史、重导入、CSV 导出、分析报表和已有页面切换后的恢复范围 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| S01 | overage、links、manage 三个 Tab 及既有页内状态；方案加载、可升级账号筛选和预检 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| S02 | 链接批量获取／导入、选择／反选／按状态／快捷选取、打开／批量打开、复制／导出、重生成／有效性验证、清理／失败删除和可选同时删除账号 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| S03 | 批量超额启停、已订阅账号管理、管理门户单／批量打开和关闭超额 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| S04 | 注册成功后 appendSubscriptionLink／updateSubscriptionLink 的跨页链路 | 本次 005 完整 renderer、结构与跨页链路复跑通过；[证据](../cc-switch-ui-005-registration-subscription/implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U01 | 机器码读取／复制、随机／自定义更改、原始恢复、文件备份恢复、管理员状态／提权入口 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U02 | 自动随账号切换、绑定／使用绑定码、账号绑定搜索与编辑／随机／删除、历史与清理 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U03 | Kiro 设置读取／刷新／保存／外部打开；Agent／模型、MCP 增删改和用户／工作区配置入口、Steering 新建／编辑／删除／默认规则／外部打开、命令信任／拒绝等现有配置 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U04 | 六种 Webhook 渠道、七类事件、配置／启停／测试／编辑／删除 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U05 | 网络／Kiro／AWS／邮箱／代理等原诊断项、自定义探针／代理选择、运行进度和报告导出；账号单／选中批量存活测试、模型／消息、停止、复测失败、标错／删除失败账号 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U06 | 配置按类别导入导出、代理凭据包含选项、AES-GCM 密码加解密、应用结果与配置重置 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 真实网络／本机系统调用不在 renderer 隔离验证内 |
| U07 | 系统日志级别／分类／时间／文本筛选、数量偏好、轮询、底部跟随／新日志计数、展开明细、导出和清理 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 改前／改后新增条数未显示的既有异常单列；筛选／位置／返回底部／导出清理已测 |
| U08 | 全部设置：外观／隐私／精度／私密登录、自动刷新间隔并发和同步信息、主动续期、API 类型、KProxy 调用、全局代理、自动切换、导入并发、切换目标、托盘、显示窗口快捷键、数据导入导出清理 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 原 autoRefreshSyncInfo 未持久化的行为保留；托盘／快捷键仅 IPC 样例 |
| U09 | 关于页版本、项目／发布外链、更新查询／失败重试、二维码等已有内容 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 不下载或安装真实更新；关于页外链、二维码及查询／重试已测 |
| U10 | 设置页内嵌 ConfigSyncCard 的 JSON 导入导出、COLLECTED_LS_KEYS、原 ID 与代理池恢复、覆盖确认和重启提示 | 本次 006 内存样例交互及结构核对通过；[证据](./implementation.md) | 内嵌配置原样包含代理凭据；保持原 ID／覆盖确认／重启提示，未合并独立格式 |

## Pending External Verification

- 机器码真实写入、文件选择／磁盘备份恢复、管理员提权和 Windows/Linux 系统差异。
- Kiro 实际配置目录、工作区、MCP／Steering 文件保存与外部编辑器。
- 真实 Webhook 网络发送、网络诊断和模型额度调用、外部账号登录、订阅计费、证书与客户端写入。
- 原生托盘／全局快捷键、更新下载安装；反代接口 E2E 仍需隔离实例与测试凭据。

既有业务异常未借 UI 变更扩大修复：日志新增计数样例异常与 autoRefreshSyncInfo 回读缺口见 implementation.md。所有 API 参数、存储键、确认与数据格式由改前结构基线和样例回归共同核对。
