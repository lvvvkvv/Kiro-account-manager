# Implementation

日期：2026-11-26（Asia/Shanghai）。用户已授权实施本成员；006 尚未实施，未归档或提交本次改动。

## Scope

- 仅迁移 `src/renderer/src/components/pages/RegisterPage.tsx` 与 `SubscriptionPage.tsx` 的领域呈现，并增加本成员隔离验证资料。
- 改前两页保存于 `/tmp/cc-registration-20261126/before/pages/`，内容对应实施前仓库版本；实施过程中仓库 HEAD 前进至 `f5553c2`（004 提交），两页的原业务基线没有改变。
- 参考 `/Users/kang/cc-switch` 固定提交 `f29d0804b05ce374ee650c64706399cd0da01805`，引用 [001 公共 UI 契约](../cc-switch-ui-001-foundations/ui-contract.md) 与 002 `PageHeader`。未修改参考仓库、main、preload、store、类型、依赖、注册实现或计费服务。

## UI

| 区域 | 实施结果 |
|---|---|
| 两页框架 | 统一 PageHeader：52 高，标题 18/26/600；内容左右 24、上 16、分区之间 28；移除大尺寸装饰页头和渐变光斑 |
| 字体 | 正文 13/20、辅助 12/18、分节 15/22/600、弹窗 16/24/600、指标 24/32/600；沿用参考系统字体栈；原图表计算、坐标与数据含义保留 |
| 模式／工作流选择 | 注册六模式、订阅三 Tab 统一 36 高分段控件；中性选中态，外圆角 10、内圆角 7；仍调用原 setMode／setActiveTab，默认 manual／overage 不变 |
| 表单／操作 | 单行 32 高、圆角 6、左右 10、正文 13；多行按原 rows 扩展；常规／紧凑按钮 32／28，原生勾选框 16 方／圆角 4，方案选择卡最低 58／圆角 10，图标 16、图文 6、操作间距 8；移除叠加图标 margin；开关 30×18 |
| 面板／徽标／菜单 | 面板圆角 10、内距 16；徽标 20 高、左右 7、11/16/500；模板菜单复用公共菜单内距与菜单行，长名称截断、窗口内可滚动；状态采用既有中性／成功／警告／危险 Token |
| 手动阶段／日志／诊断 | 原动态 6～8 步和当前阶段判断保留；步骤区自行横滚，长日志和错误可换行；步骤、耗时、出口 IP、原始错误、原因和建议均保留 |
| 结果／历史／分析 | 保留结果凭据、导入、历史指纹完整 title、重导入及 CSV、圆环／小时／7 日／分类报表；指标统一尺度；长字段与指纹徽标限制宽度以保持操作可达 |
| 订阅列表 | 原固定列与邮箱弹性列保留，表头上下 8、左右 10，行上下 9、左右 10；局部最小宽 640 并独立横滚；勾选、状态、目标和动作保持 |
| 管理虚拟列表 | 原 50 行阈值及 overscan 10 不变；修正 strict containment 下仅 max-height 导致视口高度为 0 的呈现缺陷；大列表明确 60vh，实际行与 estimate 同为 47（28 高按钮＋上下 9＋边框 1）；61 行样例可滚到末行并打开其门户 |
| 链接导入弹窗 | 宽 672 且不超过视口减 32；圆角 14；头部 20/24/12、正文左右 24 独立滚动、底部 12/24/20、按钮间距 8；原遮罩取消、文字缓存、确认与导入回调不变 |

## Preservation

`verification/business-contract.json` 从改前副本生成，冻结 602 项结构，包括模块初值／存储键、状态及副作用 Hook、命名处理器、非呈现函数、IPC、输入值／范围／禁用状态与事件连接。其中 601 项保持，1 项表单清理修复单独校验前后哈希（`behavior-fixes.json`）：模板文件异步读取后，`event.currentTarget` 已清空，原代码重置文件框会抛异常；改用稳定的 `event.target.value = ''`，保留清空文件框这一原操作。改前隔离回归已复现异常，改后实际导入、ID 去重、文件优先覆盖和清空均验证，未改导入字段或扩大配置同步范围。

