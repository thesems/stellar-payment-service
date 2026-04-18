export type ParsedHorizonError = {
  errorCode: string;
  errorMessage: string;
  horizonError: unknown;
};

type HorizonErrorData = {
  title?: string;
  detail?: string;
  extras?: {
    result_codes?: {
      transaction?: string;
      operations?: string[];
    };
  };
};

export function parseHorizonError(err: unknown): ParsedHorizonError {
  const data = getHorizonData(err);
  const resultCodes = data?.extras?.result_codes;
  const operationCode = resultCodes?.operations?.[0];
  const transactionCode = resultCodes?.transaction;

  const errorCode =
    operationCode ??
    transactionCode ??
    data?.title ??
    (err instanceof Error ? err.name : undefined) ??
    "stellar_submission_error";

  const errorMessage =
    data?.detail ??
    messageForCode(errorCode) ??
    (err instanceof Error ? err.message : undefined) ??
    "Unknown Stellar submission error";

  return {
    errorCode,
    errorMessage,
    horizonError: toJsonSafe(err),
  };
}

function getHorizonData(err: unknown): HorizonErrorData | undefined {
  return (err as { response?: { data?: HorizonErrorData } })?.response?.data;
}

function messageForCode(code: string): string | undefined {
  switch (code) {
    case "tx_failed":
      return "Stellar transaction failed.";
    case "op_underfunded":
      return "Source account has insufficient balance.";
    case "op_no_destination":
      return "Destination account does not exist.";
    default:
      return undefined;
  }
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
