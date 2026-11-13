# Komari Availability History Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Komari Version](https://img.shields.io/badge/Komari-%3E%3D1.5.0-blue)](https://github.com/komari-monitor)
[![Theme Integration](https://img.shields.io/badge/Theme%20Integration-Komari%20Emerald%20Insights-emerald)](https://github.com/Chen017/komari-theme-emerald-insights)
[![Komari Emerald Ecosystem](https://img.shields.io/badge/Komari%20Emerald-Ecosystem-10b981)](https://github.com/Chen017/komari-emerald-suite)

> [!IMPORTANT]
> **前置说明与推荐搭配**：
> 1. **可独立运行**：本插件作为服务端后台数据采集与事件账本服务，基于 WebSocket 实时断连事件计算 30 天可用性并提供 REST API。插件**可完全独立安装与运行**，无需在被监控 VPS 额外安装采集脚本。
> 2. **强烈推荐搭配主题**：Komari 原生前端界面并不包含 30 天在线率图表与可用性条带。**强烈推荐搭配安装配套主题 [Komari Emerald Insights（翡翠洞察）](https://github.com/Chen017/komari-theme-emerald-insights)**，才能在前端「资源概览」与节点卡片中完整展示真正的 30 天在线率图表与可用性历史！

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

## 开发与维护

从项目根目录使用 Node.js 24 和 npm。包校验使用 Linux/macOS 的 `unzip` 或 Windows 自带的 `tar`。依赖版本由 `package-lock.json` 固定。

```sh
npm ci
npm run verify
npm run build:beta
```

`npm run verify` 依次执行类型检查、Node 测试、构建和安装包验证。单独调试可用 `npm test`、`npm run typecheck` 或 `npm run build`。测试使用临时数据目录和 Komari 接口替身。最终验收可将 ZIP 安装到测试 Komari，分别检查 Agent 连断、宽限期、重启后的未知区间和管理员 `health` 接口。

| 目录或文件 | 职责 |
| --- | --- |
| `src/index.ts`、`src/config.ts` | 加载与卸载、注册 Komari 接口、解析受管配置 |
| `src/tracker.ts`、`src/ledger.ts` | 连接事件、宽限期、JSONL 账本与观测者检查点 |
| `src/summary.ts`、`src/api.ts` | 可用性计算、对外查询和管理员诊断 |
| `build.mjs`、`komari-plugin.json` | 生成 Komari 可导入的 ZIP，维护插件标识、配置和版本 |
| `tests/` | 存储恢复、统计语义、连接状态和接口回归 |

### CI 与发布

GitHub Actions 在面向 `master` 的 PR、工程改动推送和手动触发时运行验证。手动运行完成后可下载验证过的安装包。正式发布前，用 `npm version <版本> --no-git-tag-version` 更新 npm 版本与锁文件，并同步 `komari-plugin.json`。推送 `master` 后，工作流检查 `v<版本>` 是否已有完整 ZIP。需要发布时，工作流校验标签指向该提交并复用同次验证生成的 `availability-history.zip`。

发布失败时先检查 Actions 日志。标签若已指向该提交，可重跑原工作流。若标签指向别的提交，核对版本是否被复用。PR 验证使用只读权限，仓库写权限由发布任务单独取得。

正式包保留 `komari-plugin.json`、`script.js` 和 `assets/icon.svg` 的相对路径。Beta 包名为 `availability-history-beta-<提交号>.zip`，只修改包内版本，便于识别测试安装。诊断接口使用该包的 manifest 版本。

### 兼容约定与故障排查

- `wsMessage` 在插件重载后识别已有连接。只关闭当前记录中的最后一个连接才启动离线宽限期，重复的关闭事件不会改写断开时间。对应 `tests/tracker.test.mjs` 和 `tests/lifecycle.test.mjs`。
- `events.jsonl` 由插件单独写入，首次追加或追加失败后检查残缺尾行。压缩保留窗口前锚点和最后一个旧观测缺口。重启期间及缺口后首次观测之前保持未知，统计先累加时长再舍入到秒。对应 `tests/persistence.test.mjs`、`tests/performance.test.mjs`、`tests/recovery_regressions.test.mjs` 和 `tests/summary.test.mjs`。
- 主题显示缺少数据时，先检查插件是否运行、Agent 是否在 `/api/clients/v2/rpc` 上有活动，以及查询传入的节点 UUID。管理员可检查 `health` 返回的存储位置、心跳、事件数和待确认离线数。插件写入失败时应检查 Komari 日志和存储目录权限。

---

## Komari Emerald Ecosystem

本插件是 **Komari Emerald Ecosystem** 的核心组件之一：

```text
                           Komari
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
 Availability History  CPU Steal Monitor  IPQA Alert Report
 WebSocket events      /proc/stat + API   Archive / Alerts
             │               │               ▲
             │               │               │ archive sync
             │               │         IP-Quality-Archive
             │               │           on monitored VPS
             └───────────────┼───────────────┘
                             ▼
                 Emerald Insights (可选)
```

- [Komari Emerald Suite](https://github.com/Chen017/komari-emerald-suite)：生态聚合展示主页
- [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights)：现代化前端监控主题
- [Komari Plugin: IPQA Alert Report](https://github.com/Chen017/komari-plugin-ipqa-alert-report)：IP 质量归档同步与告警报告插件
- [Line Quality Monitor](https://github.com/Chen017/komari-plugin-line-quality-monitor) · 按线路自动学习延迟与波动，复用 Komari 官方通知
- [Komari Plugin: CPU Steal Monitor](https://github.com/Chen017/komari-plugin-cpu-steal-monitor)：可独立采集 Linux CPU Steal 并提供历史/汇总 API；可选搭配 Emerald Insights 在 CPU/负载图中叠加 Steal%

---

## License

MIT
