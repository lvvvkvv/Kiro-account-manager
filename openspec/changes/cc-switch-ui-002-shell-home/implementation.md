# Implementation

日期：2026-11-26。实施基线 `ed7dc85`；CC Switch 参考固定为 `f29d0804b05ce374ee650c64706399cd0da01805`。本次仅实施 002；003～006 尚未接入新页头。沿用 001 的 ui-contract.md，不修改 main／preload／store、依赖或存储结构。

## 改前基线

证据目录 `/tmp/cc-shell-home-20261126/before/`：15 页截图、默认折叠导航顺序 navigation.json、首页文本 home.txt。全部页面在修正测试桩的返回类型后渲染无 pageerror；测试桩不访问真实账号或在线服务。

原侧栏展开 224px、折叠 64px；导航为大圆角彩色选中态，外壳有 8px 间隙／24px 圆角。首页样例为 3 个账号：正常 1、错误 1、即将过期 2；风险封禁 1／到期 1；有效账号 1，总额度 100、使用 22、剩余 78、使用率 22.00%。原首页只有 3 个风险行跳转，没有独立版本／外链／快捷按钮；版本仍由 TitleBar 提供，其余内容为当前账号详情、快速提示与三个功能说明卡。保持该实际功能集合，不添加虚构入口。

## 参考与呈现约定

- `src/components/shell/Sidebar.tsx`：展开 200px，常规行 184×28、左右8／图文8、字号13/20，图标18；折叠行32方／图标20，中性 selected。保留本项目64px轨与原15项顺序，未复制对方应用业务分组。
- `src/components/shell/AppPageHeader.tsx`：页头52、左24右16、组间20、图标22／标题间10，标题18/26/600，操作间8。
- `src/components/ui/dialog.tsx` 及001契约：宽512、上限90vh、圆角14、标题16/24/600，头20/24/12、正文左右24、尾12/24/20。
- `src/components/ui/sheet.tsx`：任务抽屉420宽、左侧圆角14、大阴影；标题15/22，头左右20／上16、内容左右20／上下16，关闭28方。
- `docs/design-system.html`、`tailwind.config.cjs`：系统字体栈、正文13/20、辅助12/18、指标24/32/600；公共间距与6/10/14语义圆角均复用001。

## PageHeader 使用约定

`components/layout/PageHeader.tsx` 仅提供 `title`（必填）、`icon`、`subtitle`、`titleExtra`、`actions`、`className` 呈现插槽。图标槽22方，传入图标无需包彩色背景；标题18/26；右侧操作组间距8，主操作放最后。普通内容高52；长标题、说明或操作允许换行并增高，避免裁切。页头本身不注册业务、导航、拖动或窗口操作；TitleBar 保留全部平台窗口能力。领域页面可使用 `flex min-h-0 flex-1 flex-col` 外层、PageHeader、`min-h-0 flex-1 overflow-auto p-6` 内容层。首页已接入；003～006按各自范围迁移。

## 阶段验证

- G01：15页逐项点击、返回首页、navigate-page深层跳转；默认64折叠与200展开保持；800×600全部项可滚动到达。
- G03：隔离浏览器分别模拟darwin/win32/linux，验证macOS80px原生按钮留位、自绘最小化／最大化／还原／关闭IPC各一次，drag/no-drag样式保留。此项为renderer验证，三平台原生红绿灯、真实窗口移动和系统行为均未据此宣称通过；原生实测状态在最终结果补充。
- G04：最小化／退出各含remember=false和true；取消、右上关闭、遮罩取消传回原action及remember。每次打开重置remember；原无Escape关闭规则保持。
- G05：原事件订阅及清理保持。检查事件本身不打开，available自动打开；检查／最新／可更新／下载／完成／错误可见；下载中遮罩与Escape不关闭，关闭按钮不显示；下载和安装各调用一次mock，未安装更新。新增中英文对应文案，原状态和操作时机保持。
- 证据：`/tmp/cc-shell-home-20261126/verified/` 下shell-geometry.json、dialog-geometry.json、15页/导航/平台/关闭/更新截图；shell.log、dialogs.log通过。

各项验收结果及平台限制见下文。

## 首页与任务中心验收

- G06：入口只在有任务时出现；运行和暂停任务在前，按原updatedAt排序；3个活动任务聚合为25%。有回调才显示暂停／恢复，无暂停回调仍能取消；取消全部保留原confirm的取消／确认两条路径。收起抽屉并切页后更新任务，重新打开可见进度；已完成项移除／清理、完成历史重载与不保存回调保持。任务关闭／取消／完成均未移动到新组件或新store。
- H01：上述3账号基线数值完全一致。补充4账号边界样例：正常2、错误2、即将过期2；封禁／到期／高用量各1，封禁不会重复计入后两组；天数7、用量0.9包含边界。3个风险动作仍清空分组限制并传入bannedOnly=true、daysRemainingMax=7、usageMin=0.9，跳转accounts。
- H02：保留用量汇总只统计active且limit>0的账号；125.678/100得到125.68%或125.7%，超额比例与积分精度保持；当前账号的用量、订阅、Token状态、认证方式、原始订阅字段、基础／试用／奖励额度、User ID、IDP、重置日期均保留。
- 空数据、加载等待、加载失败均保留导航与提示内容；长昵称／邮箱／订阅类型／User ID／奖励名称无横向溢出。中文／英文×浅／深色×800×600／1200×1200各截图页面顶部、当前账号、底部，共24张首页截图，另有空态／超额／长文截图。
- 账号遮罩：旧首页直接渲染姓名／邮箱，与既有隐私设置和本次规格不一致。已在重排后的首页当前账号及风险预览调用现有maskNickname／maskEmail；算法与配置字段未变，关闭隐私后恢复原文本。这是002呈现接入，未修改store或新增隐私机制。
- 证据：`verified/task-geometry.json`、`home-geometry.json`及tasks/home截图；tasks.log、home.log通过。

