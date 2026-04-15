import type { LogEntry, Backtrace, LogFormatterOptions } from './types.js';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const RED_BOLD = '\x1b[1;31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

export class LogFormatter {
  private color: boolean;

  constructor(options: LogFormatterOptions = {}) {
    this.color = options.color ?? true;
  }

  format(entry: LogEntry): string {
    if (!this.color) return entry.raw;

    switch (entry.type) {
      case 'error':
        return this.wrap(RED, entry.raw);
      case 'crash':
        return this.formatCrash(entry as Backtrace);
      case 'beacon':
        return this.wrap(YELLOW, entry.raw);
      case 'compile':
        return this.wrap(YELLOW, entry.raw);
      case 'debug':
        return this.wrap(DIM, entry.raw);
      case 'info':
        return this.formatInfo(entry);
    }
  }

  formatWithContext(
    entry: LogEntry,
    _options: { before?: number; after?: number } = {},
  ): string {
    // Context lines are just the raw multi-line content of the entry itself
    // (backtraces already include multiple lines in raw)
    return this.format(entry);
  }

  private formatCrash(entry: Backtrace): string {
    const lines = entry.raw.split('\n');
    return lines
      .map((line) => {
        if (/^\s*file\/line:/.test(line)) {
          return this.wrap(CYAN, line);
        }
        return this.wrap(RED_BOLD, line);
      })
      .join('\n');
  }

  private formatInfo(entry: LogEntry): string {
    if (!entry.timestamp && !entry.source) return entry.raw;

    const parts: string[] = [];
    const raw = entry.raw;

    // Color the timestamp portion dim and the source cyan
    if (entry.source) {
      const srcTag = `[${entry.source.file}]`;
      const idx = raw.indexOf(srcTag);
      if (idx !== -1) {
        const before = raw.slice(0, idx);
        const after = raw.slice(idx + srcTag.length);
        parts.push(
          this.wrap(DIM, before),
          this.wrap(CYAN, srcTag),
          after,
        );
        return parts.join('');
      }
    }

    return entry.raw;
  }

  private wrap(code: string, text: string): string {
    return `${code}${text}${RESET}`;
  }
}
