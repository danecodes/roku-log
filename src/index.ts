export { LogParser, parseConsoleForIssues } from './parser.js';
export { LogStream } from './stream.js';
export { LogSession } from './session.js';
export { LogFormatter } from './formatter.js';

export type {
  LogEntry,
  LogEntryType,
  LogSource,
  BrightScriptError,
  Backtrace,
  BacktraceFrame,
  BeaconEntry,
  CompileEntry,
  ConsoleIssues,
  LogStreamOptions,
  LogFormatterOptions,
  LogFilterOptions,
} from './types.js';
