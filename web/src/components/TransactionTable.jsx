import React from "react";

import { describeAsset, formatDateTime, shortenAddress, shortenHash, shortenId, statusClass } from "../utils/formatters.js";

export function TransactionTable({ rows, loading, filter, onSelectId, onSubmitCreated, submittingTransactionId }) {
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleRows = normalizedFilter
    ? rows.filter((row) => {
        const id = String(row.id ?? "").toLowerCase();
        const hash = String(row.tx_hash ?? "").toLowerCase();
        return id.includes(normalizedFilter) || hash.includes(normalizedFilter);
      })
    : rows;

  const emptyMessage = loading
    ? "Loading transactions..."
    : !rows.length
      ? "No transactions found on this page."
      : !visibleRows.length
        ? "No transactions match this ID or hash on the current page."
        : "";

  return (
    <div className="table-wrap" role="region" aria-label="Transaction table">
      <table className="tx-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Kind</th>
            <th>ID</th>
            <th>Source</th>
            <th>Destination</th>
            <th>Amount</th>
            <th>Created</th>
            <th>Hash</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {emptyMessage ? (
            <tr>
              <td className="table-empty" colSpan={9}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <CopyCell value={row.status} label="transaction status">
                    <span className={`table-pill status-pill ${statusClass(row.status)}`}>{row.status}</span>
                  </CopyCell>
                </td>
                <td>
                  <CopyCell value={row.kind} label="transaction kind">
                    <span className="table-subtle">{row.kind ?? "payment"}</span>
                  </CopyCell>
                </td>
                <td className="mono">
                  <CopyCell value={row.id} label="transaction id" onPrimaryAction={() => onSelectId(row.id)}>
                    <span className="link-button">{shortenId(row.id)}</span>
                  </CopyCell>
                </td>
                <td className="mono">
                  <CopyCell value={row.source_address ?? row.source_account} label="source address">
                    <span>{shortenAddress(row.source_address ?? row.source_account)}</span>
                  </CopyCell>
                </td>
                <td className="mono">
                  <CopyCell value={row.destination_address ?? row.destination_account} label="destination address">
                    <span>{shortenAddress(row.destination_address ?? row.destination_account) || "—"}</span>
                  </CopyCell>
                </td>
                <td>
                  <CopyCell value={`${row.amount ?? ""} ${describeAsset(row.asset)}`.trim()} label="amount">
                    <div>{row.amount ?? "—"}</div>
                    <div className="table-subtle">{describeAsset(row.asset)}</div>
                  </CopyCell>
                </td>
                <td>
                  <CopyCell value={row.created_at} label="created timestamp">
                    <span>{formatDateTime(row.created_at)}</span>
                  </CopyCell>
                </td>
                <td className="mono">
                  <TransactionHashLink hash={row.tx_hash} protocol={row.protocol} network={row.network} />
                </td>
                <td>
                  {row.status === "created" ? (
                    <button
                      className="button table-action-button"
                      type="button"
                      disabled={submittingTransactionId === row.id}
                      onClick={() => onSubmitCreated?.(row)}
                    >
                      {submittingTransactionId === row.id ? "Submitting..." : "Submit"}
                    </button>
                  ) : (
                    <span className="table-subtle">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TransactionHashLink({ hash, protocol, network }) {
  const txHash = normalizeCopyValue(hash);

  if (!txHash) {
    return <span className="tx-token tx-token--empty">—</span>;
  }

  const explorerUrl = protocol === "stellar"
    ? `https://stellar.expert/explorer/${encodeURIComponent(network ?? "testnet")}/tx/${encodeURIComponent(txHash)}`
    : null;

  if (!explorerUrl) {
    return <span className="tx-token">{shortenHash(txHash, 12, 8)}</span>;
  }

  return (
    <a
      className="tx-token tx-token-link"
      href={explorerUrl}
      target="_blank"
      rel="noreferrer noopener"
      title="Open in Stellar Expert"
    >
      {shortenHash(txHash, 12, 8)}
    </a>
  );
}

function CopyCell({ value, label, children, onPrimaryAction }) {
  async function handleClick() {
    const text = normalizeCopyValue(value);
    if (!text) {
      return;
    }

    await copyText(text);
    onPrimaryAction?.();
  }

  return (
    <button
      className="tx-copy-button"
      type="button"
      onClick={() => void handleClick()}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {children}
    </button>
  );
}

function normalizeCopyValue(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
