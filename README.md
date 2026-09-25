# Komari Availability History Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Komari Version](https://img.shields.io/badge/Komari-%3E%3D1.5.0-blue)](https://github.com/komari-monitor)
[![Theme Integration](https://img.shields.io/badge/Theme%20Integration-Komari%20Emerald%20Insights-emerald)](https://github.com/Chen017/komari-theme-emerald-insights)
[![Komari Emerald Ecosystem](https://img.shields.io/badge/Komari%20Emerald-Ecosystem-10b981)](https://github.com/Chen017/komari-emerald-suite)

> 基于事件账本的 Komari 在线率历史与 30 天可用性 API，原生适配 Komari Emerald Insights。  
---

## 核心特性

- **基于事件**：通过 `/api/clients/v2/rpc` WebSocket 连接事件记录真实上线与离线。
- **防止 Flapping 抖动**：默认 180 秒离线宽限期，短时网络抖动不记录故障；确认故障后记录实际断开时间点。
- **排除服务端维护停机**：Komari 服务端或插件重启自动记录 `observer_gap`，标记为 `UNOBSERVED`，绝不计入 VPS 节点宕机时间。
- **持久化**：使用 Komari 提供的长期插件存储目录 `__storageDir__`，插件升级或重新安装不会丢失历史数据。
- **适配 Komari Emerald Insights**：直接提供 `GET /api/plugin/availability-history/v1/summary`，由插件计算 30 天可用性，前端仅负责渲染。

---

## Komari Emerald Insights 集成

推荐搭配 [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights) 使用，可在 Resource Insights 中直接查看 30 天在线率。

- **调用接口**：`GET /api/plugin/availability-history/v1/summary`
- **优雅降级**：若未安装本插件，Komari Emerald Insights 主题的其他监控、流量与成本功能仍可正常使用，仅在线率卡片展示安装指引。

---

## 安装方式

1. 在 GitHub Releases 页面下载 `availability-history.zip`。
2. 登录 Komari 管理后台，进入 **「插件管理」** 页面点击上传并安装。
3. 插件安装后将自动监听 Agent 连接事件，并向前端主题提供在线率汇总接口。

---

## 配置项

在 Komari 插件配置面板中可调整以下参数：

| 配置项 | 默认值 | 范围 | 说明 |
| :--- | :--- | :--- | :--- |
| `offline_grace_seconds` | `180` | 30–600 秒 | 节点断连宽限期，在此时间内重连不计为离线宕机 |
| `retention_days` | `90` | 30–365 天 | 历史事件保留天数 |
| `observer_heartbeat_seconds` | `30` | 10–120 秒 | 监控者心跳间隔 |

---

## 数据持久化

插件使用 Komari 提供的长期插件存储目录 `__storageDir__`。

在标准 Docker 部署中通常位于：

`/app/data/plugin-data/availability-history`

事件账本保存在该目录中，因此插件升级或重新安装不会清除历史在线率数据。

---

## API 端点

- `GET /api/plugin/availability-history/v1/summary?days=30&uuids=uuid1,uuid2` (公开，供主题卡片消费)
- `GET /api/plugin/availability-history/v1/events?uuid=...&limit=100` (管理员权限)
- `GET /api/plugin/availability-history/v1/health` (管理员权限)

---

## Komari Emerald Ecosystem

本插件是 **Komari Emerald Ecosystem** 的核心组件之一：

```text
                         Komari
                            │
               ┌────────────┴────────────┐
               │                         │
               ▼                         ▼
   Availability History          IPQA Alert Report
   WebSocket event ledger        Archive / API / Alerts
   (★ 本项目)                            │
                                         ▼
                               IP-Quality-Archive
                               on monitored VPS
               │                         │
               └────────────┬────────────┘
                            ▼
                Komari Emerald Insights
                    Resource Insights
```

- [Komari Emerald Suite](https://github.com/Chen017/komari-emerald-suite)：生态聚合展示主页
- [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights)：现代化前端监控主题
- [Komari Plugin: IPQA Alert Report](https://github.com/Chen017/komari-plugin-ipqa-alert-report)：IP 质量归档同步与告警报告插件

---

## License

MIT