| ID | 运行核对与结构证据 |
|---|---|
| R01 | 六模式可达；Outlook／TempMail／Proton／GPTmail 的原请求字段、私有密码和域名值；混合源启用、权重键与批量原选择逻辑；输入与 disabled 属性均与改前对照 |
| R02 | 初始化失败回到原入口；初始化→邮箱→空 OTP 不提交→OTP→结果→手动导入；预填母邮箱仍按原流程自动提交邮箱；自动导入后原计划生成链接；取消仍调用 registrationCancel |
| R03 | 数量／间隔／并发／重试和导入／链接选项保持；暂停阻止新任务但允许在途完成，任务中心恢复／取消、关闭抽屉、暂停后停止均实测；限速 300／burst 3／退避 1～2 秒配置、风控立即暂停与恢复、自动重试及每次新代理 session／上游／strictProxy 参数实测 |
| R04 | 模板保存／加载／JSON 导出／文件导入、按 ID 去重且文件优先；原每日配额和星期掩码键保持，不符合星期即使时间匹配也不启动；匹配时间及星期时启动一次并按成功数累计每日配额；配额已满在 IPC 之前阻止启动；混合权重、匿名变体、黑名单与预校验计算及原持久化范围由结构核对冻结 |
| R05 | 固定批次的成功／网络失败／邮箱占用失败计数、诊断展开、仅网络类别重试、黑名单写入；5 条历史触发报表，CSV 表头固定为 time,email,status,error,password；切页期间 log／step 单例订阅保持，历史保存、实际重导入、黑名单搜索与单条移除通过 |
| S01 | 原 overage 默认 Tab；固定 7 账号预检 2 可用／5 阻止；方案默认 Pro；原获取集合仍为 free-a／free-b／banned／cant，未把预检结果擅自替换为获取过滤规则；三个 Tab 与页面往返保持 |
| S02 | 获取／导入／取消导入／URL 去重；全选／反选／清空／状态加选／Top／Next；单个复制、selected／all 的打开和导出集合；HEAD 验证及再生成原参数；删除取消／默认不删账号／显式联动仅删匹配账号；删除选中继续只删链接 |
| S03 | 超额允许集合、全部设置、成功／失败结果、原并发；单个与批量门户、selected 目标、确认取消及批量关闭超额；61 行虚拟化末行操作。原订阅页没有任务中心生产器，本次未添加新任务或确认节点 |
| S04 | 手动成功自动导入账号、appendSubscriptionLink 后 updateSubscriptionLink 完成链接、订阅页可见；回到注册页结果仍在。所有模块状态、refs、任务回调和存储键保留原位置 |

注册的 isPaused 仍为原组件局部状态；切页后的显示和停止边界沿原实现，未新增跨进程恢复。任务中心使用原批次回调；回归分别验证不切页的暂停后停止，以及切页后的任务中心恢复／取消，未以布局变更重写调度器。

## Validation

证据目录：`/tmp/cc-registration-20261126/`。测试均使用 headless Chrome 与内存 IPC 样例（example.invalid／192.0.2.x／fake 凭据），未访问真实注册、邮件、订阅或代理服务。

- `verification.mjs`：真实 App 与领域组件；`final-complete/` 为最终完整回归、80 组几何及展开侧栏／长菜单截图，`registration-final/`、`subscription-final/` 为前期补充流程。运行命令：

```sh
PLAYWRIGHT_MODULE=/Users/kang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs \
UI_CHECK_OUTPUT=/tmp/cc-registration-20261126/final-complete \
node openspec/changes/cc-switch-ui-005-registration-subscription/verification.mjs
```

- `final-complete/geometry.json`：6 注册模式＋3 订阅 Tab＋导入弹窗，中文／英文×浅／深色×800×600／1200×1200，共 80 组实测与截图；检查字体、字号／行高、圆角、控件／开关／徽标高度、按钮图文间距、弹窗头尾内距及视口边界；跟随系统外观切换通过。`before-geometry/` 同组改前截图可比较。
- `before-runtime.log`：改前注册流程对照，单独记录已存在的模板导入文件框异常；`before-subscription/` 对照原订阅调用，记录原大列表高度为 0。
- `foundations/geometry-metrics.json`：001 直接读取固定 CC Switch 提交，八种字体角色、字体栈、圆角、设置行、分段、页签与弹窗明暗对照通过；外观迁移、隐私与精度保持通过。
- `npm run build`：node／web typecheck、main／preload／renderer 构建通过。独立 `npm run typecheck` 亦通过。
- `npm run lint`：371 errors、6549 warnings。按文件＋规则／错误内容与 004 基线逐项比对，371 个 error 全部既有，无新增 error；格式化降低 warning，未顺带修复既有业务 lint 问题。
- `final-complete/compact.json`：800×600 展开侧栏，六模式、三 Tab、长模板菜单的边界与可达性补查。
- `git diff --check` 通过；OpenSpec 六个 change 严格校验通过；最终 apply 返回 all_done，12/12。

## Limits

- 真实 AWS／Kiro 注册、外部邮箱取码与 Proton 登录、真实账号验活、订阅链接／超额／门户的服务端结果尚待测试账号与隔离环境。本次运行验证覆盖 renderer 调用、参数、目标集合、状态转换和可控成功／失败响应，不把它称为真实外部端到端通过。
- 既有接口 E2E 需要隔离反代实例及凭据，未对未知本地服务执行写配置用例。
- 语言仍仅中文／英文；原有诊断／日志中的中文未改翻译逻辑。两页原本不消费账号 privacyMode，未新增或移除遮罩规则；001 既有账号隐私功能保持。

## Code Review Follow-up

用户后续授权审查。已修复混合源按钮 38→32 高、左右 14／图文 6 的尺度；长订阅方案徽标改为 20px 单行截断并保留完整 title；模板菜单改用只处理几何的 TemplateMenu，在视口上下定位、滚动／缩放和保存模板插入日志后保持可操作。原业务结构 602 项继续通过，未新增业务哈希例外；本地完整回归、参考几何和构建通过。独立 DM 审查因 HTTP403 无有效覆盖，问题、证据及限制见 [code-review.md](code-review.md)。
