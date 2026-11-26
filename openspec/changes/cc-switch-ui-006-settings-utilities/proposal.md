# Proposal

## Why

机器码、Kiro 配置、运维工具与设置等八页仍使用不同的卡片、表单和反馈样式。需要完成全应用一致性，同时保护配置兼容和原有系统操作。

## What Changes

- 依赖 001 与 002，将八页接入共同标题、表单分组、状态与操作层级。
- 保留机器码、Kiro 设置及 MCP／Steering 编辑、Webhook、诊断及账号后处理。
- 保留独立配置同步页的加解密及设置页内嵌同步各自格式和导入方式，保留日志筛选／滚动／导出、全部应用设置及关于页内容。
- 复用 003 的账号导出弹窗，保留 002 管理的全局更新与关闭流程；不重复建设公共控件。

## Capabilities

### New Capabilities

- `settings-ui`：应用设置的分组、外观偏好、内嵌配置同步和持久化兼容交互。
- `machine-identity-ui`：设备机器码、备份恢复、账号绑定和历史交互。
- `kiro-configuration-ui`：Kiro 设置、MCP、Steering 和命令配置编辑交互。
- `webhook-ui`：通知渠道、事件配置和测试操作交互。
- `diagnostics-ui`：网络诊断、账号存活测试、报告与账号后处理交互。
- `config-transfer-ui`：配置导入导出、加解密与重置交互。
- `system-logs-ui`：系统日志过滤、滚动、详情与导出清理交互。
- `about-ui`：版本、外链、更新查询与辅助内容交互。

### Modified Capabilities

无；当前尚无正式主规格。

## Impact

实施涉及 renderer 的八个对应 `pages/*Page.tsx` 与 `components/kiro/`。领域弹窗只调整呈现；不改系统机器码、文件写入、存储格式、Webhook 发送机制、诊断逻辑或更新服务。保留清单 U01～U10；实施与验证结果见 implementation.md。
