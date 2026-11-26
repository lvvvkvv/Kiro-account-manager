# 实施记录

日期：2026-11-26。实施范围为 001；参考仓库提交 `f29d0804b05ce374ee650c64706399cd0da01805`，未修改参考仓库。任务完成情况以 tasks.md 为准。

## Token 核对

已捕获改前首页、账号、设置的浅／深色截图（`/tmp/cc-foundations-baseline/`），以及 Token 首轮对应截图（`/tmp/cc-foundations-token-check/`）。这些截图是隔离浏览器中的真实 renderer，IPC 使用固定样例替身，无真实凭据。

| 角色 | 浅色 | 深色 | 对照 |
|---|---|---|---|
| 应用／侧栏／卡片 | #FFFFFF / #F5F5F7 / #FFFFFF | #1C1C1E / #161618 / #2E2E33 | 对齐参考 src/index.css |
| 主／次／辅助文字 | #18181B / #52525B / #65656E | #E4E4E7 / #ABABB3 / #9A9AA2 | 对齐参考三级值 |
| 弱／强边框 | #E4E4E9 / #CFCFD6 | #3E3E45 / #4A4A52 | 弱边框为参考 HSL 近似十六进制值 |
| 默认操作／hover／链接 | #F97316 / #EA620A / #C2410C | #EA580C / #F06D1F / #FB923C | 操作背景与参考一致，链接独立 |
| 成功／警告文字／危险文字 | #007634 / #A64A00 / #B91C1C | #4ADE80 / #FCD34D / #FCA5A5 | 固定语义，不受主题影响 |
| 正文／页标题／控件／紧凑 | 13px / 18px / 32px / 28px | 相同 | 无新增密度偏好 |
| 控件／面板／弹窗圆角 | 6px / 10px / 14px | 相同 | 对齐参考 |

操作前景、背景和链接分别映射；根据用户“UI 与 CC Switch 一致”的要求，明暗主操作均采用参考的白字及 600 字重。领域页面原有标题字号、图标块、渐变装饰和手写尺寸在各所属成员继续迁移。

## 基线检查

应用目录 npm ci 完成，无依赖清单和锁文件改动。改动前 typecheck 通过；lint 为 374 errors / 10986 warnings，日志 `/tmp/cc-foundations-baseline-lint.log`。Token 首轮 build 通过。

## 用户范围更新与设置验证

用户实施阶段明确要求：主题与 CC Switch 一致，删除多色主题；语言只保留中文／英文；隐私仅统一外观，保留账号信息遮罩。原来的全主题兼容要求由此取代，不引入 CC Switch 的请求正文过滤。001 与 006 的规划和功能基线已同步。

删除全部 theme-* CSS 和 32 色配置数组，外观仅 system／light／dark，固定橙色。旧颜色值解析为 system；旧 auto 语言解析为系统对应中文或英文，不再显示第三个选项。保留 theme／darkMode／language 的存储字段结构。

隔离 renderer 已通过：英文＋隐私＋精度旧配置加载；三档点击；仅 system 响应系统明暗变化；手动浅色不受系统变化影响；切换中文；保存并重新 loadFromStorage 后主题、语言、隐私与精度保持。脚本为 verification.mjs，使用固定 IPC 替身。先前 64 主题组合试验已被用户新要求取代，不作为最终验收。

## 公共装饰与领域边界

公共 ambient-bg／page-surface／acrylic-noise 不再创建伪元素光斑、噪点；breathe-glow 无装饰动画；glass-card／strong／subtle、glass-sidebar／toolbar、page-hero 均为实色。gradient-bg-primary 兼容旧调用但为实色橙色，gradient-border 为中性描边。active-glow-border 改为固定内描边，不丢失当前状态；banned-badge 的红色与感叹号保留。

代表账号样例的 Active／Banned／Expired、用量数值／进度、账号遮罩仍可辨认。公共旧类均保留；各页面局部硬编码不做全局颜色覆盖。