## 生命周期与平台补充

- G07静态等价：与实施基线逐项比较App、TitleBar、TaskCenter、HomePage、CloseConfirmDialog、UpdateDialog的effects及所涉计算／回调AST；忽略格式化和不影响语义的括号。App的root JSX之前源码完全一致，包括renderPage和全部业务生命周期；未抽离或重写后台处理。
- G07动态：切页和模拟最小化不增加订阅；IDE Token事件触发一次reload；两类后台结果各2条分别合并为一次Map更新与一次托盘列表同步，原120ms批处理／400ms防抖保持；封禁、profileArn同步与beforeunload保存通过。账号Map变化时，原onTraySwitchAccount因既有callback依赖正常清理并重注册，活动监听保持1，未把这种原行为误报为新增泄漏。
- 原生平台：独立Electron 38.7.2测试窗口使用相同800×600最小尺寸、hiddenInset、红绿灯坐标14/12及关闭后台节流参数；macOS按钮坐标读取、最小化／恢复／最大化／还原／关闭实测通过。未运行项目真实main、未加载真实electron-store。真实鼠标拖动、原生红绿灯点击及Windows/Linux原生行为仍待对应人工／平台环境验证；renderer三平台IPC验证均已通过。
- native-window.json和native-macos-800.png保存在证据目录；lifecycle.json包含effects数量、订阅快照与检查结果。


## 集成结果与复现

11/11实施任务已完成，未执行归档／提交。后续本地代码审查已修复问题；独立DM因HTTP403未完成，详见code-review.md。003～006保持未实施，后续使用上述PageHeader约定，并继续保留各自领域业务。001测试仅将关闭确认定位由旧glass类名改为语义dialog名称，未改001生产实现。

| 检查 | 结果 |
|---|---|
| npm run typecheck | 通过；最终build再次包含node/web typecheck |
| npm run build | 通过，main／preload／renderer构建完成 |
| npm run lint | 基线371 errors／10910 warnings；最终371 errors／10699 warnings。按文件和规则比较无新增error；现有错误未在本变更中扩展处理 |
| 002完整隔离renderer及独立macOS Electron验证 | 通过，62张截图、4项几何JSON、lifecycle/native-window记录；无真实下载／安装／账号请求 |
| 001完整回归（UI_REFERENCE_ROOT固定参考） | 通过，三档外观／两种语言／隐私与精度、控件事件与焦点、八种字体角色／圆角、弹窗、24张代表页截图 |
| openspec validate --all --strict | 六个change全部通过 |
| git diff --check | 通过 |
| main／preload／store／package／lockfile差异 | 空；App业务区与原源码一致 |

完整日志、改前截图与改后证据位于`/tmp/cc-shell-home-20261126/`。`verified/`为002最终完整运行，`foundation-regression/`为001回归。所有截图使用固定example.invalid账号，未保存真实凭据。

在仓库根执行，PLAYWRIGHT_MODULE／CHROME_PATH按本机可用路径覆盖；不需要改依赖：

```sh
PLAYWRIGHT_MODULE=/Users/kang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs UI_NATIVE_WINDOW=1 node openspec/changes/cc-switch-ui-002-shell-home/verification.mjs
PLAYWRIGHT_MODULE=/Users/kang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs UI_REFERENCE_ROOT=/Users/kang/cc-switch UI_CHECK_OUTPUT=/tmp/cc-shell-home-20261126/foundation-regression node openspec/changes/cc-switch-ui-001-foundations/verification.mjs
```

`UI_CHECK_STAGE`可选shell／review／dialogs／tasks／home／lifecycle；原生窗口专项需同时设置`UI_NATIVE_WINDOW=1 UI_CHECK_STAGE=native`。不支持的原生平台明确待测，不能把mock IPC结果当作系统窗口验证。


## 代码审查修复补充

本地审查修复了公共cn遗漏语义Token注册导致的真实组件字体／尺寸覆盖错误、折叠品牌居中与提示间距／Escape、页头附加内容间距。Badge实测恢复11/16/500，关闭选项恢复12px上下内距；详细修复前后数值见code-review.md。生产变更额外涉及lib/utils.ts的呈现用cn配置，其余辅助函数原样保留；main／preload／store／依赖及App业务区继续无改动。

本轮验证证据根为`/tmp/cc-shell-review-20261126/`，区别于首次实施的证据目录。独立DM返回authentication/HTTP403，18项全部失败，未取得任何成功覆盖；本地修复与回归不等同于独立模型审查通过。

修复后最终验证：002含review专项与macOS独立窗口的完整验证、001完整回归、build/typecheck均通过；lint与审查前相同（371 errors／10699 warnings），OpenSpec严格校验及diff检查通过。新证据包含64张002截图，见code-review.md的最终结果表。
