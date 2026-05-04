import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { LogStream } from '../stream.js';

function createMockServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('LogStream', () => {
  let server: Server;
  let stream: LogStream;

  afterEach(() => {
    stream?.disconnect();
    server?.close();
  });

  it('connects and emits connected event', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;
    stream = new LogStream('127.0.0.1', { port, reconnect: false });

    let connected = false;
    stream.on('connected', () => { connected = true; });

    await stream.connect();
    expect(connected).toBe(true);
    expect(stream.isConnected).toBe(true);
  });

  it('emits raw lines and parsed entries', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      socket.write('09/15 14:02:33.100 [scrpt.cmn.main.brs] hello world\n');
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });

    const rawLines: string[] = [];
    stream.on('raw', (line) => rawLines.push(line));

    const entries: any[] = [];
    stream.on('entry', (entry) => entries.push(entry));

    await stream.connect();
    await delay(50);

    expect(rawLines).toHaveLength(1);
    expect(rawLines[0]).toContain('hello world');
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('info');
    expect(entries[0].message).toBe('hello world');
  });

  it('emits typed events for errors', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      socket.write('BRIGHTSCRIPT: ERROR: oops in pkg:/foo.brs(1)\n');
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });

    const errors: any[] = [];
    stream.on('error', (entry) => errors.push(entry));

    await stream.connect();
    await delay(50);

    expect(errors).toHaveLength(1);
    expect(errors[0].source.file).toBe('pkg:/foo.brs');
  });

  it('emits typed events for beacons', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      socket.write('09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s\n');
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });

    const beacons: any[] = [];
    stream.on('beacon', (entry) => beacons.push(entry));

    await stream.connect();
    await delay(50);

    expect(beacons).toHaveLength(1);
    expect(beacons[0].event).toBe('AppLaunchComplete');
    expect(beacons[0].duration).toBe(1.88);
  });

  it('sends commands to the server', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    const received: string[] = [];
    server.on('connection', (socket) => {
      socket.on('data', (data) => received.push(data.toString()));
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();
    await stream.send('bt');
    await delay(50);

    expect(received.some((d) => d.includes('bt'))).toBe(true);
  });

  it('handles disconnection', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      setTimeout(() => socket.end(), 30);
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });

    let disconnected = false;
    stream.on('disconnected', () => { disconnected = true; });

    await stream.connect();
    await delay(100);

    expect(disconnected).toBe(true);
    expect(stream.isConnected).toBe(false);
  });

  it('match() resolves on first matching raw line', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      setTimeout(() => socket.write('noise line\n'), 10);
      setTimeout(() => socket.write('HTTP 200: https://example.com\n'), 30);
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();

    const m = await stream.match(/HTTP (\d+)/);
    expect(m[1]).toBe('200');
  });

  it('match() rejects on timeout', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();

    await expect(stream.match(/will-never-match/, { timeout: 50 }))
      .rejects.toThrow('timed out');
  });

  it('matchAll() collects matches over duration', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      socket.write('HTTP 200: /foo\n');
      socket.write('noise\n');
      socket.write('HTTP 404: /bar\n');
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();

    const matches = await stream.matchAll(/HTTP (\d+)/, { duration: 100 });
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe('200');
    expect(matches[1][1]).toBe('404');
  });

  it('waitFor() resolves on matching parsed entry', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      setTimeout(() => {
        socket.write('09/15 14:02:33.100 [scrpt.cmn.main.brs] loading\n');
      }, 10);
      setTimeout(() => {
        socket.write('09/15 14:02:33.012 [beacon.report] AppLaunchComplete >>> 1.88s\n');
      }, 30);
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();

    const entry = await stream.waitFor((e) => e.type === 'beacon');
    expect(entry.type).toBe('beacon');
  });

  it('waitFor() rejects on timeout', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();

    await expect(stream.waitFor(() => false, { timeout: 50 }))
      .rejects.toThrow('timed out');
  });

  it('async iterator yields entries', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      socket.write('09/15 14:02:33.100 [scrpt.cmn.main.brs] one\n');
      socket.write('09/15 14:02:33.200 [scrpt.cmn.main.brs] two\n');
      setTimeout(() => stream.disconnect(), 50);
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });
    await stream.connect();

    const messages: string[] = [];
    for await (const entry of stream) {
      messages.push(entry.message);
    }

    expect(messages).toContain('one');
    expect(messages).toContain('two');
  });

  it('reconnects after disconnection', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    let connectionCount = 0;
    server.on('connection', (socket) => {
      connectionCount++;
      if (connectionCount === 1) {
        socket.end();
      }
    });

    stream = new LogStream('127.0.0.1', {
      port,
      reconnect: true,
      reconnectDelay: 50,
    });
    await stream.connect();
    await delay(200);

    expect(connectionCount).toBeGreaterThanOrEqual(2);
  });

  it('buffers incomplete lines across chunks', async () => {
    ({ server } = await createMockServer());
    const port = (server.address() as { port: number }).port;

    server.on('connection', (socket) => {
      // Send a line split across two chunks
      socket.write('09/15 14:02:33.100 [scrpt.cmn.');
      setTimeout(() => socket.write('main.brs] split line\n'), 20);
    });

    stream = new LogStream('127.0.0.1', { port, reconnect: false });

    const entries: any[] = [];
    stream.on('entry', (entry) => entries.push(entry));

    await stream.connect();
    await delay(80);

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('split line');
  });

  it('send() rejects when not connected', async () => {
    stream = new LogStream('127.0.0.1', { port: 1, reconnect: false });
    await expect(stream.send('bt')).rejects.toThrow('Not connected');
  });
});
