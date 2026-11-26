# 003 账号界面实施记录

日期：2026-11-26（Asia/Shanghai）。用户授权继续实施 `cc-switch-ui-003-accounts`，要求字体、间距、圆角、尺寸和其它 UI 对齐 CC Switch，并保留现有功能。本成员未提交、未归档；未主动操作此前 001／002 改动、暂存区或提交历史。

## 基线与范围

- 本次起始 HEAD：`ed7dc85259e6de50b6fc46faad1521db12521891`；003 改前账号域与该提交一致。操作基线和原始账号源码另存于 `/tmp/cc-accounts-20261126/before/accounts`，改前截图为 `/tmp/cc-accounts-20261126/baseline/accounts.png`。
- CC Switch 固定源码：`/Users/kang/cc-switch`，`f29d0804b05ce374ee650c64706399cd0da01805`，未修改参考仓库。依据其 `docs/design-system.html`、`tailwind.config.cjs`、`src/components/ui/{button,input,dialog,segmented-control}.tsx` 和 `src/components/shell/AppPageHeader.tsx`；沿用 001 的公共 UI 契约与 002 的 PageHeader。
- 仅修改 `renderer/src/components/accounts/` 呈现。main、preload、store、API 类型、请求、凭据结构、依赖与锁文件未改；设置／代理池／订阅页面继续消费原有组件和 store。
- 领域原有布局和操作并不与参考产品一一对应；采用同一字体、控件、面板、弹窗与页面尺度，不引入 CC Switch 的供应商或路由业务。

## 实现与几何

| 项目 | 实际实现／验证 |
|---|---|
| 页头与页面 | PageHeader 18/26、600；常规高度 52、左 24／右 16。添加为主操作，导入／导出为中性按钮；内容左右 24。 |
| 工具区 | 分组页签高 36、间距 20，选中 600 和 2px 中性下划线；搜索 32 高／6 圆角／13/20；视图切换 28 高／3 内衬／8 外圆角／5 内圆角。原三合一分组菜单继续保留批量移动和管理入口；搜索、管理、选择与批量动作允许换行。 |
| 卡片／列表 | 面板 10 圆角、卡片 16 内距；身份 14/20、500，正文 13/20，辅助 12/18，徽标 11/16、500、高 20。操作使用 28 方／6 圆角按钮；去掉渐变、标签光晕、封禁光效和流光边框，保留标签颜色、状态文字、当前徽标、危险边框和选中环。 |
| 网格 | 原 ResizeObserver、按宽度列数计算和 useVirtualizer 保留。为统一字号后容纳身份、用量、期限、标签及全部按钮，行槽从 340 调至 420，实际卡片从 324 调至 404，横纵间距 16；同步 estimateSize／添加入口高度，去掉光晕缓冲。配额明细仍可内部滚动，多奖励不撑破固定高度。 |
| 列表 | 保留实际 72 高、估值 82（72+10）、overscan 和末尾添加入口。内容最小宽 1480（审查时随 8px 操作间距同步调整），外部虚拟容器横向滚动；窄窗口仍可访问全部身份、徽标、用量、时间和操作，取消旧的 lg 以下隐藏时间与纯 hover 才显示操作。封禁＋绑定代理组合测量无内容裁切。 |
| 弹窗 | 添加、编辑、分组、标签、导出默认宽 512；详情与账号方案弹窗因多列信息保留 672 最大宽。均限制在视口减 32、最高 90dvh，14 圆角，头部 20/24/12，正文左右 24 且独立滚动，操作间距 8。OIDC／编辑／导出页尾沿用 12/24/20，字段 32 高／6 圆角／13/20。关闭、背板点击、disabled 和取消条件沿原回调。 |
| 登录界面 | 三类输入路径与四个来源保留；主分段 36、次分段 28，来源行采用公共列表行，私密开关 30×18、圆点 14、位移 12。区域及自定义区域仍保留原输入与参数。 |

列表隐私显示修正仅涉及呈现：原 `displayName`／`maskedEmail` 的 useMemo 未依赖隐私状态，开关切换时沿用旧文本。本次补入 `privacyMode` 依赖；卡片、列表和详情悬停身份提示使用原遮罩函数。未改遮罩算法、复制内容、确认参数或持久化。这属于 A04 的显示核对，不改账号处理流程。

## 功能保留证据

全部浏览器测试运行真实 renderer 组件与真实 store，以内存 IPC 响应代替后端；仅使用 `example.invalid`、`fixture-*` 和假凭据。未调用真实登录、订阅支付、代理或账号服务。