| 成员 | 残余领域呈现与后续职责 |
|---|---|
| 002 | Sidebar 激活项局部渐变与大尺寸；HomePage hero 内部光斑、统计／图表配色；TitleBar、TaskCenter、关闭／更新弹窗局部结构 |
| 003 | 账号工具栏横向布局、卡片内联状态底色、标签自选颜色、所有账号弹窗的局部 h-10／rounded-xl／标题与图标块；800 宽工具栏仍有原有横向拥挤 |
| 004 | ProxyPanel／SecurityPanel、KProxy、ProxyPool 的局部梯度、日志／表格与领域菜单 |
| 005 | 注册与订阅页的 hero、阶段、批次与进度局部样式 |
| 006 | 设置余下分区、机器码／Kiro／Webhook／诊断／配置同步／日志／关于的 hero 和局部样式；不得恢复旧主题色或 auto 语言选项 |

001 交付可消费的公共角色与尺寸，领域布局由各自 change 迁移；用户最终确认本次仅执行 001，不实施 002～006。

## 控件兼容清单

| 控件 | 外观映射与接口 | 已验证行为 |
|---|---|---|
| Button | default／gradient → 同一实色主操作；outline → 中性描边；secondary／ghost／link／destructive 保留角色；default32、sm28、lg／cta36、icon32；图标16，左右内距14／12，间隙6 | 点击与 Enter 各一次；禁用／调用方 loading 的按钮不触发；账号添加等待时 spinner 与禁用保持，二次原生点击不重复 IPC |
| Card | glass／strong／subtle → 实色卡片／浮层／次级底；solid／elevated 保留；圆角10，默认内距16 | 五个变体均 backdrop-filter:none；领域 className／style 仍可覆盖，标题与内容正常 |
| Input／Label | 单行32、圆角6、左右10；字号13，焦点3px；保留原生值、ref、onChange、错误与 disabled 属性 | 中英文输入与回读；账号 Client ID／Secret／Refresh Token 的原值和校验；缺项禁用，错误说明可见 |
| Badge／Alert | 徽标高20、字号11/16、圆角胶囊、左右7；Alert 实色中性／危险底，保留 role=alert | 状态以文字配合颜色；既有 success／destructive／outline 调用兼容 |
| Progress | 保留 value／max／indicatorClassName 和原 >80／>95 阈值；增加 progressbar 语义 | 50／90／98 数值可辨；减少动效只关闭进度过渡，不隐藏业务 spinner |
| Select | 32高、6圆角，菜单10圆角、内距4；描述可换行，菜单视空间向上／下，最高240 | 鼠标选择、方向键＋Enter 各一次 onChange；方向键浏览与 Escape 不提交；关闭焦点回触发器；外点沿原关闭行为 |
| Toggle／Switch | 标准30×18、圆点14；紧凑26×16、圆点12；原 checked 和回调接口保留，开放 aria-label 等原生呈现属性 | 点击／Space／Enter 各一次变化；禁用不触发；置于表单不产生意外 submit；未新增业务快捷键 |
| 原生 input／checkbox／radio | 32高默认字段；原生勾选16、1.5边框、4圆角／圆形，选中固定操作色 | 勾选点击与 Space 各一次原生 change，不替换事件模型；原有 IME user-select 修复保留 |

账号添加用固定失败 IPC 验证缺值→填入→加载→失败→取消，未发登录／导入请求且账号总数不变。关闭确认在中文／英文、浅／深色的 800×600 下，取消和遮罩仅发送 cancel,false，不发送 minimize／quit。

## 可读性与最小窗口观察

最终自动截图覆盖首页／账号／设置 × 中文／英文 × 浅／深色 × 1200×1200／800×600，共24张；关闭／账号错误弹窗另有8张。截图位于 `/tmp/cc-foundations-final/`。共享控件核对图为 controls-light.png／controls-dark.png，几何测量为 control-metrics.json。

