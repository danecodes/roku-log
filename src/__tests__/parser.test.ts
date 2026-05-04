import { describe, it, expect } from 'vitest';
import { LogParser, parseConsoleForIssues } from '../parser.js';
import type { BrightScriptError, Backtrace, BeaconEntry, CompileEntry } from '../types.js';

const SAMPLE_LOG = `BrightScript Micro Debugger.
Connected to port 8085.

------ Running dev 'MyApp' main ------
BRIGHTSCRIPT: ERROR: roSGNode: CallFunc: No such function "invalidMethod" available on type "HomeScene":
   file/line: pkg:/components/HomeScene.brs(42)

------ Compiling dev 'MyApp' ------
09/15 14:02:31.123 [beacon.header] AppLaunchInitiate >>>
09/15 14:02:31.456 [beacon.report] AppCompileInitiate >>>
09/15 14:02:32.789 [beacon.report] AppCompileComplete >>> 1.33s
09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s
09/15 14:02:33.100 [scrpt.cmn.main.brs] HomeScene created
09/15 14:02:33.200 [scrpt.cmn.main.brs] Loading content feed...
09/15 14:02:34.500 [scrpt.cmn.network.brs] HTTP 200: https://api.example.com/feed
09/15 14:02:35.100 [scrpt.cmn.main.brs] Feed loaded: 12 items`;

const CRASH_LOG = `STOP in pkg:/components/VideoPlayer.brs(87)

Backtrace:
#0  Function videoplayerscreen$pressedplay() As Void
     file/line: pkg:/components/VideoPlayer.brs(87)
#1  Function callbackrouter() As Void
     file/line: pkg:/source/utils/CallbackRouter.brs(23)

Current Function:
087:    m.video.control = "play"

Local Variables:
video            roSGNode (Video)
contentNode      roSGNode (ContentNode)
`;

