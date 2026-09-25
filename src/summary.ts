import type {
  AvailabilityNodeSummary,
  AvailabilitySummaryResponse,
  LedgerEvent,
  NodeStateEvent,
} from './types.ts';

interface Interval {
  startMs: number;
  endMs: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function calculateAvailabilitySummary(
  events: LedgerEvent[],
  requestedUuids: string[],
  windowStart: Date,
  windowEnd: Date
): AvailabilitySummaryResponse {
  const windowStartMs = windowStart.getTime();
  const windowEndMs = windowEnd.getTime();
  const windowDurationSeconds = Math.max(1, Math.round((windowEndMs - windowStartMs) / 1000));

  // 1. Observer coverage
  const rawGaps: Interval[] = [];

  // Determine earliest observer tracking timestamp from events
  let earliestObserverMs: number | null = null;
  for (const ev of events) {
    const t = ev.type === 'node_state' ? Date.parse(ev.at) : Date.parse(ev.from);
    if (Number.isFinite(t)) {
      if (earliestObserverMs === null || t < earliestObserverMs) {
        earliestObserverMs = t;
      }
    }
  }

  if (earliestObserverMs === null) {
    // No events at all -> entire window is unobserved
    rawGaps.push({ startMs: windowStartMs, endMs: windowEndMs });
  } else if (earliestObserverMs > windowStartMs) {
    // Observer started tracking after windowStart -> pre-tracking period is unobserved
    rawGaps.push({
      startMs: windowStartMs,
      endMs: Math.min(earliestObserverMs, windowEndMs),
    });
  }

  for (const ev of events) {
    if (ev.type === 'observer_gap') {
      const fromMs = Date.parse(ev.from);
      const toMs = Date.parse(ev.to);
      const overlapStart = Math.max(fromMs, windowStartMs);
      const overlapEnd = Math.min(toMs, windowEndMs);
      if (overlapEnd > overlapStart) {
        rawGaps.push({ startMs: overlapStart, endMs: overlapEnd });
      }
    }
  }

  const mergedGaps = mergeIntervals(rawGaps);
  let totalUnobservedSeconds = 0;
  for (const gap of mergedGaps) {
    totalUnobservedSeconds += Math.round((gap.endMs - gap.startMs) / 1000);
  }
  const globalObservableSeconds = Math.max(0, windowDurationSeconds - totalUnobservedSeconds);

  // 2. Node summaries
  const nodeSummaries: AvailabilityNodeSummary[] = [];

  for (const uuid of requestedUuids) {
    if (!uuid) continue;

    const nodeEvents: NodeStateEvent[] = [];
    for (const ev of events) {
      if (ev.type === 'node_state' && ev.nodeUuid === uuid) {
        nodeEvents.push(ev);
      }
    }

    if (nodeEvents.length === 0) {
      nodeSummaries.push({
        uuid,
        currentState: 'unknown',
        trackingSince: new Date(windowEndMs).toISOString(),
        onlineSeconds: 0,
        offlineSeconds: 0,
        observableSeconds: 0,
        unobservedSeconds: windowDurationSeconds,
        coverageRatio: 0,
        uptimeRatio: null,
        outageCount: 0,
      });
      continue;
    }

    nodeEvents.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const firstEventAt = Date.parse(nodeEvents[0]!.at);
    const trackingSince = nodeEvents[0]!.at;

    // Timeline calculation:
    // Any point in time is classified into:
    // ONLINE, OFFLINE, UNOBSERVED, OUTSIDE_TRACKING
    // Gaps invalidate state until a subsequent node_state re-anchors it.

    // Gather all critical timestamps within window
    const timestamps = new Set<number>();
    timestamps.add(windowStartMs);
    timestamps.add(windowEndMs);

    for (const ev of nodeEvents) {
      const atMs = Date.parse(ev.at);
      if (atMs >= windowStartMs && atMs <= windowEndMs) {
        timestamps.add(atMs);
      }
    }

    for (const gap of mergedGaps) {
      timestamps.add(gap.startMs);
      timestamps.add(gap.endMs);
    }

    const sortedTimes = Array.from(timestamps).sort((a, b) => a - b);

    let onlineSeconds = 0;
    let offlineSeconds = 0;

    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const segStart = sortedTimes[i]!;
      const segEnd = sortedTimes[i + 1]!;
      const segDuration = Math.round((segEnd - segStart) / 1000);
      if (segDuration <= 0) continue;

      const segMid = segStart + (segEnd - segStart) / 2;

      // 1. Before first ever observation -> OUTSIDE_TRACKING
      if (segMid < firstEventAt) {
        continue;
      }

      // 2. Check if segMid is inside any observer gap -> UNOBSERVED
      const inGap = mergedGaps.some((g) => segMid >= g.startMs && segMid <= g.endMs);
      if (inGap) {
        continue;
      }

      // 3. Check latest node_state before segMid
      let lastNodeEvent: NodeStateEvent | null = null;
      for (let j = nodeEvents.length - 1; j >= 0; j--) {
        const ev = nodeEvents[j]!;
        if (Date.parse(ev.at) <= segMid) {
          lastNodeEvent = ev;
          break;
        }
      }

      if (!lastNodeEvent) {
        continue;
      }

      // 4. Check if there was any observer gap between lastNodeEvent and segMid
      // If there was a gap, continuity was broken and state is UNOBSERVED until a new event anchors it
      const lastEventMs = Date.parse(lastNodeEvent.at);
      const gapBetween = events.some((ev) => {
        if (ev.type !== 'observer_gap') return false;
        const gapTo = Date.parse(ev.to);
        const gapFrom = Date.parse(ev.from);
        // Gap ended after last event and before segMid
        return gapTo > lastEventMs && gapFrom < segMid;
      });

      if (gapBetween) {
        continue;
      }

      if (lastNodeEvent.state === 'online') {
        onlineSeconds += segDuration;
      } else if (lastNodeEvent.state === 'offline') {
        offlineSeconds += segDuration;
      }
    }

    // Count confirmed outages overlapping query window
    let outageCount = 0;
    for (let i = 0; i < nodeEvents.length; i++) {
      const ev = nodeEvents[i]!;
      if (ev.state === 'offline') {
        if (i > 0 && nodeEvents[i - 1]!.state === 'offline') {
          continue;
        }
        const offlineStartMs = Date.parse(ev.at);
        let offlineEndMs = windowEndMs;
        for (let j = i + 1; j < nodeEvents.length; j++) {
          if (nodeEvents[j]!.state === 'online') {
            offlineEndMs = Date.parse(nodeEvents[j]!.at);
            break;
          }
        }
        if (offlineStartMs < windowEndMs && offlineEndMs > windowStartMs) {
          outageCount++;
        }
      }
    }

    const observableSeconds = onlineSeconds + offlineSeconds;
    const unobservedSeconds = Math.max(0, windowDurationSeconds - observableSeconds);
    const coverageRatio = Number((observableSeconds / windowDurationSeconds).toFixed(4));
    const uptimeRatio =
      observableSeconds > 0 ? Number((onlineSeconds / observableSeconds).toFixed(4)) : null;

    const latestEvent = nodeEvents[nodeEvents.length - 1]!;
    const latestEventAtMs = Date.parse(latestEvent.at);

    // Section 12-13: currentState becomes unknown if an observer gap occurred after latest node event
    const hasGapAfter = events.some((ev) => {
      if (ev.type !== 'observer_gap') return false;
      const gapFromMs = Date.parse(ev.from);
      const gapToMs = Date.parse(ev.to);
      return (gapFromMs > latestEventAtMs || gapToMs > latestEventAtMs) && gapFromMs < windowEndMs;
    });
    const currentState = hasGapAfter ? 'unknown' : latestEvent.state;

    nodeSummaries.push({
      uuid,
      currentState,
      trackingSince,
      onlineSeconds,
      offlineSeconds,
      observableSeconds,
      unobservedSeconds,
      coverageRatio,
      uptimeRatio,
      outageCount,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    observerCoverage: {
      observableSeconds: globalObservableSeconds,
      unobservedSeconds: totalUnobservedSeconds,
    },
    nodes: nodeSummaries,
  };
}