- 13px 正文、三级文字和中性边框可辨，成功／封禁／过期仍有状态文字；进度保留数值语义。账号样例全部为 example.invalid 的虚构数据，无真实凭据。
- 800×600 的设置外观三档与语言选择可达，长账号错误可滚动到取消／提交，再滚回页头；关闭弹窗的取消和遮罩保持原结果。弹窗头尾固定的公共 ui-dialog-* 结构已提供，领域弹窗结构是否迁移仍由002／003决定。
- 共享图标按钮的 aria-label、键盘焦点已验证，Select关闭焦点回触发器；Switch／Toggle支持显式名称。领域原有无名称图标按钮需随002～006接线，001不猜测业务名称。
- 减少动效时公共进度条 transition-property 为 none；value与文字保持，账号加载spinner仍可辨。不新增任何业务快捷键。
- 账号工具栏在800宽仍有原先横向拥挤，领域大字号、hero内部渐变、局部 h-10／rounded-xl 等已列入各成员残余清单；本次不将领域页面标为已完成迁移。

完整规范见 ui-contract.md。公共类与后续迁移入口同时提供，避免只定义颜色而缺少间距／字体／圆角／尺寸。

## 最终验证与复现

| 检查 | 结果 |
|---|---|
| npm run typecheck | 通过，node／web 均通过 |
| npm run build | 通过，main／preload／renderer 全部产出 |
| npm run lint | 371 errors / 10910 warnings；基线 374 / 10986。按文件＋规则计数没有新增 error，移除 Select 的2个和 Toggle的1个既有返回类型错误。Button／Badge 的 Fast Refresh混合导出等遗留错误未扩展本轮修复 |
| 隔离 renderer | 主题／语言／偏好、三页24截图、两类弹窗8截图、控件键鼠／事件／禁用／错误／焦点、尺寸测量；最终完整输出见 /tmp/cc-foundations-final-ui.log |
| OpenSpec | 当前 change 严格校验通过；全部6个活动 change 严格校验通过（6 passed / 0 failed） |
| 差异边界 | main／preload、package.json／package-lock.json 无改动；store仅主题／语言解析与生效，持久化字段结构不变；不调用真实登录、代理、订阅、证书、更新安装 |

在仓库根运行 `PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node openspec/changes/cc-switch-ui-001-foundations/verification.mjs`。脚本使用应用已安装的 Vite／React／Tailwind 和本机 Chrome，创建临时服务器并在 finally 关闭，不新增应用依赖。可通过 CHROME_PATH／UI_CHECK_OUTPUT 修改浏览器与输出目录。开发验证时使用 npm临时缓存的 Playwright 1.65.1。

本轮未执行真实 Electron IPC、跨平台窗口按钮、外部账号登录或真实服务端操作；公共 renderer 验证使用固定 IPC 替身，不能声称这些外部流程已验收。相关流程继续由所属成员按功能基线完成。

## 交接状态

001 的9项任务完成，公共契约可供依赖成员消费。002～006 的规划继续引用001；003／004／005的验收文案已将自选主题改为跟随系统外观，006的主题／语言条目已同步用户新要求；其余成员实现任务仍未勾选。

本轮运行于 main 工作区，不创建提交或归档，不改动用户原有暂存区。实现、验证脚本和记录均保留供后续审查。可在审查后执行002；本记录不代表后续领域页面已迁移。

## 2026-11-26 代码审查修复

用户要求重点核对字体、间距、圆角与尺寸并直接修复。对照固定 CC Switch 提交，源码核对与浏览器实测发现并修复分段图文布局／紧凑行高、弹窗默认宽高／标题说明间距、设置行最小高度、圆角别名、页签字重以及按钮／选择器／紧凑开关的公共呈现差异。详细问题、来源和证据见 code-review.md。

新增 verification/geometry.mjs，显式纳入测试构建扫描；支持 UI_REFERENCE_ROOT=/Users/kang/cc-switch 直接读取参考设计的八种字体角色、配置圆角及设置／弹窗约束。测试不再通过内联512宽度补丁掩盖公共弹窗缺少默认宽度的问题，覆盖原生分段按钮、无控件设置行、紧凑开关及低强调按钮边框。

最新证据目录：`/tmp/cc-foundations-review-20261126/verified/`。原实施阶段 /tmp/cc-foundations-final/ 为修复前记录；复审结论以 code-review.md 和本次目录为准。DM独立审查网络传输失败，实际成功覆盖0/27，未计为通过。