describe('LogParser', () => {
  describe('timestamped lines', () => {
    it('parses timestamp and source from log lines', () => {
      const parser = new LogParser();
      const entries = parser.parse('09/15 14:02:33.100 [scrpt.cmn.main.brs] HomeScene created');
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('info');
      expect(entries[0].message).toBe('HomeScene created');
      expect(entries[0].timestamp).toBeInstanceOf(Date);
      expect(entries[0].source?.file).toBe('scrpt.cmn.main.brs');
    });
  });

  describe('BrightScript errors', () => {
    it('parses single-line BRIGHTSCRIPT ERROR with file ref', () => {
      const parser = new LogParser();
      const entries = parser.parse(
        'BRIGHTSCRIPT: ERROR: Use of uninitialized variable. (runtime error &hec) in pkg:/components/SearchScreen.brs(156)',
      );
      expect(entries).toHaveLength(1);
      const err = entries[0] as BrightScriptError;
      expect(err.type).toBe('error');
      expect(err.source.file).toBe('pkg:/components/SearchScreen.brs');
      expect(err.source.line).toBe(156);
      expect(err.errorCode).toBe('&hec');
    });

    it('parses multi-line BRIGHTSCRIPT ERROR with file/line on next line', () => {
      const parser = new LogParser();
      const input = [
        'BRIGHTSCRIPT: ERROR: roSGNode: CallFunc: No such function "invalidMethod" available on type "HomeScene":',
        '   file/line: pkg:/components/HomeScene.brs(42)',
      ].join('\n');
      const entries = parser.parse(input);
      expect(entries).toHaveLength(1);
      const err = entries[0] as BrightScriptError;
      expect(err.type).toBe('error');
      expect(err.source.file).toBe('pkg:/components/HomeScene.brs');
      expect(err.source.line).toBe(42);
    });

    it('parses Runtime Error lines', () => {
      const parser = new LogParser();
      const entries = parser.parse(
        'Runtime Error (cyclic value) in pkg:/source/utils/Logger.brs(34)',
      );
      expect(entries).toHaveLength(1);
      const err = entries[0] as BrightScriptError;
      expect(err.type).toBe('error');
      expect(err.errorClass).toBe('cyclic value');
      expect(err.source.file).toBe('pkg:/source/utils/Logger.brs');
      expect(err.source.line).toBe(34);
    });
  });

  describe('crash / backtrace', () => {
    it('parses a full crash block with backtrace, current function, and variables', () => {
      const parser = new LogParser();
      const entries = parser.parse(CRASH_LOG);

      const crashes = entries.filter((e): e is Backtrace => e.type === 'crash');
      expect(crashes).toHaveLength(1);

      const crash = crashes[0];
      expect(crash.source?.file).toBe('pkg:/components/VideoPlayer.brs');
      expect(crash.source?.line).toBe(87);
      expect(crash.frames).toHaveLength(2);
      expect(crash.frames[0].function).toBe('videoplayerscreen$pressedplay');
      expect(crash.frames[0].file).toBe('pkg:/components/VideoPlayer.brs');
      expect(crash.frames[0].line).toBe(87);
      expect(crash.frames[1].function).toBe('callbackrouter');
      expect(crash.frames[1].file).toBe('pkg:/source/utils/CallbackRouter.brs');
      expect(crash.frames[1].line).toBe(23);
      expect(crash.currentLine).toEqual({ number: 87, text: 'm.video.control = "play"' });
      expect(crash.localVariables).toEqual({
        video: 'roSGNode (Video)',
        contentNode: 'roSGNode (ContentNode)',
      });
    });

    it('parses STOP in line', () => {
      const parser = new LogParser();
      const entries = parser.parse('STOP in pkg:/components/Foo.brs(10)\n');
      const crashes = entries.filter((e) => e.type === 'crash');
      expect(crashes).toHaveLength(1);
      expect((crashes[0] as Backtrace).source?.file).toBe('pkg:/components/Foo.brs');
    });
  });

  describe('warnings', () => {
    it('parses BRIGHTSCRIPT WARNING lines', () => {
      const parser = new LogParser();
      const entries = parser.parse('BRIGHTSCRIPT: WARNING: use of deprecated method "roVideoScreen"');
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('warning');
      expect(entries[0].message).toBe('use of deprecated method "roVideoScreen"');
    });

    it('is case-insensitive', () => {
      const parser = new LogParser();
      const entries = parser.parse('brightscript: warning: something');
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('warning');
    });
  });

  describe('-- crash marker', () => {
    it('parses -- crash lines as crash type', () => {
      const parser = new LogParser();
      const entries = parser.parse('-- crash detected in channel');
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('crash');
    });
  });

  describe('PAUSE (breakpoint)', () => {
    it('parses PAUSE as debug type, not crash', () => {
      const parser = new LogParser();
      const entries = parser.parse('PAUSE in pkg:/components/Foo.brs(10)\n');
      const debugEntries = entries.filter((e) => e.type === 'debug');
      expect(debugEntries).toHaveLength(1);
      expect((debugEntries[0] as Backtrace).source?.file).toBe('pkg:/components/Foo.brs');
    });

    it('collects backtrace frames for PAUSE entries', () => {
      const parser = new LogParser();
      const input = [
        'PAUSE in pkg:/foo.brs(10)',
        '',
        'Backtrace:',
        '#0  Function main() As Void',
        '     file/line: pkg:/foo.brs(10)',
        '',
        'Local Variables:',
        'x            Integer',
        '',
      ].join('\n');
      const entries = parser.parse(input);
      const debug = entries.find((e): e is Backtrace => e.type === 'debug')!;
      expect(debug).toBeDefined();
      expect(debug.frames).toHaveLength(1);
      expect(debug.localVariables).toEqual({ x: 'Integer' });
    });
  });

  describe('beacons', () => {
    it('parses beacon header events', () => {
      const parser = new LogParser();
      const entries = parser.parse(
        '09/15 14:02:31.123 [beacon.header] AppLaunchInitiate >>>',
      );
      expect(entries).toHaveLength(1);
      const beacon = entries[0] as BeaconEntry;
      expect(beacon.type).toBe('beacon');
      expect(beacon.event).toBe('AppLaunchInitiate');
      expect(beacon.duration).toBeUndefined();
    });

    it('parses beacon report events with duration', () => {
      const parser = new LogParser();
      const entries = parser.parse(
        '09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s',
      );
      expect(entries).toHaveLength(1);
      const beacon = entries[0] as BeaconEntry;
      expect(beacon.type).toBe('beacon');
      expect(beacon.event).toBe('AppLaunchComplete');
      expect(beacon.duration).toBe(1.88);
    });
  });

  describe('compile events', () => {
    it('parses compiling line', () => {
      const parser = new LogParser();
      const entries = parser.parse("------ Compiling dev 'MyApp' ------");
      expect(entries).toHaveLength(1);
      const compile = entries[0] as CompileEntry;
      expect(compile.type).toBe('compile');
      expect(compile.phase).toBe('compiling');
      expect(compile.appName).toBe('MyApp');
    });

    it('parses running line', () => {
      const parser = new LogParser();
      const entries = parser.parse("------ Running dev 'MyApp' main ------");
      expect(entries).toHaveLength(1);
      const compile = entries[0] as CompileEntry;
      expect(compile.type).toBe('compile');
      expect(compile.phase).toBe('running');
      expect(compile.appName).toBe('MyApp');
    });
  });

  describe('full sample log', () => {
    it('parses a mixed log output into structured entries', () => {
      const parser = new LogParser();
      const entries = parser.parse(SAMPLE_LOG);

      // Should have: 2 info ("BrightScript Micro Debugger.", "Connected to port 8085.")
      // + 1 running compile + 1 error + 1 compiling compile + 4 beacons + 4 info lines
      const types = entries.map((e) => e.type);
      expect(types).toContain('compile');
      expect(types).toContain('error');
      expect(types).toContain('beacon');
      expect(types).toContain('info');

      const errors = entries.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);

      const beacons = entries.filter((e) => e.type === 'beacon');
      expect(beacons).toHaveLength(4);
    });
  });

  describe('state machine transitions', () => {
    it('transitions from normal → backtrace → variables → normal', () => {
      const parser = new LogParser();
      const input = [
        'STOP in pkg:/foo.brs(10)',
        '',
        'Backtrace:',
        '#0  Function main() As Void',
        '     file/line: pkg:/foo.brs(10)',
        '',
        'Local Variables:',
        'x            Integer',
        '',
        '09/15 14:02:33.100 [scrpt.cmn.main.brs] Back to normal',
      ].join('\n');

      const entries = parser.parse(input);
      const types = entries.map((e) => e.type);
      expect(types).toContain('crash');
      expect(types).toContain('info');

      const crash = entries.find((e): e is Backtrace => e.type === 'crash')!;
      expect(crash.localVariables).toEqual({ x: 'Integer' });
    });

    it('handles feedLine incrementally', () => {
      const parser = new LogParser();
      const lines = [
        'STOP in pkg:/foo.brs(5)',
        '',
        'Local Variables:',
        'a            String',
        '',
      ];

      const allEntries = [];
      for (const line of lines) {
        allEntries.push(...parser.feedLine(line));
      }
      allEntries.push(...parser.flush());

      const crashes = allEntries.filter((e) => e.type === 'crash');
      expect(crashes).toHaveLength(1);
    });
  });
});

