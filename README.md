# @danecodes/roku-log

Structured Roku BrightScript log parsing, streaming, and analysis.

Connects to a Roku device's debug console (port 8085) and turns raw log output into typed, structured data. Zero runtime dependencies.

## Install

```
npm install @danecodes/roku-log
```

## LogParser — structured parsing

```ts
import { LogParser } from '@danecodes/roku-log';

const parser = new LogParser();
const entries = parser.parse(rawLogText);

for (const entry of entries) {
  console.log(entry.type, entry.message);
  // type: 'info' | 'error' | 'crash' | 'beacon' | 'compile' | 'debug'
}
```

The parser is stateful — it handles multi-line blocks like backtraces and variable dumps. You can also feed lines incrementally:

```ts
for (const line of lines) {
  const entries = parser.feedLine(line);
  // process entries...
}
const remaining = parser.flush(); // emit any buffered multi-line block
```

### Parsed types

- **`BrightScriptError`** — `BRIGHTSCRIPT: ERROR:` and `Runtime Error` lines with error class, code, and source location
- **`Backtrace`** — `STOP`/`PAUSE` blocks with stack frames, current function line, and local variables
- **`BeaconEntry`** — `[beacon.header]`/`[beacon.report]` lines with event name and optional duration
- **`CompileEntry`** — `------ Compiling dev ... ------` and `------ Running dev ... ------` markers

## LogStream — live TCP streaming

```ts
import { LogStream } from '@danecodes/roku-log';

const stream = new LogStream('192.168.0.30');

stream.on('entry', (entry) => console.log(entry.type, entry.message));
stream.on('error', (err) => console.error(err.errorClass, err.source.file));
stream.on('crash', (crash) => console.error(crash.frames));
stream.on('beacon', (beacon) => console.log(beacon.event, beacon.duration));

await stream.connect();

// Send debug commands
await stream.send('bt');
await stream.send('cont');

// Or use as async iterator
for await (const entry of stream) {
  console.log(entry.type, entry.message);
}

stream.disconnect();
```

Auto-reconnects with exponential backoff by default. Disable with `{ reconnect: false }`.

## LogSession — aggregate analysis

```ts
import { LogSession } from '@danecodes/roku-log';

const session = new LogSession();
session.addAll(entries);

session.errors;   // BrightScriptError[]
session.crashes;  // Backtrace[]
session.beacons;  // BeaconEntry[]

session.filter({ type: 'error' });
session.filter({ file: 'HomeScene.brs' });
session.filter({ since: timestamp });
session.search('uninitialized');

const summary = session.summary();
// { errorCount, crashCount, beaconCount, launchTime?, uniqueErrors }

session.toJSON();
session.toText();
```

## LogFormatter — terminal output

```ts
import { LogFormatter } from '@danecodes/roku-log';

const formatter = new LogFormatter({ color: true });
console.log(formatter.format(entry));
// ANSI-colored: red for errors, red bold for crashes, yellow for beacons, cyan for source locations
```

## Compatibility

Drop-in replacement for roku-ecp's `parseConsoleForIssues`:

```ts
import { parseConsoleForIssues } from '@danecodes/roku-log';

const { errors, crashes, exceptions } = parseConsoleForIssues(rawOutput);
```

Same signature and return type as `@danecodes/roku-ecp`'s version.
