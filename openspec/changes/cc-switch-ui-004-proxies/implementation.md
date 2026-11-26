# 004 代理界面实施记录

日期：2026-11-26（Asia/Shanghai）。变更：`cc-switch-ui-004-proxies`。用户已授权实施，范围为 API 反代、KProxy、代理池及其既有弹窗。

## Reference

固定参考 `/Users/kang/cc-switch` 的 `f29d0804b05ce374ee650c64706399cd0da01805`，直接读取其 Button／Input／Dialog 与 `docs/design-system.html`，使用 [001 公共 UI 契约](../cc-switch-ui-001-foundations/ui-contract.md) 和 002 的 PageHeader。保留本项目服务和数据模型。

改前源码保存在 `/tmp/cc-proxies-20261126/before/`，改前三页隔离 renderer 截图在 `before-ui/`；业务结构指纹固化于本变更 `verification/business-contract.json`，由改前文件生成。最终核对 816 项命名处理器、Hook、IPC 和 JSX 业务属性；格式化产生的 JSX 空格表达式作等价规范化，保留正则及字符串内容，不排除业务事件、值或禁用条件。

## UI

- 三页共用 52px PageHeader，标题 18/26、600；内容横向24px，分节28px，面板内距16px。去除彩色 hero、渐变和装饰光晕。
- 分节15/22、600，弹窗16/24、600，正文13/20，辅助12/18，徽标11/16、20高、左右7；输入／选择32高、圆角6。开关沿用30×18公共组件，移除缩放覆盖。按钮沿用32／28高、图文间距6、图标16。
- 面板圆角10，弹窗14；弹窗头20/24/12、正文左右24、底部12/24/20。正文独立滚动；映射与客户端配置的原操作区移出滚动正文，取消／保存等条件不变。
- 账号选择默认512px；模型和客户端配置672px；映射及密钥管理768px；请求日志／密钥用量896px；详细日志1120px。均限制为视口减32，最高90dvh或视口减32。宽度随信息密度扩展，不扩展公共默认值。
- 调度／范围使用28高的中性分段控件；用量三页签使用36高、间距20的下划线页签。客户端选择卡采用中性选中底，保留勾选状态；模型 Token 数值避免拆行。
- 详细日志菜单使用4px内衬、30px最小行高和6px行圆角；按钮不再只在 hover 出现。请求错误详情在原单元格中展开，允许滚动查看，避免绝对浮层被正文裁切。
- 代理表格保留全部列和四个操作；内容最小1120px并独立横向滚动。行高与虚拟估值同步为58px，操作28方、间距8、图标16。50条以上虚拟列表保留 useVirtualizer，并给予明确的60vh滚动高度；61条样例可达末项，无重叠。
- 代理状态徽标按已有中文／英文字段展示；账号隐私设置、主题及语言偏好没有变更。

## Field application contract

以下是原来已有的更新方式；没有引入统一保存或自动重启。

| 区域 | 原字段／目标 | 保留的触发与参数 |
|---|---|---|
| 基础 | port、host、apiKey | onChange 原转换后调用 proxyUpdateConfig；运行时原禁用状态保持 |
| 外网 | host=0.0.0.0／127.0.0.1 | 原开关即时更新；运行中仍 stop → 200ms → start，无额外 restart |
| 自动与日志 | autoStart、logRequests、logStreamEvents | 原开关即时调用；日志保存沿用2秒防抖 |
| 账号模式 | enableMultiAccount、selectedAccountIds、autoSwitchOnQuotaExhausted | 模式禁用条件、单账号数组格式和自动切换语义保持 |
| 调度／分组 | accountSelectionStrategy、multiAccountSelectionMode、multiAccountGroupIds | 原状态写入与即时 syncAccounts override 保持；仅 active 且有 accessToken 的账号参与，分组／未分组规则不变 |
| 高级请求 | preferredEndpoint、maxRetries、payloadSizeLimitKB、clientDrivenToolExecution、disableTools、enableTokenBufferReserve、tokenBufferReserve、agentMode | 原值、默认回退、范围和即时提交保持；没有修正原 `value || default` 对0的处理 |
| 工作区 | workspacePath | onChange 只更新本地，onBlur 提交空值转 undefined |
| 安全数值 | maxRequestBodyBytes、rateLimitPerKeyPerMinute、recentRequestsLimit、keepAliveTimeoutMs、fallbackPort | 原MB／秒换算、默认回退及运行中禁用条件保持 |
| IP规则 | allowedIPs、deniedIPs | 原本地文本状态；失焦按行trim并过滤空行后提交 |
| 安全开关 | allowExternalWithoutApiKey、sessionAffinityEnabled、enableMetrics、enableAuditLog | 原可见／禁用条件及即时更新保持 |
| TLS／审计 | 自签信息、下载／复制／重生成、审计读取、needsRestart | 原API、确认、轮询5秒和清理保持；重生成成功仍提示重启，失败反馈保持；没有新增证书自动安装或服务重启 |
| KProxy | port、host、logRequests、autoStart、deviceId | 原updateConfig合并与API更新；设备ID满64位才设置，生成仍先更新再设置；CA动作只在点击时调用 |
| 代理池 | enabled、strategy、autoDisableDead、failureThreshold、testUrl、autoValidateIntervalMin、autoValidateConcurrency、upstreamProxy | 原store字段、校验及持久化保持；周期检查仍每分钟，选取原enabled目标；验活仍带testTimeoutMs和upstreamProxy |

