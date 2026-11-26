# Proposal

## Why

当前应用的玻璃态、蓝紫渐变、大圆角与 CC Switch v7 的中性实色界面差异明显。先统一视觉与通用控件交互，为其余五个变更提供一致且兼容现有功能的基础。

## What Changes

- 建立明暗两套中性背景、文字、边框与语义状态 Token，默认操作色对齐 CC Switch 橙色。
- 统一按钮、卡片、输入、选择、开关、徽标、进度与弹层的尺寸、层级和反馈，移除玻璃模糊与装饰性发光。
- 保留现有控件属性、事件、disabled／loading 与账号隐私遮罩；按用户最新决定将外观设置对齐 CC Switch 的跟随系统／浅色／深色，语言只保留中文／英文，删除多色主题和自动语言选项。
- 只提供通用弹层外观与呈现约定；领域关闭、保存、确认、取消等业务规则仍由调用方决定。

## Capabilities

### New Capabilities

- `ui-foundations`：应用公共视觉规范、主题兼容与基础控件呈现契约。当前没有主规格，此项是首次建立 UI 契约，并非新增业务功能。

### Modified Capabilities

无。

## Impact

实施代码范围为 `src/renderer/src/styles/globals.css`、`components/ui/`，必要时增加纯呈现辅助组件。基础 DOM 和自绘控件需兼容现有调用方；不替换技术栈、不添加 CC Switch 业务、不修改 main／preload、凭据或持久化字段结构；store 仅调整外观和语言的选项解析与生效逻辑。基线见 `../../baselines/cc-switch-ui-function-preservation.md` 的 G02 及全局保留口径。
