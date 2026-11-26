# 001 公共 UI 代码审查与修复

日期：2026-11-26。范围：cc-switch-ui-001-foundations 工作区实现（暂存＋未暂存＋未跟踪），重点为公共字体、间距、圆角、尺寸；修复已获用户授权。002～006 的领域页面迁移仍不在本轮范围。

参考固定提交：CC Switch `f29d0804b05ce374ee650c64706399cd0da01805`。所有字体角色以该提交紧凑密度的 v7 正式角色为准；本项目没有增加密度设置。

## 发现与修复

下列文件位置相对 `src/renderer/src/`。行号为修复后的定位。所列问题已修复，未保留为待办。

| 级别 | 位置 | 可复现问题／参考要求 | 修复与验证 |
|---|---|---|---|
| P2 | styles/globals.css:577 | `.ui-segmented` 的原生 button 缺少 flex 对齐，gap不生效，常规 SVG 无16px约束，实测图标放大至约46px且文字溢出36px轨道；紧凑项继承20px行高，参考caption为18px | 按 segmented-control.tsx 补齐图文居中、nowrap、16／14图标；正常13/20，紧凑12/18，间距6；明暗均测量图标与文字中心一致 |
| P2 | styles/globals.css:419 | `.ui-dialog-panel` 缺少默认宽度，实测相同短文本仅约237px宽；最大高度568px而参考90vh为540px；标题说明没有4px间距。旧测试内联 width:512px 掩盖了缺陷 | 默认512px且不超视口减32，最大90dvh且不超视口减32；header flex列＋gap4；body flex:auto独立滚动，footer交叉轴居中。移除测试宽度补丁后，800×600实测512×540，头尾在正文滚动时保持可达 |
| P2 | styles/globals.css:559 | 无控件设置行只有44px；SettingsLayout.tsx 的内层 min-h28 加上下各12，应最少52px | 公共设置行 min-height52，保留长内容扩展；短行明暗实测52px |
| P2 | styles/globals.css:89 | sm／md／lg 被映射为4／6／10，2xl／3xl为14／16，与参考配置6／8／12及默认16／24不一致，旧调用者得到错误几何 | 修正兼容别名6／8／12／14／16／24；语义 control／panel／dialog 仍为6／10／14。所有九个入口均实测核对 |
| P3 | styles/globals.css:621 | 非选中页签继承400，参考设计默认500 | 页签正文13/20/500，选中600；明暗均实测 |
| P3 | components/ui/button.tsx:16 | secondary仍有实色填充；secondary／ghost透明边框额外增加2px固有宽度，参考两者无边框透明低强调；按钮焦点环为2px而参考为1px | 两变体改为透明无边框，保留hover中性底；焦点1px。验证零边框／透明底及原有点击、键盘、禁用行为 |
| P3 | components/ui/Select.tsx:136 | 选择器焦点环2px，与 reference SelectTrigger 复用的 fieldClass 3px不一致 | 焦点及展开态均3px，明暗alpha沿用输入约定；新增实际焦点阴影断言，选项选择仍只回调一次 |
| P3 | components/ui/switch.tsx:9 | 公共契约列出紧凑26×16，但Switch只有标准尺寸，无法像参考 `size=sm` 同时缩小轨道、圆点和位移 | 增加可选sm，默认接口保持；标准30×18／圆点14／位移12，紧凑26×16／圆点12／位移10；点击与Space各一次回调，尺寸与Toggle紧凑档一致。统一参考焦点色与圆点阴影 |

另修正浅色弱边框为参考 `#E4E4E9`，原 `#E4E4E7` 并非该提交 HSL 的准确十六进制值。

八种基础字体角色的字号、行高、字重本身核对正确；修复集中在消费这些角色的公共布局默认值和组件样式。sans／mono字体栈也已直接与参考样式在同一浏览器中比较。

## 验证与复审

