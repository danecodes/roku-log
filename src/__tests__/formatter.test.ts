import { describe, it, expect } from 'vitest';
import { LogFormatter } from '../formatter.js';
import type { LogEntry, BrightScriptError, Backtrace, BeaconEntry } from '../types.js';

const RESET = '\x1b[0m';

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('LogFormatter', () => {
  describe('with color enabled', () => {
    const formatter = new LogFormatter({ color: true });

    it('colors error entries red', () => {
      const entry: BrightScriptError = {
        type: 'error',
        raw: 'BRIGHTSCRIPT: ERROR: oops in pkg:/foo.brs(1)',
        message: 'oops',
        errorClass: 'oops',
        source: { file: 'pkg:/foo.brs', line: 1 },
      };
      const output = formatter.format(entry);
      expect(output).toContain('\x1b[31m');
      expect(output).toContain(RESET);
      expect(stripAnsi(output)).toBe(entry.raw);
    });

    it('colors crash entries red bold', () => {
      const entry: Backtrace = {
        type: 'crash',
        raw: 'STOP in pkg:/foo.brs(10)',
        message: 'STOP in pkg:/foo.brs(10)',
        frames: [],
      };
      const output = formatter.format(entry);
      expect(output).toContain('\x1b[1;31m');
      expect(stripAnsi(output)).toBe(entry.raw);
    });

    it('colors beacon entries yellow', () => {
      const entry: BeaconEntry = {
        type: 'beacon',
        raw: '09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s',
        message: '09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s',
        event: 'AppLaunchComplete',
        duration: 1.88,
      };
      const output = formatter.format(entry);
      expect(output).toContain('\x1b[33m');
      expect(stripAnsi(output)).toBe(entry.raw);
    });

    it('colors source tags cyan in info lines', () => {
      const entry: LogEntry = {
        type: 'info',
        raw: '09/15 14:02:33.100 [scrpt.cmn.main.brs] HomeScene created',
        message: 'HomeScene created',
        timestamp: new Date(),
        source: { file: 'scrpt.cmn.main.brs', line: 0 },
      };
      const output = formatter.format(entry);
      expect(output).toContain('\x1b[36m');
      expect(stripAnsi(output)).toBe(entry.raw);
    });
  });

  describe('with color disabled', () => {
    const formatter = new LogFormatter({ color: false });

    it('returns raw text unmodified', () => {
      const entry: LogEntry = {
        type: 'error',
        raw: 'BRIGHTSCRIPT: ERROR: oops',
        message: 'oops',
      };
      expect(formatter.format(entry)).toBe(entry.raw);
    });
  });

  describe('formatWithContext', () => {
    it('returns formatted entry', () => {
      const formatter = new LogFormatter({ color: false });
      const entry: LogEntry = {
        type: 'info',
        raw: 'hello',
        message: 'hello',
      };
      expect(formatter.formatWithContext(entry)).toBe('hello');
    });
  });
});
