# Code Review

日期：2026-11-26。审查范围为相对 `ed7dc85259e6de50b6fc46faad1521db12521891` 的002工作区实现（含未跟踪的PageHeader及验证脚本），并检查其依赖的公共样式／控件。参考固定为CC Switch `f29d0804b05ce374ee650c64706399cd0da01805`，未修改参考仓库。规划为repo-local、spec-driven，任务11/11；勾选状态不作为无缺陷依据。

本地源码对照与浏览器审查发现以下3类问题，均已直接修复。独立DM审查被HTTP 403拒绝，覆盖为0，详见末节；不能把此记录表述为独立模型审查通过。

## Findings

### P2：语义字号、尺寸和圆角未注册到类名合并器（已修复）

位置：`Kiro-account-manager/src/renderer/src/lib/utils.ts:5`。原先直接使用默认twMerge，未配置001新建的语义Token。`text-badge`被识别为颜色，与`text-action-text`等互斥而被移除；实际Badge及任务状态字体为13/20，参考为11/16/500。`h-control h-auto`同时残留，关闭选项最终被固定高度和min-height约束为52px，38px的两行内容上下实际只剩7px，声明的12px内距无法实现。

按参考`src/lib/utils.ts`使用extendTailwindMerge，注册本项目实际的text、radius、spacing键。修复后五种实际Badge均为11/16/500、高20；八种字体角色与颜色类组合后仍正确；高度和圆角调用方覆盖正确生效。关闭选项在当前两行内容下自然高64px，内容距边框上下各13px（12px内距＋1px边框），保留原最小52px和换行能力。

此处是002实际组件触发的公共依赖缺陷，修复仅改变cn的类名分类；utils中formatBytes起的全部业务辅助函数源码不变，没有修改主题Token数值、数据或API。原001纯类名几何验证未覆盖“真实组件经过cn合并”的路径；已补充实际组件回归。

### P3：折叠品牌图标与提示未对齐参考（已修复）

位置：`components/layout/Sidebar.tsx:81`及`:105`。64px轨保留设计约定，但品牌行固定左内距16，使20px图标中心位于x=26，导航图标中心位于x=31.5，偏左5.5px。已将折叠品牌行居中，展开行仍保持原16px内距，品牌和导航中心一致为31.5。

提示原sideOffset=8，参考`ui/tooltip.tsx`为6；现已改为6。新增的自制提示原来不能用Escape收起；现仅在提示可见时注册并清理呈现用keydown监听，鼠标悬停且焦点在其它位置时同样可收起。没有改变全局关闭／更新弹窗原有的Escape规则，也没有添加业务快捷键。

### P3：页头副标题与附加内容的间距错误（已修复）

位置：`components/layout/PageHeader.tsx:31`。subtitle和titleExtra原来分别直接放在10px gap的标题区内；参考AppPageHeader将两者包在gap-1容器中，间距为4。已按参考分组，标题区10、左右区20及操作区8保持，长文本仍可换行。实测普通页头仍高52、主操作32，副标题到Beta徽标间距由10变4。

## 功能保留核对

- App的root JSX前源码与实施基线完全一致，renderPage、13个effects、后台刷新与托盘处理未移动；15页标识／顺序／默认折叠及navigate-page均保留。
- TitleBar保留平台按钮留位、drag/no-drag与原窗口IPC；本次只检查／复跑，未重写其业务订阅。
- CloseConfirmDialog保留minimize/quit/cancel及remember的原response；记住选择每次打开重置；遮罩取消及原无Escape关闭规则保持。
- UpdateDialog的事件、自动打开条件、下载／安装回调、下载中不可关闭及错误状态保持，未执行真实更新安装。
- TaskCenter排序、聚合进度、按回调暂停／恢复、无暂停回调时的取消、取消全部confirm、完成历史持久化／移除／清理均保留；收起抽屉和切页不停止任务。
- 首页统计、7天／90%边界、封禁排重、有效额度口径、超额及精度、三种风险跳转参数、当前账号全部字段和提示保留。隐私继续调用既有账号遮罩函数，仅影响展示。
- main／preload／store／package／lockfile无改动。未增加后续003～006的页面迁移，未引入真实账号／代理／注册／订阅请求。

上述结论结合源码／AST等价检查和隔离IPC验证；不能据此宣称所有平台、所有在线服务的端到端行为均已实测。原生窗口、人工拖动等限制见实施记录。

## 验证与证据

证据根：`/tmp/cc-shell-review-20261126/`。`before/metrics.json`与`after/metrics.json`记录修复前后实测；`verified/review-geometry.json`覆盖真实组件字体、关闭选项内距、导航居中及页头间距，另有截图。本轮最终结果如下。

新增`verification/review.mjs`接入002验证入口；实际组件经过cn后检查八种字体角色和五种Badge，而非仅检查Token。任务抽屉宽度断言改读布局计算宽度，避免spring动画的浮点变换产生419.99997px误差；断言目标仍为420px，未放宽实际布局尺寸。

| 检查 | 结果 |
|---|---|
| npm run build（含node/web typecheck） | 通过 |
| npm run lint | 371 errors／10699 warnings，与审查前相同；逐文件／规则对比无新增error |
| 002完整验证（含review阶段及独立macOS窗口） | 通过，64张截图；G01、G03～G07、H01～H02与新增实际组件几何检查均通过，无pageerror |
| 001完整回归 | 通过，真实参考字体／圆角、主题／语言／隐私／精度、控件事件／焦点、弹窗和24张代表页截图 |
| openspec validate --all --strict | 六个change全部通过 |
| git diff --check | 通过 |
| main／preload／store／package／lockfile差异 | 空；utils中非cn辅助函数与基线逐字一致 |

剩余验证限制：Windows/Linux原生窗口、真实鼠标拖动及原生红绿灯点击仍待对应平台／人工实测；在线更新安装与领域服务没有真实执行。已核对的002范围未发现未修复的功能删减；不能将该结论外推为所有在线工作流全量端到端通过。修复均留在工作区，未提交、未归档。

## 独立DM审查限制

- CLI：dm-ocr v1.13.6-dm.1；配置模型innodealing/deepseek-v4.1-flash，未改模型配置。
- 范围：workspace，预览23项／18项可审查／5项排除；包含002生产代码、验证代码与001的兼容定位修改。排除`.openspec-local/**,openspec/baselines/**,openspec/pipelines/**`；其余Markdown由CLI按扩展名排除。
- 命令参数采用skill要求的`OCR_LLM_TIMEOUT=600`、`--audience agent --format json --timeout 30`；背景和结果在仓库外。
- 宿主执行会话14145，退出码1；DM session `88f8b27e-c60f-4b02-a470-0069d9f88000`。
- status=failed；manifest selected18、completed0、failed18；33次逻辑请求均为authentication/HTTP403，tokens及tool_calls均为0，无重试。报告comments=null不能解释为“没有问题”，summary.files_reviewed=18也不是成功覆盖。
- 原始报告：`/tmp/cc-shell-review-20261126/result.json`，预览preview.json，日志dm.log，背景background.md。此后修复由本地源码与浏览器检查完成，未把失败调用当作修复后独立复审。
- 服务配置排查入口：`dm-ocr config provider`、`dm-ocr llm test`。未修改API密钥或重复启动同配置的失败请求。
