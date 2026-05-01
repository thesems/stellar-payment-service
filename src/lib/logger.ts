import pino from "pino";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export function createLogger(pretty: boolean) {
  if (!pretty) {
    return pino({
      level: getLogLevel(),
    });
  }

  return pino(
    {
      level: getLogLevel(),
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    {
      write(chunk) {
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const record = JSON.parse(trimmed) as Record<string, unknown>;
            process.stdout.write(formatRecord(record) + "\n");
          } catch {
            process.stdout.write(`${trimmed}\n`);
          }
        }
      },
    },
  );
}

function getLogLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  if (value === "trace" || value === "debug" || value === "info" || value === "warn" || value === "error" || value === "fatal") {
    return value;
  }

  return "info";
}

function formatRecord(record: Record<string, unknown>): string {
  const time = typeof record.time === "string" ? record.time : new Date().toISOString();
  const level = levelName(record.level);
  const message = typeof record.msg === "string" ? record.msg : "";

  const parts = [`[${time}]`, level];

  if (message) {
    parts.push(message);
  }

  const context = buildContext(record);
  if (context.length > 0) {
    parts.push(`| ${context.join(" ")}`);
  }

  const errorText = formatError(record.err);
  if (errorText) {
    parts.push(`\n${errorText}`);
  }

  return parts.join(" ");
}

function buildContext(record: Record<string, unknown>): string[] {
  const context: string[] = [];

  if (typeof record.reqId === "string") {
    context.push(`reqId=${record.reqId}`);
  }

  if (typeof record.method === "string") {
    context.push(`method=${record.method}`);
  }

  if (typeof record.url === "string") {
    context.push(`url=${record.url}`);
  }

  if (typeof record.statusCode === "number") {
    context.push(`status=${record.statusCode}`);
  }

  if (typeof record.responseTime === "number") {
    context.push(`responseTime=${record.responseTime.toFixed(0)}ms`);
  }

  if (typeof record.host === "string" && typeof record.port === "number") {
    context.push(`host=${record.host}`);
    context.push(`port=${record.port}`);
  }

  return context;
}

function formatError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const error = value as Record<string, unknown>;
  const name = typeof error.type === "string" ? error.type : typeof error.name === "string" ? error.name : "Error";
  const message = typeof error.message === "string" ? error.message : "";
  const stack = typeof error.stack === "string" ? error.stack : "";

  if (!message && !stack) return null;

  const lines = [`${name}${message ? `: ${message}` : ""}`];
  if (stack) {
    lines.push(stack);
  }

  return lines.join("\n");
}

function levelName(level: unknown): string {
  switch (level) {
    case 10:
      return "TRACE";
    case 20:
      return "DEBUG";
    case 30:
      return "INFO ";
    case 40:
      return "WARN ";
    case 50:
      return "ERROR";
    case 60:
      return "FATAL";
    default:
      return "INFO ";
  }
}
