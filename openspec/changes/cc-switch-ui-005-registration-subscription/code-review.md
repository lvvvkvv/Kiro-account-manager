# Code Review

日期：2026-11-26（Asia/Shanghai）。范围：005 当前工作区实现，基线 `f5553c2049871be8558ae4fd3924e21057b57581`；参考 CC Switch 固定提交 `f29d0804b05ce374ee650c64706399cd0da01805` 与 001 公共 UI 契约。用户明确授权发现问题直接修复；本次审查分支为 `codex/cc-switch-ui`，未创建或切换分支。

## Findings

以下问题均已复现并修复，按严重性排列。

### P2: 长方案徽标溢出订阅行

位置：[SubscriptionPage.tsx](/Users/kang/Kiro-account-manager/src/renderer/src/components/pages/SubscriptionPage.tsx:2594)，同时修正超额页订阅列表及保留的旧列表分支。

原徽标虽固定 20px 高、11/16 字体，但允许文字换行且 overflow 可见。长方案样例的 clientHeight 为 20、scrollHeight 为 218，文本可跨越多行，破坏原 47px 虚拟行与相邻操作的可辨性。现按参考 chip 的单行约束截断，保持高 20、左右 7、字号 11/16/500、胶囊和完整 title。同一样例 scrollHeight 为 20，名称完整保留在 DOM 与 title，原门户／选择动作不变。

### P2: 模板菜单越过最小窗口底边

位置：[RegisterPage.tsx](/Users/kang/Kiro-account-manager/src/renderer/src/components/pages/RegisterPage.tsx:3946)、新增纯呈现 [TemplateMenu.tsx](/Users/kang/Kiro-account-manager/src/renderer/src/components/registration/TemplateMenu.tsx:5)。

800×600 中将模板按钮置于底部附近，原菜单 top=567.5、height=400、bottom=967.5，页面滚动容器会裁切菜单。现用 body portal、上下空间判断及视口 16px 边距定位，宽最多 360、高最多 400，并随窗口／滚动／渲染重排更新。菜单维持公共圆角 10、内距 4；原模板保存、导入导出、删除、加载与开关状态仍在原页面，不新增外部点击关闭等业务行为。

同一底部样例修复后 top=123.5、bottom=523.5。回归覆盖向上／向下打开、800↔1200 宽度变化、滚动后选取末项，以及保存模板插入日志导致锚点移出视口时继续导入／导出。新组件只读取几何并设置样式，观察器及事件监听在卸载时清理，无 IPC、存储或任务调用。

### P3: 混合邮箱源按钮偏离公共控件尺度

位置：[RegisterPage.tsx](/Users/kang/Kiro-account-manager/src/renderer/src/components/pages/RegisterPage.tsx:3189)。

原选择按钮实测 38px 高、左右 12、图文间距 8，未与 32px 输入控件及 CC Switch 常规按钮一致。现为 32 高、左右 14、图文 6、13/20/500、圆角 6。混合源集合、权重、原校验与禁用属性及 onClick 保持。

## Preservation

- 602 项原业务结构核对继续通过：601 项与改前一致；实施阶段已经单列的模板文件框修复仍按原前后哈希核验。本次审查未新增业务哈希例外、未改模块状态／refs／存储键／注册策略／任务中心回调／过滤规则／API 参数。
- 完整隔离 renderer 回归覆盖 R01～R05、S01～S04：六来源、手动阶段与空 OTP、结果导入、跨页链接、暂停／恢复／取消／停止、定时／配额／风控／重试／代理 session、模板文件往返、黑名单、日志／历史／重导入／CSV／分析；订阅预检／计划、所有选择及 selected／all 范围、链接验证／再生成／删除联动、超额／门户和 61 行虚拟滚动。
- 订阅表头与实际虚拟行的 7 列 x／width 一致，本机未复现列错位，因此未额外改变列布局。未修改 main、preload、store、类型、依赖或其它成员页面。

## Validation

证据：`/tmp/cc-registration-review-20261126/`。`before/review.json`、`after/review.json` 保存复现与初次修复尺度；`final/` 保存最终完整回归和补充边界测量。

- 005 完整回归：业务流程、80 组六模式／三 Tab／弹窗的中英文×明暗×800×600／1200×1200 几何、系统外观、展开侧栏及长模板、上述三个审查场景。最终 `final.log` 与 `final/{registration,subscription,geometry,compact,review}.json` 为证据。
- 001 CC Switch 直接参考对照通过，覆盖八种字体角色、字体栈、圆角、设置行、分段、页签、弹窗，以及外观／语言迁移、隐私与精度保持；见 `foundations/geometry-metrics.json`。
- `npm run build`（含 node／web typecheck）通过。`npm run lint` 仍为 371 errors／6549 warnings，与审查前逐文件、规则及错误信息比对无新增 error；见 `lint-comparison.json`。
- `git diff --check` 与六个 OpenSpec change 严格校验通过；005 仍为 all_done，12/12。未提交或归档。
- 所有运行验证均为 Chrome renderer＋内存 IPC；真实 AWS／邮件／Proton 登录、订阅和计费结果仍待隔离环境及测试账号，不宣称真实外部 E2E 通过。

## Independent Review

独立 DM 审查未完成，与上述本地审查和运行验证分别记录。

- CLI `v1.13.6-dm.1`，沿用配置 provider `innodealing`／model `deepseek-v4.1-flash`，未修改配置或凭据。
- 同范围预览：工作区 17 个文件，11 可审查（2 个页面、9 个验证文件），6 排除；排除项含 `.openspec-local/**`、基线及流水线 Markdown，CLI 不支持的 Markdown 由人工读取。审查调用在本地修复前完成，新增浮层组件和审查回归不在该失败调用的输入中。
- Session：`2d4278b8-72c6-4615-bbc0-a9d7ba8b34c0`；退出码 1，status=failed，warnings 字段缺省，comments=null。manifest：selected=11、completed=0、failed=11、reused=0、waived=0；21 个逻辑请求均因 HTTP 403 authentication 失败、无重试，0 token、0 tool call。summary 的 files_reviewed=11 不代表有效覆盖。
- 背景与完整报告：`/tmp/cc-registration-review-20261126/{background.md,result.json,dm.log}`；报告所有 manifest 项与全部请求失败信息已逐项读取。未对相同鉴权失败重复调用，未宣称补丁经过独立 DM 复审。
- 遵循 [openspec-dm-code-review 技能](/Users/kang/.codex/skills/openspec-dm-code-review/SKILL.md)：“配置或调用失败时报告阻塞”。排查入口：`dm-ocr config provider`、`dm-ocr llm test`。本地修复及验证继续在用户授权范围内完成。
