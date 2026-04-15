import type {
  LogEntry,
  BrightScriptError,
  Backtrace,
  BeaconEntry,
  LogFilterOptions,
} from './types.js';

export class LogSession {
  private entries: LogEntry[] = [];

  add(entry: LogEntry): void {
    this.entries.push(entry);
  }

  addAll(entries: LogEntry[]): void {
    this.entries.push(...entries);
  }

  get all(): LogEntry[] {
    return [...this.entries];
  }

  get errors(): BrightScriptError[] {
    return this.entries.filter((e): e is BrightScriptError => e.type === 'error');
  }

  get crashes(): Backtrace[] {
    return this.entries.filter((e): e is Backtrace => e.type === 'crash');
  }

  get beacons(): BeaconEntry[] {
    return this.entries.filter((e): e is BeaconEntry => e.type === 'beacon');
  }

  filter(options: LogFilterOptions): LogEntry[] {
    return this.entries.filter((entry) => {
      if (options.type && entry.type !== options.type) return false;
      if (options.file && !entry.source?.file.includes(options.file)) return false;
      if (options.since && (!entry.timestamp || entry.timestamp < options.since)) return false;
      return true;
    });
  }

  search(text: string): LogEntry[] {
    const lower = text.toLowerCase();
    return this.entries.filter(
      (e) =>
        e.message.toLowerCase().includes(lower) ||
        e.raw.toLowerCase().includes(lower),
    );
  }

  summary(): {
    errorCount: number;
    crashCount: number;
    beaconCount: number;
    launchTime?: number;
    uniqueErrors: string[];
  } {
    const errors = this.errors;
    const uniqueErrors = [...new Set(errors.map((e) => e.errorClass))];
    const launchBeacon = this.beacons.find((b) => b.event === 'AppLaunchComplete');

    return {
      errorCount: errors.length,
      crashCount: this.crashes.length,
      beaconCount: this.beacons.length,
      launchTime: launchBeacon?.duration,
      uniqueErrors,
    };
  }

  toJSON(): object {
    return {
      entries: this.entries,
      summary: this.summary(),
    };
  }

  toText(): string {
    return this.entries.map((e) => e.raw).join('\n');
  }

  clear(): void {
    this.entries = [];
  }
}
