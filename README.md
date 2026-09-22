# Komari Availability History Plugin

> 节点在线率历史账本与 30 天可用性计算插件 for [Komari](https://github.com/komari-monitor/komari).

## 核心特性

- **基于事件，而非指标推断**：通过 `/api/clients/v2/rpc` WebSocket 连接事件记录真实上线与离线，不再从 CPU 时序或降采样桶中推测在线率。
- **防止 Flapping 抖动**：默认 180 秒离线宽限期，短时网络抖动不记录故障；确认故障后记录实际断开时间点。
- **排除服务端维护停机**：Komari 服务端或插件重启自动记录 `observer_gap`，标记为 `UNOBSERVED`，绝不计入 VPS 节点宕机时间。
- **持久化隔离**：事件账本保存在外部持久化目录（默认 `/app/data/plugin-state/availability-history`），插件重新安装或升级历史数据不丢失。
- **完全对齐 Emerald 主题**：直接提供 `GET /api/plugin/availability-history/v1/summary`，由插件计算 30 天可用性，前端仅负责渲染。

## 安装方式

1. 下载 `availability-history.zip`。
2. 在 Komari 管理后台的 **插件管理** 页面点击上传并安装。
3. 插件安装后将自动监听 Agent 连接，并向前端主题提供在线率汇总接口。

## 配置项

- `offline_grace_seconds` (默认 180): 节点断连宽限期（秒），范围 30–600。
- `retention_days` (默认 90): 历史事件保留天数，范围 30–365。
- `observer_heartbeat_seconds` (默认 30): 监控者心跳间隔，范围 10–120。
- `storage_path` (默认 `/app/data/plugin-state/availability-history`): 数据持久化存储路径。

## API 端点

- `GET /api/plugin/availability-history/v1/summary?days=30&uuids=uuid1,uuid2` (公开，供主题卡片消费)
- `GET /api/plugin/availability-history/v1/events?uuid=...&limit=100` (管理员权限)
- `GET /api/plugin/availability-history/v1/health` (管理员权限)

## 开发与构建

```bash
# 运行单元测试
npm test

# 构建 script.js 与 availability-history.zip
npm run build
```

## License

MIT
