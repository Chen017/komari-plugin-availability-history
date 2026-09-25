export type NodeState = 'online' | 'offline';

export interface NodeStateEvent {
  schemaVersion: 1;
  type: 'node_state';
  nodeUuid: string;
  state: NodeState;
  at: string; // ISO string
  sessionId: string;
}

export interface ObserverGapEvent {
  schemaVersion: 1;
  type: 'observer_gap';
  from: string; // ISO string
  to: string; // ISO string
}

export type LedgerEvent = NodeStateEvent | ObserverGapEvent;

export interface ObserverCheckpoint {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string; // ISO string
  lastHeartbeatAt: string; // ISO string
  endedAt: string | null; // ISO string
  running: boolean;
}

export interface AvailabilityNodeSummary {
  uuid: string;
  currentState: string;
  trackingSince: string;
  onlineSeconds: number;
  offlineSeconds: number;
  observableSeconds: number;
  unobservedSeconds: number;
  coverageRatio: number;
  uptimeRatio: number | null;
  outageCount: number;
}

export interface AvailabilitySummaryResponse {
  schemaVersion: 1;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  observerCoverage: {
    observableSeconds: number;
    unobservedSeconds: number;
  };
  nodes: AvailabilityNodeSummary[];
}
