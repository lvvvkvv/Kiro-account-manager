# Proposal

## Why

API 反代、KProxy 和代理池各有大量配置与状态，当前配色和操作布局不统一。需要在 CC Switch 的面板与表单体系下组织它们，同时保留全部服务控制及诊断能力。

## What Changes

- 依赖 001 与 002，统一三页标题、服务状态、配置分区、筛选和批量操作反馈。
- 调整模型、映射、客户端配置、API Key、安全和日志弹窗的外观与信息层级。
- 保留 KProxy 证书与设备操作、代理池解析／验活／调度／链路诊断及账号绑定。
- 启停、热更新或原有重启时机、API 参数和后台代理行为均保持。

## Capabilities

### New Capabilities

- `api-proxy-ui`：API 反代配置、状态、模型／客户端配置、API Key 与请求日志交互。
- `kproxy-ui`：KProxy 服务、设备 ID、证书和请求状态交互。
- `proxy-pool-ui`：代理条目管理、策略、验活、诊断和账号绑定交互。

### Modified Capabilities

无；当前尚无正式主规格。

## Impact

未来涉及应用 renderer 的 `pages/ProxyPage.tsx`、`KProxyPage.tsx`、`ProxyPoolPage.tsx`、`components/proxy/` 和 `components/kproxy/`。不修改 main 代理实现、网络策略、协议、证书权限流程或账号存储；003 的绑定入口继续共享现有数据。保留清单 P01～P08；本轮仅规划。
