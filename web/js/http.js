export async function requestJson(path, init = {}) {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  const payload = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? response.statusText;
    const error = new Error(message);
    error.response = payload ?? { status: response.status };
    throw error;
  }

  return payload;
}

export function prettyPrint(value) {
  return JSON.stringify(value, null, 2);
}

export function formatError(error) {
  if (error instanceof Error) {
    return JSON.stringify(
      {
        error: "request_failed",
        message: error.message,
        details: error.response ?? null,
      },
      null,
      2,
    );
  }

  return prettyPrint({ error: "request_failed", message: "Unknown error" });
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
