export type ParsedStellarError = {
  errorCode: string;
  errorMessage: string;
  horizonError?: unknown;
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

export class RpcTransactionError extends Error {
  readonly errorCode: string;
  readonly rpcError: unknown;

  constructor(errorCode: string, message: string, rpcError: unknown) {
    super(message);
    this.name = "RpcTransactionError";
    this.errorCode = errorCode;
    this.rpcError = rpcError;
  }
}

export function parseStellarError(err: unknown): ParsedStellarError {
  if (err instanceof RpcTransactionError) {
    return {
      errorCode: err.errorCode,
      errorMessage: err.message,
      horizonError: toJsonSafe(err.rpcError),
    };
  }

  const data = getHorizonData(err);
  const resultCodes = data?.extras?.result_codes;
  const operationCode = resultCodes?.operations?.[0];
  const transactionCode = resultCodes?.transaction;

  if (operationCode) {
    return {
      errorCode: operationCode,
      errorMessage: data?.detail ?? messageForCode(operationCode) ?? data?.title ?? "Stellar operation failed.",
      horizonError: data,
    };
  }

  if (transactionCode) {
    return {
      errorCode: transactionCode,
      errorMessage: data?.detail ?? messageForCode(transactionCode) ?? data?.title ?? "Stellar transaction failed.",
      horizonError: data,
    };
  }

  return {
    errorCode: data?.title ?? (err instanceof Error ? err.name : undefined) ?? "stellar_error",
    errorMessage: data?.detail ?? (err instanceof Error ? err.message : undefined) ?? "Stellar request failed.",
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