- 新增 `verification/geometry.mjs`：从指定参考仓库的固定提交读取 design-system.html 的八种字体、tailwind.config.cjs 的圆角、SettingsLayout.tsx 的行高及dialog.tsx的高度约束；测试构建显式扫描公共样例类。不会修改参考仓库，也不依赖参考工作区的未提交内容。
- 几何样例直接使用公开CSS和原生button；弹窗不提供内联宽度，不借用Button的flex样式掩盖纯CSS入口遗漏。覆盖明暗、字体栈／八种角色、圆角、设置行、两档分段、页签字重、弹窗滚动和标题／操作可达。
- 原控件回归补充紧凑Switch／Toggle尺寸、紧凑Switch状态与单次回调、低强调按钮透明底／零边框、Select的3px焦点环；现有缺值→输入→加载→错误→取消、键盘／鼠标／disabled、隐私与偏好检查继续通过。
- `npm run typecheck`、`npm run build`通过。
- 完整隔离renderer验证通过：三页×中英×明暗×1200／800共24张页面截图，另有关闭／账号错误弹窗、共享控件与公共几何截图。全部IPC为固定替身，无真实账号／代理／订阅操作。
- `npm run lint`仍为371 errors／10910 warnings，与本轮审查前相同；没有新增error。遗留问题未夹带扩展修复。
- 本地修复后源码复核通过；公共几何对照与现有交互回归均通过。6个活动change的OpenSpec严格校验均通过，git diff HEAD --check通过。

证据目录：`/tmp/cc-foundations-review-20261126/`。`before/metrics.json`、`after/metrics.json`保存原始复现与修复后的测量；`verified/geometry-metrics.json`保存从参考固定提交取得的最终断言结果；`ui-check.log`、`geometry-final.log`、`typecheck.log`、`build.log`、`lint.log`保存运行结果。

完整复现命令（仓库根）：

```bash
PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs \
UI_REFERENCE_ROOT=/Users/kang/cc-switch \
UI_CHECK_OUTPUT=/tmp/cc-foundations-review-20261126/verified \
node openspec/changes/cc-switch-ui-001-foundations/verification.mjs
```

`UI_CHECK_STAGE=geometry`可单独重跑几何与字体对照，`CHROME_PATH`可指定本机Chrome。无UI_REFERENCE_ROOT时使用该固定提交的验收快照。

## DM 独立审查限制

DM CLI版本1.13.6-dm.1；使用已配置provider `innodealing`／model `deepseek-v4.1-flash`。初审会话 `13f31e69-edb2-45e0-858c-b539e55fa597`；宿主持久进程会话46524，退出码1。

预览：27个可审查实现／验证文件。排除 `.openspec-local/**`、002～006规划、基线／流水线／历史复核等；Markdown由CLI判为unsupported_ext，需求通过background.md提供。预览与调用使用同一组排除参数，保留 `.openspec-local/**`。

结果：status=failed；manifest completed=0，failed=27。35个逻辑请求均在transport阶段发生network错误，175次重试没有恢复；工具调用与token计数均0。不能把summary中的files_reviewed=27当作成功覆盖，也不能把comments=0当作无问题。背景长度2369字符超过CLI建议2000（仍低于技能上限8000），这不是成功审查的证据。

原始报告 `/tmp/cc-foundations-review-20261126/result.json`、预览 `preview.json`、背景 `background.md` 已保留。网络／配置修复后可用 `dm-ocr config provider`、`dm-ocr llm test`诊断，再对当前工作区重新执行独立复审。本次审查结论来自本地源码对照、测量、修复与回归，不声称DM独立审查已通过。

## 边界

未修改main／preload、依赖、store、持久化字段或领域业务动作；不实施002～006，不提交、归档或调整用户暂存区。修正兼容圆角别名会影响仍使用旧名称的调用方，后续领域迁移应显式采用control／panel／dialog角色，不能依赖别名代替语义。
