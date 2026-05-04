// BrightScript log line patterns

// BRIGHTSCRIPT: ERROR: {message} in {file}({line})
// Also matches multi-line variant where "in" is on the next line
export const BRIGHTSCRIPT_ERROR =
  /^BRIGHTSCRIPT:\s*ERROR:\s*(.+?)(?:\s+in\s+(.+?)\((\d+)\))?$/i;

// BRIGHTSCRIPT: WARNING: {message}
export const BRIGHTSCRIPT_WARNING = /^BRIGHTSCRIPT:\s*WARNING:\s*(.+)$/i;

// Runtime Error ({description}) in {file}({line})
export const RUNTIME_ERROR =
  /^Runtime Error\s*\((.+?)\)\s+in\s+(.+?)\((\d+)\)$/i;

// runtime error &h{code}
export const RUNTIME_ERROR_CODE = /runtime error\s+(&h[0-9a-f]+)/i;

// BRIGHTSCRIPT: ERROR: ... \n   file/line: {file}({line})
export const FILE_LINE_REF = /^\s*file\/line:\s*(.+?)\((\d+)\)/;

// STOP in {file}({line})
export const STOP_IN = /^STOP\s+in\s+(.+?)\((\d+)\)/i;

// PAUSE in {file}({line})
export const PAUSE_IN = /^PAUSE\s+in\s+(.+?)\((\d+)\)/i;

// Backtrace:
export const BACKTRACE_START = /^Backtrace:$/;

// #0  Function name() As Type
export const BACKTRACE_FRAME = /^#(\d+)\s+Function\s+(\S+)\(.*$/i;

// Current Function:
export const CURRENT_FUNCTION_START = /^Current Function:$/;

// 087:    m.video.control = "play"
export const CURRENT_FUNCTION_LINE = /^(\d+):\s+(.+)$/;

// Local Variables:
export const LOCAL_VARIABLES_START = /^Local Variables:$/;

// variableName   typeName (SubType)
export const LOCAL_VARIABLE = /^(\w+)\s+(.+)$/;

// [beacon.header] or [beacon.report]
export const BEACON =
  /^\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[beacon\.(header|report)\]\s+(\S+)\s+>>>(?: (.+))?$/;

// Duration from beacon: "1.88s" or " 1.88s"
export const BEACON_DURATION = /^\s*([\d.]+)s$/;

// Timestamped log line: MM/DD HH:MM:SS.mmm [{source}] {message}
export const TIMESTAMPED_LINE =
  /^(\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\[([^\]]+)\]\s+(.*)$/;

// -- crash / channel crash dump
export const CRASH_MARKER = /^--\s*crash\b/i;

// ------ Compiling dev '{name}' ------
export const COMPILE_START = /^------\s+Compiling\s+dev\s+'(.+?)'\s+------$/;

// ------ Running dev '{name}' main ------
export const RUN_START = /^------\s+Running\s+dev\s+'(.+?)'\s+main\s+------$/;

export function parseTimestamp(date: string, time: string): Date {
  const [month, day] = date.split('/').map(Number);
  const [hours, minutes, rest] = time.split(':');
  const [seconds, ms] = rest.split('.');
  const now = new Date();
  return new Date(
    now.getFullYear(),
    month - 1,
    day,
    Number(hours),
    Number(minutes),
    Number(seconds),
    Number(ms),
  );
}
