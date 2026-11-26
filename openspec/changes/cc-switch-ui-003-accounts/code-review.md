# 003 代码审查与修复

日期：2026-11-26。用户要求核对与 CC Switch 的字体、间距、圆角、尺寸及功能保留，发现问题直接修复。本地审查与修复已完成；独立 DM 审查因认证 HTTP 403 未获得有效覆盖，不能将本记录称为独立模型审查通过。

## Scope

- 仓库 `/Users/kang/Kiro-account-manager`，审查起始 HEAD `6bccfed5b83d8b032c1846820e0a5afb0c844f8f`，采用工作区范围（未暂存／暂存／未跟踪），不提交或归档。
- OpenSpec：`cc-switch-ui-003-accounts`，11/11 已完成；已读取 proposal、design、tasks、account-management-ui 规格和实施记录。
- 参考仓库 `/Users/kang/cc-switch`，固定 `f29d0804b05ce374ee650c64706399cd0da01805`。比对 design-system、Button、Dialog、SegmentedControl、ProviderCardActions 和 001 公共契约；不修改参考仓库。
- DM 预览 30 文件，24 可审查（14 源码＋10 验证文件），6 排除：`.openspec-local/**,openspec/baselines/**,openspec/pipelines/**` 以及不支持的 Markdown。新增修复仍限于账号呈现和测试；main／preload／store／协议／凭据结构／导入导出格式未修改。

## Findings

下列有效问题均已直接修复，无待处理的本地发现。

| 级别 | 问题与证据 | 修复 |
|---|---|---|
| P2 | 800×600 下长分组菜单 top=248、bottom=728，底部超过视口 128px；长标签／代理菜单分别到 606／634；高级筛选 left=-150.22。菜单自身滚动不能使视口外的底部与左侧操作可达。 | [AccountPopover.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AccountPopover.tsx:7) 仅负责按可用空间限高、横向避让与 resize 重算；四类菜单保持原 DOM 父子关系、外部点击和动作回调。实测全部边界留在 x=16～784、bottom≤584，分组／标签／代理末尾和筛选操作可用。 |
| P2 | 无邮箱账号回退显示昵称时，卡片、详情标题及身份字段仍显示 `Private Nickname`；开启隐私后原函数预期显示 `用户01569`，title 和正文不一致。 | [AccountCard.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AccountCard.tsx:572)、[AccountDetailDialog.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AccountDetailDialog.tsx:195) 的回退正文复用原 maskNickname。实测详情不再包含明文，主动复制仍为原 userId，不改算法、确认或复制内容。 |
| P3 | 分组菜单行使用无效 `rounded-control-panel`，实际 0px；标签名为 caption。部分身份／已验证／分组标签徽标仍为 12/18、22～24 高，计数／ACTIVE 左右内距仅 4。 | [AccountToolbar.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AccountToolbar.tsx:490) 恢复菜单行 13/20、6 圆角、30 最低高、8 图文间距，并为批量移动按钮保留空间。相关徽标统一 11/16、20 高、左右 7、胶囊；详情内的代理选择行也统一公共菜单尺度。 |
| P3 | 卡片／列表操作区 gap=2、图标 14，与参考 ProviderCardActions 的 gap=8、图标 16 不符。 | [AccountCard.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AccountCard.tsx:914)、[AccountListRow.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AccountListRow.tsx:585) 对齐 8 间距和 16 图标／1.5 描边，保留 28 方按钮。列表最小内容宽同步 1360→1480，维持 72 实体／82 估值及外层横滚，封禁＋绑定组合无裁切。 |
| P3 | OIDC 单个／批量分段没有 group／aria-pressed，选中背景依赖旧 background 样式，未使用公共分段状态；主分段也有旧背景和额外 ring 覆盖。 | [AddAccountDialog.tsx](/Users/kang/Kiro-account-manager/Kiro-account-manager/src/renderer/src/components/accounts/AddAccountDialog.tsx:1774) 接入 group 和原状态对应的 aria-pressed，保留切换回调与禁用条件，由公共样式提供选中 surface／小阴影。实测明暗两档选中背景等于 card，36／28、内衬 3、内角 7／5 保持。 |

验证盲点一并修正：补测 50 个分组／标签／代理、最末端动作、无邮箱隐私、明暗分段 surface、真实徽标和操作区计算值。源码指纹从 75 扩至 78，加入实际 `startPolling`、`toggleArrayFilter`、`setRangeFilter` 与正则字面量，移除“收集后又全部删除事件”的死代码和误导性注释；不再把指纹比较称为 JSX 事件连接验证，事件以组件点击测试为证。原只调用 `.count()` 的状态筛选检查改为真实点击后断言账号 ID。

并行验证曾因 Vite 默认缓存共用导致一次测试启动超时；003 验证器现为每个输出目录使用独立 cacheDir，已重新运行验证。此问题发生在测试启动阶段，不是账号业务异常。

## Validation

临时证据目录：`/tmp/cc-accounts-review-20261126`。`before/review-geometry.json`、`privacy-before/review-geometry.json` 保存修前值；`verified/` 与 `verified-review/` 保存修后截图和几何。验证只使用假账号和内存 IPC，不调用真实认证、代理或支付。

- 003 完整回归：`full.log`；账号筛选／选择、61 项虚拟滚动、16 页面组合、24 弹窗组合、四登录来源、显式取消／轮询／回调、OIDC／SSO 混合批次、两视图逐项／批量动作、代理／订阅联动、六导出格式固定样例及设置页复用均通过。
- 新增 review stage：`review-final.log`，覆盖菜单边界、最末端动作、78 项源码指纹、徽标／操作几何、分段表面与无邮箱隐私。最后的状态筛选组件点击补测见 `accounts-final.log`。
- 001 参考几何回归：`foundation.log`；八字体角色、圆角别名、设置行、分段、页签、弹窗与固定 CC Switch 源码实测一致，三档外观和旧配置回读通过。
- `npm run build`（含 node／web typecheck）通过；`npm run lint` 仍为 371 既有 error，按文件／规则／消息比对无新增，见 `lint-comparison.json`。
- `git diff --check`、6 个 change 的 `openspec validate --all --strict` 通过；任务保持 11/11，未归档。

## Independent Review

使用 [openspec-dm-code-review 技能](/Users/kang/.codex/skills/openspec-dm-code-review/SKILL.md)。按其“配置或调用失败时报告阻塞，并提供 `dm-ocr config provider`、`dm-ocr llm test` 排查入口”的要求记录失败；没有替换 provider／模型／密钥，也没有在同一认证失败下重复发起复审。

- CLI：`v1.13.6-dm.1`；provider `innodealing`，model `deepseek-v4.1-flash`。
- Session：`fff4ced3-bb5a-40c1-a1e0-e8a60ef6b4d7`；退出码 1，status failed，warnings 未提供，comments null。
- manifest：selected 24，completed 0，failed 24，reused／waived 0；46 次逻辑请求均为 authentication／HTTP 403，tokens／tool calls 为 0。summary 的 files_reviewed=24 不能视作有效审查覆盖。
- 背景、预览、完整报告：临时目录的 `background.md`、`preview.json`、`result.json`、`dm.log`。背景在仓库外、UTF-8、少于 8000 字符。

真实第三方认证、支付、IDE／CLI 磁盘写入和 Windows／Linux 原生窗口仍未实测；当前结论针对本地 renderer 与可控响应分支。没有发现本次改版新增的账号功能删减，但这些验证不替代线上服务及其它平台测试。
