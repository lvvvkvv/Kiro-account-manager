# Proposal

## Why

注册和批量订阅页面同时包含配置、调度、进度与结果，现有长页面需要更一致的信息分区。交互可以参照 CC Switch，但必须保留原有批量工作流及所有高级参数。

## What Changes

- 依赖 001 与 002，统一注册的模式配置、运行控制、进度、失败诊断与结果／历史展示。
- 保留六种注册模式、手动阶段、混合权重、限速／退避／风控、定时／配额、模板和重试。
- 调整订阅三 Tab、选择工具栏、预检、链接管理、超额控制与批量结果的呈现。
- 保留注册结果进入账号与订阅链接列表的现有链路，保持任务中心回调和状态语义。

## Capabilities

### New Capabilities

- `registration-ui`：注册配置、阶段、调度参数、任务与结果的交互契约。
- `subscription-ui`：订阅方案、链接、超额及已订阅账号管理的交互契约。

### Modified Capabilities

无；当前尚无正式主规格。

## Impact

未来涉及 `Kiro-account-manager/src/renderer/src/components/pages/RegisterPage.tsx`、`SubscriptionPage.tsx`，可拆出纯呈现子组件。两文件的 module 状态、localStorage、任务回调、业务计算及 API 调用保持；不改注册实现、rateLimiter、store、计费或支付流程。保留清单 R01～R05、S01～S04；本轮仅规划。