`headersTimeoutMs`、TLS路径等仅有类型／后台能力而未出现在原页面的字段，没有擅自新增表单。严格代理配置的原入口位于设置领域；保留store与调用路径，本成员不搬移006控件。代理池验活原来直接执行store方法，没有任务中心生产器，本次不新增任务或取消语义。

## Function preservation

| ID | 核对／模拟回归结果 |
|---|---|
| P01 | 端口／监听／Key／自启动、启停载荷、运行时禁用、复制localhost地址、外网开关原重启时机通过 |
| P02 | 单账号选择、分组目标、粘滞策略、启用分组即时同步、自动耗尽切换通过；原集合签名、防抖与模块级响应订阅结构相同 |
| P03 | 端点、重试、负载、工具、Token Buffer、Agent、工作区失焦提交通过；模型读取／刷新、负载均衡映射的目标与权重、客户端模型元数据及五个选中目标通过。当前客户端弹窗原行为是调用主进程写入配置，不存在renderer配置文本生成／复制功能；测试只断言原IPC载荷和结果，不伪称验证磁盘文本 |
| P04 | 密钥名称／格式／额度创建，显示／复制／启停，额度修改，删除与重置取消／确认、历史／模型／每日用量通过；安全字段转换、IP失焦、证书重生成取消／成功、重启取消／失败／成功及审计展示通过 |
| P05 | 请求日志错误展开、Token与积分分别重置、请求日志清空仅proxySaveLogs([])；详细日志展开／复制／搜索／清空仅proxyClearLogs通过。统计及导出处理器与原指纹相同，未合并系统日志范围 |
| P06 | 初始化、启停成功／失败、请求状态、设备短值不设置／64位设置／随机生成／复制、CA安装权限失败／成功／卸载／导出通过；往返页面不额外启动，模块级请求订阅数量不增加；未调用真实系统证书操作 |
| P07 | HTTP、HTTPS、SOCKS5、SOCKS4及host:port:user:pass、重复／无效／注释批量输入通过；URL原文复制、标签编辑、启停、文本／协议筛选，单项／选中／当前过滤全部验活目标通过；四种策略、链路诊断参数／结果、无可用代理反馈、取消／确认删除、61条虚拟滚动通过 |
| P08 | 自动分配未绑定／全部重分配、单项解绑、全部解绑取消／确认，共用 accountProxyBindings；实际切到账号页核对同一代理徽标、返回代理池核对绑定并解绑通过（pool-final.log）；删除代理联动的原store未修改 |

816项源码结构比较支持其余原分支的保留，不将静态比较计作真实网络或系统操作测试。

## Validation

运行入口：`verification.mjs`，阶段：`proxy`、`kproxy`、`pool`、`geometry`。使用本机 Playwright 和 Chrome，真实renderer／Zustand配合内存IPC。全部样例均为虚构凭据与example.invalid；不打开真实登录、不启动监听、不写客户端配置文件、不安装证书。

```sh
PLAYWRIGHT_MODULE=/Users/kang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs \
UI_CHECK_OUTPUT=/tmp/cc-proxies-20261126/final \
node openspec/changes/cc-switch-ui-004-proxies/verification.mjs
```

最终结果及截图位于 `/tmp/cc-proxies-20261126/`：

- `final-ui.log`、`final/geometry.json`及补充`geometry-final.log`／`geometry-final/geometry.json`：完整004回归及中文／英文×明／暗×800×600／1200×1200三页和全部八类弹窗；逐项校验页头、字体、字段高度、徽标、开关、弹窗边界，并核对跟随系统外观；补充逐项核对面板10px圆角、分节15/22、按钮28／32与6px图文间距、弹窗头尾内距。
- `foundations.log`：001字体角色、圆角、分段／页签／设置行／弹窗的CC Switch直接几何对照及外观迁移回归通过。
- `build-final.log`：`npm run build`（包含node／web typecheck）通过。
- `lint-final.log`、`lint-comparison.json`：既有371 errors保持，无新增error；warnings由8860降至7779，主要为本次格式化。
- `git diff --check`及OpenSpec严格校验通过。

## Limits

真实模型请求／鉴权／配置接口E2E待测。现有入口 `test/e2e-fullsuite/run.mjs` 默认8787，且含配置写入；本会话未提供可确认的隔离实例，ZS_BASE／ZS_TOKEN均未设置，未尝试复用本机未知服务。待隔离环境具备后，可选择 `17-auth-missing-token`、`18-auth-wrong-token`、`20-unknown-model`、`23-models-list`、`30-admin-config-apikeys`；不能把本轮内存IPC回归视作这些接口case通过。

真实CA安装／卸载权限、证书文件导出、客户端配置合并／备份／写入待隔离系统验证。保留现有main／preload／store／类型／依赖／持久化，未更改网络、证书或调度业务实现。

## Code review follow-up

同日完成本地代码审查及修复：长日志分类撑出弹窗、账号选择行字号／圆角／内距、映射原生选择框纵向内衬与操作间距、绑定指标／徽标字重／表头对齐、KProxy通知条。新增review边界回归并将业务结构守卫补全至822项；原配置时机、IPC、选择／确认／取消、订阅与store不变。具体证据、验证和DM HTTP403覆盖限制见[code-review.md](./code-review.md)。
