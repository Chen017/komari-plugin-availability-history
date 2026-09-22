export interface PluginConfig {
  offlineGraceSeconds: number;
  retentionDays: number;
  observerHeartbeatSeconds: number;
}

export function parsePluginConfig(raw?: Record<string, any>): PluginConfig {
  let offlineGrace = Number(raw?.offline_grace_seconds ?? 180);
  if (!Number.isFinite(offlineGrace) || offlineGrace < 30 || offlineGrace > 600) {
    offlineGrace = 180;
  }

  let retentionDays = Number(raw?.retention_days ?? 90);
  if (!Number.isFinite(retentionDays) || retentionDays < 30 || retentionDays > 365) {
    retentionDays = 90;
  }

  let heartbeat = Number(raw?.observer_heartbeat_seconds ?? 30);
  if (!Number.isFinite(heartbeat) || heartbeat < 10 || heartbeat > 120) {
    heartbeat = 30;
  }

  return {
    offlineGraceSeconds: offlineGrace,
    retentionDays,
    observerHeartbeatSeconds: heartbeat,
  };
}
