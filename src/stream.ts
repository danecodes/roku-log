import { createConnection, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { LogParser } from './parser.js';
import type {
  LogEntry,
  BrightScriptError,
  Backtrace,
  BeaconEntry,
  LogStreamOptions,
} from './types.js';

interface LogStreamEvents {
  entry: [entry: LogEntry];
  error: [entry: BrightScriptError];
  crash: [entry: Backtrace];
  beacon: [entry: BeaconEntry];
  raw: [line: string];
  connected: [];
  disconnected: [];
}

export class LogStream extends EventEmitter<LogStreamEvents> {
  private socket: Socket | null = null;
  private parser = new LogParser();
  private buffer = '';
  private connected = false;
  private shouldReconnect: boolean;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private currentReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private iteratorQueue: LogEntry[] = [];
  private iteratorResolve: ((value: IteratorResult<LogEntry>) => void) | null = null;
  private iteratorDone = false;
  private port: number;

  constructor(
    private host: string,
    options: LogStreamOptions = {},
  ) {
    super();
    this.port = options.port ?? 8085;
    this.shouldReconnect = options.reconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
    this.currentReconnectDelay = this.reconnectDelay;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection({ host: this.host, port: this.port }, () => {
        this.connected = true;
        this.currentReconnectDelay = this.reconnectDelay;
        this.emit('connected');
        resolve();
      });

      this.socket.setEncoding('utf-8');

      this.socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        // Keep incomplete last line in buffer
        this.buffer = lines.pop()!;

        for (const line of lines) {
          this.emit('raw', line);
          const entries = this.parser.feedLine(line);
          for (const entry of entries) {
            this.dispatchEntry(entry);
          }
        }
      });

      this.socket.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        // Flush parser state
        for (const entry of this.parser.flush()) {
          this.dispatchEntry(entry);
        }
        if (wasConnected) {
          this.emit('disconnected');
        }
        this.scheduleReconnect();
      });

      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
        // Socket 'close' will fire after 'error', handling reconnection
      });
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.iteratorDone = true;
    if (this.iteratorResolve) {
      this.iteratorResolve({ value: undefined, done: true });
      this.iteratorResolve = null;
    }
  }

  match(pattern: RegExp, options?: { timeout?: number }): Promise<RegExpMatchArray> {
    const timeout = options?.timeout ?? 10000;
    return new Promise((resolve, reject) => {
      const onRaw = (line: string) => {
        const m = line.match(pattern);
        if (m) {
          cleanup();
          resolve(m);
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`match() timed out after ${timeout}ms waiting for ${pattern}`));
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        this.off('raw', onRaw);
      };

      this.on('raw', onRaw);
    });
  }

  matchAll(pattern: RegExp, options?: { duration?: number }): Promise<RegExpMatchArray[]> {
    const duration = options?.duration ?? 5000;
    return new Promise((resolve) => {
      const matches: RegExpMatchArray[] = [];

      const onRaw = (line: string) => {
        const m = line.match(pattern);
        if (m) matches.push(m);
      };

      setTimeout(() => {
        this.off('raw', onRaw);
        resolve(matches);
      }, duration);

      this.on('raw', onRaw);
    });
  }

  async send(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }
      this.socket.write(command + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<LogEntry> {
    return {
      next: () => {
        if (this.iteratorQueue.length > 0) {
          return Promise.resolve({ value: this.iteratorQueue.shift()!, done: false });
        }
        if (this.iteratorDone) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<LogEntry>>((resolve) => {
          this.iteratorResolve = resolve;
        });
      },
      return: () => {
        this.iteratorDone = true;
        return Promise.resolve({ value: undefined as any, done: true });
      },
    };
  }

  private dispatchEntry(entry: LogEntry): void {
    this.emit('entry', entry);

    switch (entry.type) {
      case 'error':
        this.emit('error', entry as BrightScriptError);
        break;
      case 'crash':
        this.emit('crash', entry as Backtrace);
        break;
      case 'beacon':
        this.emit('beacon', entry as BeaconEntry);
        break;
    }

    // Feed async iterator
    if (this.iteratorResolve) {
      this.iteratorResolve({ value: entry, done: false });
      this.iteratorResolve = null;
    } else {
      this.iteratorQueue.push(entry);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.parser = new LogParser();
      this.buffer = '';
      this.connect().catch(() => {
        // Reconnect failed — exponential backoff
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * 2,
          this.maxReconnectDelay,
        );
        this.scheduleReconnect();
      });
    }, this.currentReconnectDelay);

    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.maxReconnectDelay,
    );
  }
}