| 清单 | 入口和实际结果 |
|---|---|
| A01 添加与登录 | Builder ID／Google／GitHub／IAM SSO 均验证成功与显式取消；验证私密参数、IAM 自定义区域、授权轮询、Social 回调、回调／轮询失败后停止、原 cancel API 与无新增账号。本机导入后区域及单个 OIDC 验证参数正确；重复账号不新增。 |
| A02 导入 | JSON／CSV／逗号 TXT／竖线 TXT／卡密实际点击导入；CSV 引号／逗号、区域、无效行、JSON 重复跳过、当前分组归属、取消文件选择及解析失败均核对。OIDC JSON／卡密混合批次为 1 成功、1 已存在、1 失败，保留失败输入；SSO 混合批次 1/2 成功。CSV／TXT 原本允许重复追加的行为保持。 |
| A03 浏览选择 | 分组后搜索的 ID 集合、组合筛选、清除、网格／列表切换、localStorage 偏好、全选及清除选择通过。61 个账号在两种虚拟器中逐段滚动，每个 ID 均访问到，末尾添加入口可达；开合侧栏、800／1200 宽均重新计算有效列宽，估值与实际尺寸一致。 |
| A04 逐项动作 | 两种视图分别验证 IDE／CLI／both 的 API 及目标；刷新状态、卡片刷新 Token／复制凭据、两种视图复制邮箱、登出取消／确认、删除取消／确认、解除 suspended、详情刷新与模型、编辑保存／取消、隐私即时显示均通过。操作按钮不额外改变账号选择。列表与卡片原有的动作差异保持。 |
| A05 分组标签与批量 | 分组／标签的创建、颜色、编辑、删除取消／确认、关联账号通过；选中子集批量移动、添加／移除标签和代理绑定／解绑通过。批量 refresh/check 仍调用原 background API，payload 的账号 ID 为原选中集；删除取消保留账号与选择集。 |
| A06 导出 | 六类格式 × 全部／选中范围 × 凭证选项，文件／剪贴板内容与改前函数产生的固定样例逐项一致（仅完整 JSON 的动态 exportedAt 归零比较）。JSON 字段／范围、CSV BOM 与引号、OIDC／卡密原强制凭证选项均保持；没有新增加密或内容预览。原界面只提供格式描述与复制反馈，继续保留。设置页仍用原 props 导出全部账号，签名未改。 |
| A07 跨领域 | 批量与单个绑定仍使用同一 accountProxyBindings；代理池读取同一绑定，订阅页继续读取同一账号数据。账号卡片方案选择、planName、accountId、管理账单、剪贴板与 openSubscriptionWindow 均核对。 |

`verification/business-contract.json` 保存改前 78 项处理器及 effect（审查补齐实际 startPolling 和两项筛选处理） 的 AST 指纹，忽略格式与呈现属性后比较。改后命名业务处理器、CSV 解析、导出生成与 effect 结构一致；`_helpers.ts` 只删除已无调用的光晕／封禁光效工具。格式化造成的换行不作为业务变化。

原解析边界保持：连续多组空的卡密字段会被既有 `splitCredentialLine` 视作长连字符分隔，003 未改其语法；验证使用原解析器支持的完整字段样例。原分组／标签部分按钮和确认文字未翻译的问题也未重定义。

## 验证命令与结果

复现：

```sh
PLAYWRIGHT_MODULE=/Users/kang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs \
UI_CHECK_OUTPUT=/tmp/cc-accounts-20261126/final \
node openspec/changes/cc-switch-ui-003-accounts/verification.mjs
```

支持 `UI_CHECK_STAGE=accounts|dialogs|login|actions|exchange|review` 独立运行。脚本在 finally 中关闭 Chromium 与 Vite；不改项目依赖。导出固定样例由改前组件函数捕获到 `verification/export-golden.json`，重跑无需临时基线目录。

- 003 完整 renderer 回归：执行记录 `/tmp/cc-accounts-20261126/full.log`，截图和几何／导入结果位于 `/tmp/cc-accounts-20261126/final/`。共 51 张截图，包含 16 组账号页面、24 组领域弹窗及登录中、混合结果、隐私、订阅与设置复用；最后的弹窗标题说明间距修正后补跑 dialogs stage 通过（dialogs-final.log）。
- 001 公共基础回归：`/tmp/cc-accounts-20261126/foundation.log`；三档外观、两种语言、旧配置回读、公共控件与八种字体和参考几何、24 张代表页面截图通过。
- 002 外壳／首页回归：`/tmp/cc-accounts-20261126/shell.log`；15 页导航、公共 Token 合并、弹窗／任务／首页与生命周期回归通过。本次未重复原生窗口测试。
- `npm run build`（包含 node／web typecheck）：通过，见 `/tmp/cc-accounts-20261126/build.log`。
- `npm run lint`：仓库仍有 371 个既有 error；与 002 审查结束日志按文件、规则、消息比较，无新增 error，见 `/tmp/cc-accounts-20261126/lint-comparison.json`。不把 lint 称为全仓通过。
- `git diff --check` 和 `openspec validate --all --strict`：通过，6 个 change 全部通过严格校验；11/11 任务完成。

## 限制

真实外部认证、服务端限流／网络故障、IDE／CLI 磁盘切换、真实订阅窗口及付款均未实测；当前验证证明呈现层事件、参数与可控响应分支，不等同线上服务验证。800×600 的列表保留横向滚动；详情和方案为内容宽弹窗。004～006 页面视觉迁移未包含在本成员，跨域测试仅验证既有调用与数据联动。

## 审查后修复

用户后续要求的代码审查已完成本地核对并修复，详见 [code-review.md](./code-review.md)。包含浮层视口可达、菜单／徽标尺度、操作区间距与图标、分段状态、无邮箱隐私回退和验证盲点。登录、store、API payload、复制与导入导出语义不变；独立 DM 因 HTTP 403 没有有效覆盖。新的完整回归与几何记录位于 `/tmp/cc-accounts-review-20261126/`，不以初始 51 张截图代替审查后验证。
