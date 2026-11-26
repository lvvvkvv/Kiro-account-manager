# Proposal

## Why

当前导航与内容区是悬浮玻璃面板，页面标题、首页和全局弹窗缺少 CC Switch 式的紧凑层级。统一应用框架能让全部页面共享清晰的导航、操作区和任务反馈。

## What Changes

- 依赖 `cc-switch-ui-001-foundations`，改为贴边侧栏、细分隔线与一致的页面标题／操作区，首页收敛装饰并保留全部信息。
- 保留 15 个页面、初始折叠、深层跳转、窗口按钮、任务中心与现有后台生命周期。
- 调整全局关闭确认与更新弹窗外观，保留原事件、操作选项、下载进度和取消语义。

## Capabilities

### New Capabilities

- `app-shell`：主导航、窗口交互、全局任务及弹窗的可达性与生命周期。
- `home-overview`：首页指标、风险信息、当前账号与快捷操作的统一呈现。

### Modified Capabilities

无；当前尚无正式主规格。

## Impact

涉及应用目录内 `src/renderer/src/App.tsx` 的呈现部分、`components/layout/`、`pages/HomePage.tsx`、`UpdateDialog.tsx`、`CloseConfirmDialog.tsx`，必要时新增纯页面框架组件。不改 App 中现有后台订阅、main 窗口配置或托盘逻辑。保留清单 G01、G03～G07、H01～H02；本轮实施结果见 implementation.md。
