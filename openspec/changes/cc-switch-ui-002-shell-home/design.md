# Design

## Context

App 以 `currentPage` 和 switch 渲染 15 页，外层 `ambient-bg`、`gap-2 p-2` 与 `rounded-3xl` 形成悬浮外壳。App 同时拥有刷新、托盘与事件订阅，不能将其生命周期与呈现一起重写。TitleBar 使用 Electron IPC，自绘 Windows/Linux 按钮，macOS 有原生按钮留位。任务中心有自己的 portal 与回调。

依赖 001 的 `ui-foundations` 规格和设计。参考 CC Switch 的 Sidebar、AppPageHeader；跨越外壳、首页和全局弹窗，需在实施前明确组件边界。

## Goals / Non-Goals

**Goals:** 建立可渐进接入的 PageHeader，统一窗口、导航、首页和全局浮层；G01、G03～G07、H01～H02 均有对应验收。

**Non-Goals:** 不引入路由库、供应商业务、导航偏好迁移或新后台机制；不改窗口最小尺寸与 main 配置。

## Decisions

1. **保留 Electron 标题栏，另设内容区页头。** TitleBar 继续承担平台窗口操作与任务入口；内容页头高 52px，左为图标／标题，右为操作。它继承 CC Switch 的对齐与密度，但不移植 Tauri 的拖动属性，也不为视觉一致性合并两种窗口机制。内容页头不重复放窗口按钮。
2. **导航保持原页面与初始状态。** 展开侧栏采用 200px，折叠保留本项目 64px；macOS 原生按钮已由上方标题栏独立留位，无需复制对方 76px 图标轨。侧栏中性选中态，图标提示沿原名称；维持原菜单顺序以便核对，不新增自动折叠条件。与参考项目尺寸的差异用于保持本项目窗口约束。
3. **分离框架能力和页面迁移。** 本成员提供 PageHeader 的 title、subtitle、actions 等纯呈现插槽，仅接入首页；003～006 分别替换其页面旧 hero，不在 002 一次修改全部页面。App 只移除外层间隙、圆角和装饰，保留 renderPage、key 和业务 effects。
4. **首页按概览分区。** 页面标题后放统计、风险摘要、用量／当前账号与原快捷入口；保留原字段、计算、告警阈值和外链。减少欢迎区占高但不删除其有用内容或改变默认首页。
5. **全局弹窗保持独立流程。** TaskCenter、CloseConfirmDialog 和 UpdateDialog 只调整呈现及操作层级；保留 portal、订阅清理和回调。不要照搬 CC Switch 对遮罩／Escape 的默认规则覆盖现有弹窗。

## Risks / Trade-offs

- [拖动区域阻断任务／窗口按钮] → 标题栏按钮保持 no-drag，逐平台核对；未实测平台单独待测。
- [调整 App 导致 effects 重挂载] → 限制差异到 JSX／class，比较事件订阅数量；无需抽离全局业务 effects。
- [小窗口导航项超高] → 继续保留侧栏独立滚动与折叠提示，不以隐藏页面解决。
- [任务入口只在有任务时出现] → 按现状保留，不为布局一致性新增空任务中心或改变显示条件。

## Migration Plan

在 001 后先改外壳，再加 PageHeader 并接入首页，最后迁移全局浮层。逐项比对保留清单与平台窗口操作，无数据迁移。回退对应呈现提交即可，不需要清理配置；002 稳定后再接入领域页面。
