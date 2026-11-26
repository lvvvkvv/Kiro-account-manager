# Spec Delta

## Purpose

为 Kiro IDE 配置提供一致的表单、分区与编辑弹窗，让用户继续管理 Agent、模型、MCP 服务、Steering 文件和命令规则；界面统一保留原配置字段、保存结构、文件操作及取消行为，维持与 IDE 的兼容。

## ADDED Requirements

### Requirement: 配置读取保存保持

Kiro 设置界面 SHALL 保留读取、刷新、保存、外部打开、可用模型加载和全部 Agent／命令信任／拒绝等字段，继续沿原显式保存或既有动作生效方式处理。

#### Scenario: 刷新并保存配置
- **WHEN** 用户读取现有配置、编辑原字段并执行保存
- **THEN** 保存字段、结构和验证等价，未通过保存的编辑不能被新布局额外自动提交

### Requirement: MCP 与 Steering 管理保持

界面 SHALL 保留 MCP 创建编辑删除及用户／工作区配置入口，Steering 创建默认规则、内部／外部编辑、删除和目录打开；各编辑器原保存、取消和错误反馈保持。

#### Scenario: 取消编辑服务或规则
- **WHEN** 用户在原 MCP 或 Steering 编辑流程中取消
- **THEN** 不执行原保存动作；确认保存、删除及外部打开仍使用原文件与配置范围
