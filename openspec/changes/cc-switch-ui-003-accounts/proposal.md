# Proposal

## Why

账号页操作密集，卡片、列表、筛选和多个弹窗的视觉层级需要与 CC Switch 统一。改版必须同时保留全部登录、导入导出、切换、批量操作及跨领域入口。

## What Changes

- 依赖 001 与 002，统一账号标题／工具栏、分组 Tab、筛选区、选择态和批量操作区。
- 调整卡片／列表的信息层级与状态反馈，保留两种视图及偏好、现有选择和账号动作。
- 改版添加、编辑、详情、分组、标签及导出弹窗；保留所有输入、格式、登录回调和取消流程。
- 保留代理绑定与订阅入口；不迁移业务处理或新增账号能力。

## Capabilities

### New Capabilities

- `account-management-ui`：账号浏览、选择、登录、导入导出及逐项／批量操作的交互契约。

### Modified Capabilities

无；当前尚无正式主规格。

## Impact

本次涉及 `src/renderer/src/components/accounts/`。`ExportDialog` 在本成员统一调整，设置页继续复用；003 不修改代理池页面、订阅页、store、登录 API、凭据结构或文件解析规则。保留清单 A01～A07；本次经用户授权实施，结果见 implementation.md。