describe('parser edge cases', () => {
  it('handles lines with no recognizable pattern', () => {
    const parser = new LogParser();
    const entries = parser.parse('just some random text\nanother line');
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.type === 'info')).toBe(true);
  });

  it('handles empty input', () => {
    const parser = new LogParser();
    const entries = parser.parse('');
    expect(entries).toHaveLength(0);
  });

  it('handles input that is only blank lines', () => {
    const parser = new LogParser();
    const entries = parser.parse('\n\n\n');
    expect(entries).toHaveLength(0);
  });

  it('handles truncated backtrace (no frames, ends with flush)', () => {
    const parser = new LogParser();
    const entries = parser.parse('STOP in pkg:/foo.brs(5)');
    // flush should emit the partial crash
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('crash');
    expect((entries[0] as Backtrace).frames).toHaveLength(0);
  });

  it('handles error continuation that never gets a file/line', () => {
    const parser = new LogParser();
    const input = [
      'BRIGHTSCRIPT: ERROR: something went wrong:',
      '   more context about the error',
      '',
      '09/15 14:02:33.100 [scrpt.cmn.main.brs] next line',
    ].join('\n');
    const entries = parser.parse(input);
    const errors = entries.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('more context');
  });

  it('handles backtrace frame without subsequent file/line', () => {
    const parser = new LogParser();
    const input = [
      'Backtrace:',
      '#0  Function main() As Void',
      '',
    ].join('\n');
    const entries = parser.parse(input);
    const crashes = entries.filter((e): e is Backtrace => e.type === 'crash');
    expect(crashes).toHaveLength(1);
    expect(crashes[0].frames).toHaveLength(1);
    expect(crashes[0].frames[0].file).toBe('');
  });

  it('handles multiple errors in sequence', () => {
    const parser = new LogParser();
    const input = [
      'BRIGHTSCRIPT: ERROR: first error in pkg:/a.brs(1)',
      'BRIGHTSCRIPT: ERROR: second error in pkg:/b.brs(2)',
      'Runtime Error (bad thing) in pkg:/c.brs(3)',
    ].join('\n');
    const entries = parser.parse(input);
    const errors = entries.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(3);
  });

  it('handles interleaved crash and error', () => {
    const parser = new LogParser();
    const input = [
      'STOP in pkg:/foo.brs(10)',
      '',
      'Local Variables:',
      'x            String',
      '',
      'BRIGHTSCRIPT: ERROR: oops in pkg:/bar.brs(20)',
    ].join('\n');
    const entries = parser.parse(input);
    expect(entries.filter((e) => e.type === 'crash')).toHaveLength(1);
    expect(entries.filter((e) => e.type === 'error')).toHaveLength(1);
  });
});

describe('parseConsoleForIssues (compat)', () => {
  it('matches roku-ecp behavior', () => {
    const output = [
      'BRIGHTSCRIPT: ERROR: something bad',
      'Runtime Error in foo.brs',
      'normal log line',
      'Backtrace:',
      'STOP in file pkg:/foo.brs(10)',
      'PAUSE in file pkg:/bar.brs(20)',
    ].join('\n');

    const result = parseConsoleForIssues(output);
    expect(result.errors).toHaveLength(2);
    expect(result.crashes).toHaveLength(1);
    expect(result.exceptions).toHaveLength(2);
  });

  it('returns empty arrays for clean output', () => {
    const result = parseConsoleForIssues('all is well\nno problems here');
    expect(result.errors).toEqual([]);
    expect(result.crashes).toEqual([]);
    expect(result.exceptions).toEqual([]);
  });

  it('is case-insensitive', () => {
    const result = parseConsoleForIssues('brightscript: error: oops');
    expect(result.errors).toHaveLength(1);
  });

  it('trims whitespace from matched lines', () => {
    const result = parseConsoleForIssues('  BRIGHTSCRIPT: ERROR: oops  ');
    expect(result.errors[0]).toBe('BRIGHTSCRIPT: ERROR: oops');
  });
});
