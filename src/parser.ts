import type {
  LogEntry,
  BrightScriptError,
  Backtrace,
  BacktraceFrame,
  BeaconEntry,
  CompileEntry,
  ConsoleIssues,
} from './types.js';
import * as pat from './patterns.js';

type ParserState =
  | { mode: 'normal' }
  | { mode: 'backtrace'; entry: Backtrace }
  | { mode: 'current-function'; entry: Backtrace }
  | { mode: 'variables'; entry: Backtrace }
  | { mode: 'error-continuation'; entry: BrightScriptError };

export class LogParser {
  private state: ParserState = { mode: 'normal' };
  private pendingEntries: LogEntry[] = [];

  parse(text: string): LogEntry[] {
    const lines = text.split('\n');
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const produced = this.feedLine(line);
      entries.push(...produced);
    }

    // Flush any pending multi-line block
    entries.push(...this.flush());

    return entries;
  }

  feedLine(line: string): LogEntry[] {
    const results: LogEntry[] = [];

    // Drain any entries queued by previous feedLine calls
    results.push(...this.pendingEntries);
    this.pendingEntries = [];

    if (this.state.mode === 'backtrace') {
      return [...results, ...this.handleBacktrace(line)];
    }
    if (this.state.mode === 'current-function') {
      return [...results, ...this.handleCurrentFunction(line)];
    }
    if (this.state.mode === 'variables') {
      return [...results, ...this.handleVariables(line)];
    }
    if (this.state.mode === 'error-continuation') {
      return [...results, ...this.handleErrorContinuation(line)];
    }

    return [...results, ...this.handleNormal(line)];
  }

  flush(): LogEntry[] {
    const results: LogEntry[] = [...this.pendingEntries];
    this.pendingEntries = [];

    if (this.state.mode !== 'normal') {
      if ('entry' in this.state) {
        results.push(this.state.entry);
      }
      this.state = { mode: 'normal' };
    }
    return results;
  }

  private handleNormal(line: string): LogEntry[] {
    // STOP / PAUSE — start of a crash block
    const stopMatch = line.match(pat.STOP_IN) || line.match(pat.PAUSE_IN);
    if (stopMatch) {
      const entry: Backtrace = {
        type: 'crash',
        raw: line,
        message: line.trim(),
        frames: [],
        source: { file: stopMatch[1], line: Number(stopMatch[2]) },
      };
      this.state = { mode: 'backtrace', entry };
      return [];
    }

    // Backtrace: header (can appear without a preceding STOP)
    if (pat.BACKTRACE_START.test(line.trim())) {
      const entry: Backtrace = {
        type: 'crash',
        raw: line,
        message: 'Backtrace',
        frames: [],
      };
      this.state = { mode: 'backtrace', entry };
      return [];
    }

    // Runtime Error ({desc}) in {file}({line})
    const runtimeMatch = line.match(pat.RUNTIME_ERROR);
    if (runtimeMatch) {
      const codeMatch = line.match(pat.RUNTIME_ERROR_CODE);
      const entry: BrightScriptError = {
        type: 'error',
        raw: line,
        message: line.trim(),
        errorClass: runtimeMatch[1],
        errorCode: codeMatch?.[1],
        source: { file: runtimeMatch[2], line: Number(runtimeMatch[3]) },
      };
      return [entry];
    }

    // BRIGHTSCRIPT: ERROR: ...
    const bsMatch = line.match(pat.BRIGHTSCRIPT_ERROR);
    if (bsMatch) {
      const codeMatch = line.match(pat.RUNTIME_ERROR_CODE);
      const errorMsg = bsMatch[1];
      if (bsMatch[2]) {
        // Full single-line error with file reference
        const entry: BrightScriptError = {
          type: 'error',
          raw: line,
          message: errorMsg,
          errorClass: errorMsg.replace(/\s+in$/, ''),
          errorCode: codeMatch?.[1],
          source: { file: bsMatch[2], line: Number(bsMatch[3]) },
        };
        return [entry];
      }
      // Multi-line: file/line on next line
      const entry: BrightScriptError = {
        type: 'error',
        raw: line,
        message: errorMsg,
        errorClass: errorMsg,
        errorCode: codeMatch?.[1],
        source: { file: '', line: 0 },
      };
      this.state = { mode: 'error-continuation', entry };
      return [];
    }

    // Beacon lines
    const beaconMatch = line.match(pat.BEACON);
    if (beaconMatch) {
      const tsMatch = line.match(pat.TIMESTAMPED_LINE);
      const entry: BeaconEntry = {
        type: 'beacon',
        raw: line,
        message: line.trim(),
        event: beaconMatch[2],
        timestamp: tsMatch ? pat.parseTimestamp(tsMatch[1], tsMatch[2]) : undefined,
        source: tsMatch ? { file: tsMatch[3], line: 0 } : undefined,
      };
      const durationStr = beaconMatch[3];
      if (durationStr) {
        const durMatch = durationStr.match(pat.BEACON_DURATION);
        if (durMatch) {
          entry.duration = parseFloat(durMatch[1]);
        }
      }
      return [entry];
    }

    // Compile / Run
    const compileMatch = line.match(pat.COMPILE_START);
    if (compileMatch) {
      const entry: CompileEntry = {
        type: 'compile',
        raw: line,
        message: line.trim(),
        phase: 'compiling',
        appName: compileMatch[1],
      };
      return [entry];
    }
    const runMatch = line.match(pat.RUN_START);
    if (runMatch) {
      const entry: CompileEntry = {
        type: 'compile',
        raw: line,
        message: line.trim(),
        phase: 'running',
        appName: runMatch[1],
      };
      return [entry];
    }

    // Timestamped log line
    const tsMatch = line.match(pat.TIMESTAMPED_LINE);
    if (tsMatch) {
      const entry: LogEntry = {
        type: 'info',
        raw: line,
        message: tsMatch[4],
        timestamp: pat.parseTimestamp(tsMatch[1], tsMatch[2]),
        source: { file: tsMatch[3], line: 0 },
      };
      return [entry];
    }

    // Skip blank lines
    if (line.trim() === '') return [];

    // Generic info line
    return [{
      type: 'info',
      raw: line,
      message: line.trim(),
    }];
  }

  private handleErrorContinuation(line: string): LogEntry[] {
    const entry = (this.state as { mode: 'error-continuation'; entry: BrightScriptError }).entry;
    const fileMatch = line.match(pat.FILE_LINE_REF);
    if (fileMatch) {
      entry.raw += '\n' + line;
      entry.source = { file: fileMatch[1], line: Number(fileMatch[2]) };
      this.state = { mode: 'normal' };
      return [entry];
    }

    // Not a file/line ref — might be continuation of error message
    if (line.trim() !== '') {
      entry.raw += '\n' + line;
      entry.message += ' ' + line.trim();
      entry.errorClass += ' ' + line.trim();
      return [];
    }

    // Blank line ends the error block without file info
    this.state = { mode: 'normal' };
    return [entry];
  }

  private handleBacktrace(line: string): LogEntry[] {
    const entry = (this.state as { mode: 'backtrace'; entry: Backtrace }).entry;

    if (pat.CURRENT_FUNCTION_START.test(line.trim())) {
      entry.raw += '\n' + line;
      this.state = { mode: 'current-function', entry };
      return [];
    }

    if (pat.LOCAL_VARIABLES_START.test(line.trim())) {
      entry.raw += '\n' + line;
      this.state = { mode: 'variables', entry };
      return [];
    }

    const frameMatch = line.match(pat.BACKTRACE_FRAME);
    if (frameMatch) {
      entry.raw += '\n' + line;
      const frame: Partial<BacktraceFrame> & { function: string; index: number } = {
        index: Number(frameMatch[1]),
        function: frameMatch[2],
        file: '',
        line: 0,
      };
      // file/line typically follows on the next line, but might be on this line
      entry.frames.push(frame as BacktraceFrame);
      return [];
    }

    const fileMatch = line.match(pat.FILE_LINE_REF);
    if (fileMatch) {
      entry.raw += '\n' + line;
      const lastFrame = entry.frames[entry.frames.length - 1];
      if (lastFrame) {
        lastFrame.file = fileMatch[1];
        lastFrame.line = Number(fileMatch[2]);
      }
      return [];
    }

    // Blank line while in backtrace — might end the section or just be spacing
    if (line.trim() === '') {
      // If we have frames, the backtrace section might be done
      // but Current Function / Local Variables might follow, so stay in backtrace mode
      entry.raw += '\n' + line;
      return [];
    }

    // Unrecognized line in backtrace — append to raw and continue
    entry.raw += '\n' + line;
    return [];
  }

  private handleCurrentFunction(line: string): LogEntry[] {
    const entry = (this.state as { mode: 'current-function'; entry: Backtrace }).entry;

    if (pat.LOCAL_VARIABLES_START.test(line.trim())) {
      entry.raw += '\n' + line;
      this.state = { mode: 'variables', entry };
      return [];
    }

    const lineMatch = line.match(pat.CURRENT_FUNCTION_LINE);
    if (lineMatch) {
      entry.raw += '\n' + line;
      entry.currentLine = { number: Number(lineMatch[1]), text: lineMatch[2] };
      return [];
    }

    if (line.trim() === '') {
      entry.raw += '\n' + line;
      // Might transition to Local Variables
      return [];
    }

    // Non-matching line — stay in mode, accumulate
    entry.raw += '\n' + line;
    return [];
  }

  private handleVariables(line: string): LogEntry[] {
    const entry = (this.state as { mode: 'variables'; entry: Backtrace }).entry;

    if (line.trim() === '') {
      // Blank line ends variables section — emit the crash entry
      entry.raw += '\n' + line;
      this.state = { mode: 'normal' };
      return [entry];
    }

    const varMatch = line.match(pat.LOCAL_VARIABLE);
    if (varMatch) {
      entry.raw += '\n' + line;
      if (!entry.localVariables) entry.localVariables = {};
      entry.localVariables[varMatch[1]] = varMatch[2].trim();
      return [];
    }

    entry.raw += '\n' + line;
    return [];
  }
}

/**
 * Drop-in compatible replacement for roku-ecp's parseConsoleForIssues.
 * Same signature and return type.
 */
export function parseConsoleForIssues(output: string): ConsoleIssues {
  const errors: string[] = [];
  const crashes: string[] = [];
  const exceptions: string[] = [];

  for (const line of output.split('\n')) {
    const l = line.toLowerCase();
    if (l.includes('brightscript: error') || l.includes('runtime error')) {
      errors.push(line.trim());
    } else if (
      l.includes('backtrace') ||
      l.includes('-- crash') ||
      l.includes('brightscript stop')
    ) {
      crashes.push(line.trim());
    } else if (l.includes('stop in file') || l.includes('pause in file')) {
      exceptions.push(line.trim());
    }
  }

  return { errors, crashes, exceptions };
}
