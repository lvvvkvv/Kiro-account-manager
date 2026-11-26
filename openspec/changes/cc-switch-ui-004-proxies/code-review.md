# 004 代码审查与修复

日期：2026-11-26（Asia/Shanghai）。用户要求核对字体、间距、圆角、尺寸与 CC Switch 一致，完整保留原功能，并直接修复问题。

## Scope

审查 `cc-switch-ui-004-proxies` 的工作区实现，基于 HEAD `cb6c67cdbbedf44de2c9453f20321c1cade98c81`，涵盖 API 反代、KProxy、代理池及全部领域弹窗。保留既有工作区改动，不提交、不归档。参考固定为 `/Users/kang/cc-switch` 的 `f29d0804b05ce374ee650c64706399cd0da01805`，读取其设计系统与本项目001公共UI契约。

本地检查将处理器、状态／副作用、IPC、选择目标、参数、校验、禁用条件、确认与取消语义作为功能边界；新增浮层组件只处理可用空间，不增加业务请求。真实网络／系统写入验证限制单独列出。

## Findings

以下问题已全部修复，无待处理的本地发现。

### P2: 长日志分类撑出弹窗，日志内容与操作被裁切

位置：[ProxyDetailedLogsDialog.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/proxy/ProxyDetailedLogsDialog.tsx:70)、[日志行分类](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/proxy/ProxyDetailedLogsDialog.tsx:687)。

800×600、60类长名称样例中，分类选择框原宽1366.89px、右边界1407.89px，超过弹窗右边界784px；日志行的分类也不收缩，挤走消息与复制按钮。原菜单受触发器宽度约105.5px限制，长选项大量折行，滚动高度26438px。此前几何验证只检查外层弹窗，没有检查内部可达性。

修复：触发器最大240px，保留完整名称title；日志分类限制160px并截断，消息允许收缩，原数据与复制内容不变。新建[ProxyDropdownMenu.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/proxy/ProxyDropdownMenu.tsx:4)，在原DOM内按弹窗／视口限制宽高和水平位置，保留外部点击与选择关闭边界。修复后菜单256px、边界385～641，底部532；触发器宽240px。验证最后一类选择、复制原日志、外部点击关闭、800↔1200调整和重置过滤通过。

### P3: 账号选择行仍使用旧字号、内距和无圆角行

位置：[AccountSelectDialog.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/proxy/AccountSelectDialog.tsx:181)。

名称原13/20、说明13/20、行内距16、圆角0，与参考供应商行14/20/500名称、12/18说明、10/12/10/8内距和10圆角不符；40px圆头像亦未对齐32px图标位。

修复：复用 ui-list-row／title／description，图标位32px、圆角8，选择态使用中性底色；实际账号、默认账号、搜索、状态／订阅／用量及原选择回调保持。修复后上述字体、内距、圆角均由真实DOM测量确认；选择集合回归通过。

### P3: 32px映射选择框仍保留16px纵向内衬，操作组间距只有4px

位置：[ModelMappingDialog.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/proxy/ModelMappingDialog.tsx:312)、[映射类型字段](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/proxy/ModelMappingDialog.tsx:369)。

迁移将选择框由40改为32高后仍保留上下各8px，扣除边框后文本可用高度仅14px；规则动作组gap4也不同于公共gap8。原上移／下移／删除和移除目标图标缺少可识别名称。

修复：原生select上下内衬归零，保持32高／13px文字／6圆角；动作和权重组间距8，补充原图标动作title。长模型名样例不增加横向溢出，测量gap8／padding0通过；映射保存的目标与权重、取消未保存修改回归通过。

### P3: 绑定指标与徽标字重、表头对齐未按角色统一

位置：[ProxyPoolPage.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/pages/ProxyPoolPage.tsx:1386)、[绑定徽标](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/pages/ProxyPoolPage.tsx:1536)、[表头](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/pages/ProxyPoolPage.tsx:1579)。

四个绑定指标仍为16/24局部标题，未使用24/32指标角色；手写绑定徽标缺少500字重；表头左内距12、数据行8，导致所有列水平错位4px。

修复：指标24/32/600，徽标11/16/500且20高；表头与行共用左8右12，保持原列宽与独立横向滚动。测量八列起点与宽度逐一相同；绑定／解绑、账号页联动、验活范围和61条虚拟滚动回归通过。

### P3: KProxy错误通知条仍使用旧内距和图文间距

位置：[KProxyPanel.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/kproxy/KProxyPanel.tsx:296)。

原内距上下8／左右16、gap8，与参考通知10/14/10/19、gap10不符；关闭按钮另有横向内衬覆盖。

修复：复用ui-notice和语义危险色，错误正文可收缩换行，关闭按钮28方。真实DOM测量圆角10、gap10、四边内距一致；关闭仅清除原错误状态，服务与证书动作不受影响。

## Preservation and validation

- 加强原源码守卫：补充useVirtualizer及不含JSX的函数声明，覆盖池健康聚合、数字格式与两类模块级单次订阅函数。822项结构均与改前源码相同，基线从原文件生成；未忽略事件、值、参数或禁用条件。
- 完整004验证包含原 `proxy`、`kproxy`、`pool`、`geometry` 与新增 `review` 阶段，真实renderer／Zustand搭配内存IPC。前四阶段覆盖P01～P08；review补充长分类、最后菜单项、复制、取消、通知、指标、徽标、表格列对齐及侧栏展开后的三页明暗模式。
- 几何覆盖中文／英文×明／暗×800×600／1200×1200三页与八类弹窗，跟随系统外观；001与CC Switch直接字体／几何对照回归通过。
- `npm run build`通过（包含node／web typecheck）；`npm run lint`为既有371 errors／7779 warnings，与审查前相同，按文件＋规则＋消息对比无新增error。`git diff --check`与OpenSpec严格校验通过。

证据目录：`/tmp/cc-proxies-review-20261126/`；改前测量`before/review.json`，修复后定向测量`after/review.json`，完整回归`full.log`和`final/`，构建`build.log`，lint及增量比较`lint.log`／`lint-comparison.json`，公共参考回归`foundations.log`。

## Independent review limitation

使用[openspec-dm-code-review技能](/Users/kang/.codex/skills/openspec-dm-code-review/SKILL.md)，按其“配置或调用失败时报告阻塞”要求记录限制，未将独立服务失败当作审查通过。

- CLI：v1.13.6-dm.1；配置模型innodealing／deepseek-v4.1-flash；未更改provider、密钥或模型配置。
- 初始工作区预览28项，其中22项可审查（14生产文件＋8验证文件），6项为显式排除或不支持的Markdown；exclude含`.openspec-local/**,openspec/baselines/**,openspec/pipelines/**`。
- 审查退出1，status failed，warnings字段未返回，comments null。manifest selected22／completed0／failed22／reused0／waived0；43次逻辑请求均在HTTP鉴权阶段403，tokens0／工具调用0。summary的files_reviewed22不代表成功覆盖。
- DM session：`ac488af7-8577-49bd-bc83-8b840b3b447d`；报告`/tmp/cc-proxies-review-20261126/result.json`，背景`background.md`。报告各项与全部请求记录已解析核对。服务失败后继续本地审查修复；新增布局组件与回归脚本没有独立DM成功覆盖。
- 排查入口：`dm-ocr config provider`、`dm-ocr llm test`。未重复重试同一鉴权错误。

真实CA安装／卸载、证书导出、客户端配置合并／备份／磁盘写入、模型／鉴权／配置接口E2E仍待可确认的隔离环境。本轮确认原IPC与流程保留，不声称实际外部或系统操作已验证。
