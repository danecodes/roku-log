import { describe, it, expect } from 'vitest';
import { LogSession } from '../session.js';
import { LogParser } from '../parser.js';
import type { BrightScriptError, Backtrace, BeaconEntry } from '../types.js';

const MIXED_LOG = `09/15 14:02:31.123 [beacon.header] AppLaunchInitiate >>>
09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s
09/15 14:02:33.100 [scrpt.cmn.main.brs] HomeScene created
BRIGHTSCRIPT: ERROR: Use of uninitialized variable. (runtime error &hec) in pkg:/components/SearchScreen.brs(156)
09/15 14:02:34.500 [scrpt.cmn.network.brs] HTTP 200: https://api.example.com/feed
Runtime Error (cyclic value) in pkg:/source/utils/Logger.brs(34)
STOP in pkg:/components/VideoPlayer.brs(87)

Local Variables:
video            roSGNode (Video)
`;

function buildSession() {
  const parser = new LogParser();
  const session = new LogSession();
  session.addAll(parser.parse(MIXED_LOG));
  return session;
}

describe('LogSession', () => {
  it('collects entries', () => {
    const session = buildSession();
    expect(session.all.length).toBeGreaterThan(0);
  });

  it('filters errors', () => {
    const session = buildSession();
    expect(session.errors).toHaveLength(2);
    expect(session.errors.every((e) => e.type === 'error')).toBe(true);
  });

  it('filters crashes', () => {
    const session = buildSession();
    expect(session.crashes).toHaveLength(1);
    expect(session.crashes[0].type).toBe('crash');
  });

  it('filters beacons', () => {
    const session = buildSession();
    expect(session.beacons).toHaveLength(2);
  });

  it('filters by type', () => {
    const session = buildSession();
    const infoEntries = session.filter({ type: 'info' });
    expect(infoEntries.every((e) => e.type === 'info')).toBe(true);
  });

  it('filters by file', () => {
    const session = buildSession();
    const results = session.filter({ file: 'SearchScreen.brs' });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('error');
  });

  it('filters by timestamp', () => {
    const session = buildSession();
    const allEntries = session.all;
    const timestamped = allEntries.filter((e) => e.timestamp);
    if (timestamped.length >= 2) {
      const since = timestamped[1].timestamp!;
      const filtered = session.filter({ since });
      expect(filtered.every((e) => e.timestamp && e.timestamp >= since)).toBe(true);
    }
  });

  it('searches text across messages and raw', () => {
    const session = buildSession();
    const results = session.search('uninitialized');
    expect(results.length).toBeGreaterThan(0);
  });

  it('produces a summary', () => {
    const session = buildSession();
    const summary = session.summary();
    expect(summary.errorCount).toBe(2);
    expect(summary.crashCount).toBe(1);
    expect(summary.beaconCount).toBe(2);
    expect(summary.launchTime).toBe(1.88);
    expect(summary.uniqueErrors.length).toBeGreaterThan(0);
  });

  it('produces a scoped summary with since/until', () => {
    const session = buildSession();
    const beacons = session.beacons;
    // Scope to only the first beacon's timestamp — should exclude later entries
    const summary = session.summary({
      since: beacons[0].timestamp!,
      until: beacons[0].timestamp!,
    });
    expect(summary.beaconCount).toBe(1);
    // Errors don't have timestamps so they won't appear in a time-scoped summary
    expect(summary.errorCount).toBe(0);
  });

  it('exports to JSON', () => {
    const session = buildSession();
    const json = session.toJSON() as any;
    expect(json.entries).toBeInstanceOf(Array);
    expect(json.summary).toBeDefined();
  });

  it('exports to text', () => {
    const session = buildSession();
    const text = session.toText();
    expect(text).toContain('AppLaunchComplete');
    expect(text).toContain('BRIGHTSCRIPT');
  });

  it('clears entries', () => {
    const session = buildSession();
    session.clear();
    expect(session.all).toHaveLength(0);
  });

  describe('getBeacons', () => {
    it('returns all beacons with no filter', () => {
      const session = buildSession();
      expect(session.getBeacons()).toHaveLength(2);
    });

    it('filters beacons by since', () => {
      const session = buildSession();
      const allBeacons = session.beacons;
      const since = allBeacons[0].timestamp!;
      // "since" is inclusive of the first beacon's timestamp, so both should match
      const filtered = session.getBeacons({ since });
      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(filtered.every((b) => b.timestamp! >= since)).toBe(true);
    });

    it('filters beacons by until', () => {
      const session = buildSession();
      const allBeacons = session.beacons;
      const until = allBeacons[0].timestamp!;
      const filtered = session.getBeacons({ until });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].event).toBe('AppLaunchInitiate');
    });

    it('filters beacons by since and until', () => {
      const session = buildSession();
      const allBeacons = session.beacons;
      const filtered = session.getBeacons({
        since: allBeacons[0].timestamp!,
        until: allBeacons[1].timestamp!,
      });
      expect(filtered).toHaveLength(2);
    });
  });

  it('filters by until timestamp', () => {
    const session = buildSession();
    const allEntries = session.all;
    const timestamped = allEntries.filter((e) => e.timestamp);
    if (timestamped.length >= 2) {
      const until = timestamped[0].timestamp!;
      const filtered = session.filter({ until });
      expect(filtered.every((e) => e.timestamp && e.timestamp <= until)).toBe(true);
    }
  });

  it('add works incrementally', () => {
    const session = new LogSession();
    session.add({ type: 'info', raw: 'test', message: 'test' });
    expect(session.all).toHaveLength(1);
  });
});
