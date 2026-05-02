export type LogEntryType = 'info' | 'error' | 'crash' | 'beacon' | 'compile' | 'debug';

export interface LogSource {
  file: string;
  line: number;
  function?: string;
}

export interface LogEntry {
  timestamp?: Date;
  raw: string;
  type: LogEntryType;
  source?: LogSource;
  message: string;
}

export interface BrightScriptError extends LogEntry {
  type: 'error';
  errorClass: string;
  errorCode?: string;
  source: LogSource;
}

export interface BacktraceFrame {
  index: number;
  function: string;
  file: string;
  line: number;
}

export interface Backtrace extends LogEntry {
  type: 'crash';
  frames: BacktraceFrame[];
  localVariables?: Record<string, string>;
  currentLine?: { number: number; text: string };
}

export interface BeaconEntry extends LogEntry {
  type: 'beacon';
  event: string;
  duration?: number;
}

export interface CompileEntry extends LogEntry {
  type: 'compile';
  phase: 'compiling' | 'running';
  appName: string;
}

/** Compatible with roku-ecp's ConsoleIssues interface */
export interface ConsoleIssues {
  errors: string[];
  crashes: string[];
  exceptions: string[];
}

export interface LogStreamOptions {
  port?: number;
  reconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

export interface LogFormatterOptions {
  color?: boolean;
}

export interface LogFilterOptions {
  type?: LogEntryType;
  file?: string;
  since?: Date;
  until?: Date;
}
