const LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const CONSOLE = { trace: "debug", debug: "log", info: "info", warn: "warn", error: "error" };

let _level = LEVELS.warn;
try {
  const stored = localStorage.getItem("inkwave_logLevel");
  if (stored && LEVELS[stored] !== undefined) _level = LEVELS[stored];
} catch (_) { /* no localStorage */ }

const noop = () => {};

export function createLogger(namespace) {
  const tag = `[${namespace}]`;
  const logger = {};
  for (const [name, val] of Object.entries(LEVELS)) {
    Object.defineProperty(logger, name, {
      get: () => val < _level ? noop : console[CONSOLE[name]].bind(console, tag),
    });
  }
  return logger;
}

export function setLogLevel(level) {
  if (LEVELS[level] !== undefined) _level = LEVELS[level];
}
