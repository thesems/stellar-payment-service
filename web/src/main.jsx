import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

import { formatError, prettyPrint, requestJson } from "../js/http.js";
import "../styles.css";

const DEFAULT_PREPARE = {
  source_account: "",
  destination: "",
  amount: "",
  memo: "",
};

const DEFAULT_SUBMIT = {
  idempotency_key: "xlm-demo-001",
  signed_transaction: "",
};

const DEFAULT_TRANSACTION_LIST = {
  account: "",
  limit: "20",
  offset: "0",
};

function App() {
  const [workspaceTab, setWorkspaceTab] = useState("account");

  const [serviceStatus, setServiceStatus] = useState({
    className: "status-checking",
    label: "Health: checking",
  });

  const [accountAddress, setAccountAddress] = useState("");
  const [accountOutput, setAccountOutput] = useState("No response yet.");

  const [prepareForm, setPrepareForm] = useState(DEFAULT_PREPARE);
  const [prepareOutput, setPrepareOutput] = useState("No response yet.");

  const [submitForm, setSubmitForm] = useState(DEFAULT_SUBMIT);
  const [submitOutput, setSubmitOutput] = useState("No response yet.");

  const [transactionListForm, setTransactionListForm] = useState(DEFAULT_TRANSACTION_LIST);
  const [transactionListOutput, setTransactionListOutput] = useState("No response yet.");

  const [transactionLookupId, setTransactionLookupId] = useState("");
  const [transactionLookupOutput, setTransactionLookupOutput] = useState("No response yet.");

  const [freighter, setFreighter] = useState({
    className: "status-checking",
    label: "Freighter: idle",
    hint: "No wallet connected yet.",
    output: "No response yet.",
  });

  useEffect(() => {
    void refreshHealth();
    void checkFreighter();
    const intervalId = window.setInterval(() => {
      void refreshHealth();
    }, 10_000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function refreshHealth() {
    setServiceStatus({
      className: "status-checking",
      label: "Health: checking",
    });

    try {
      const data = await requestJson("/health");
      const nextStatus = data?.status ?? (data?.ok ? "ok" : "unknown");
      const nextClass = nextStatus === "ok" ? "status-ok" : "status-error";
      setServiceStatus({
        className: nextClass,
        label: `Health: ${nextStatus}`,
      });
    } catch (error) {
      setServiceStatus({
        className: "status-error",
        label: "Health: error",
      });
    }
  }

  async function handleAccountLookup(event) {
    event.preventDefault();

    const address = accountAddress.trim();
    if (!address) {
      return;
    }

    try {
      const data = await requestJson(`/account/${encodeURIComponent(address)}`);
      setAccountOutput(prettyPrint(data));
    } catch (error) {
      setAccountOutput(formatError(error));
    }
  }

  async function handlePrepareSubmit(event) {
    event.preventDefault();

    const payload = {
      source_account: prepareForm.source_account.trim(),
      destination: prepareForm.destination.trim(),
      amount: prepareForm.amount.trim(),
      asset: { type: "native" },
      ...(prepareForm.memo.trim() ? { memo: prepareForm.memo.trim() } : {}),
    };

    try {
      const data = await requestJson("/tx/prepare", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setPrepareOutput(prettyPrint(data));
    } catch (error) {
      setPrepareOutput(formatError(error));
    }
  }

  async function handleSubmitPayment(event) {
    event.preventDefault();

    const payload = {
      idempotency_key: submitForm.idempotency_key.trim(),
      signed_transaction: submitForm.signed_transaction.trim(),
    };

    try {
      const data = await requestJson("/tx/submit", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setSubmitOutput(prettyPrint(data));
    } catch (error) {
      setSubmitOutput(formatError(error));
    }
  }

  async function handleTransactionList(event) {
    event.preventDefault();

    const query = new URLSearchParams();
    if (transactionListForm.account.trim()) {
      query.set("account", transactionListForm.account.trim());
    }
    if (transactionListForm.limit.trim()) {
      query.set("limit", transactionListForm.limit.trim());
    }
    if (transactionListForm.offset.trim()) {
      query.set("offset", transactionListForm.offset.trim());
    }

    try {
      const data = await requestJson(`/tx${query.toString() ? `?${query.toString()}` : ""}`);
      setTransactionListOutput(prettyPrint(data));
    } catch (error) {
      setTransactionListOutput(formatError(error));
    }
  }

  async function handleTransactionLookup(event) {
    event.preventDefault();

    const id = transactionLookupId.trim();
    if (!id) {
      return;
    }

    try {
      const data = await requestJson(`/tx/${encodeURIComponent(id)}`);
      setTransactionLookupOutput(prettyPrint(data));
    } catch (error) {
      setTransactionLookupOutput(formatError(error));
    }
  }

  async function checkFreighter() {
    setFreighter({
      className: "status-checking",
      label: "Freighter: checking",
      hint: "Checking for Freighter...",
      output: "No response yet.",
    });

    try {
      const installed = await isConnected();
      if (!installed?.isConnected) {
        throw new Error("Freighter is not installed or not enabled.");
      }

      const address = await readFreighterAddress();
      const network = await readFreighterNetwork();

      setFreighter({
        className: "status-ok",
        label: "Freighter: ready",
        hint: `Freighter connected${address ? ` to ${shortenAddress(address)}` : ""}${network?.network ? ` on ${network.network}` : ""}.`,
        output: prettyPrint({
          installed: true,
          connected: true,
          address,
          network,
        }),
      });
    } catch (error) {
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: "Could not load Freighter.",
        output: formatError(error),
      });
    }
  }

  async function connectFreighterWallet() {
    setFreighter({
      className: "status-checking",
      label: "Freighter: checking",
      hint: "Requesting Freighter access...",
      output: "No response yet.",
    });

    try {
      const access = await requestAccess();
      if (access?.error) {
        throw new Error(access.error.message ?? access.error);
      }

      const address = access?.address ?? (await readFreighterAddress());
      if (!address) {
        throw new Error("Freighter did not return a public key.");
      }

      const network = await readFreighterNetwork();
      setPrepareForm((current) => ({
        ...current,
        source_account: address,
      }));

      setFreighter({
        className: "status-ok",
        label: "Freighter: ready",
        hint: `Connected to Freighter as ${shortenAddress(address)} on ${network?.network ?? "unknown network"}.`,
        output: prettyPrint({
          address,
          network,
        }),
      });
    } catch (error) {
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: "Freighter connection failed.",
        output: formatError(error),
      });
    }
  }

  async function prepareSignAndSubmitWithFreighter() {
    setFreighter({
      className: "status-checking",
      label: "Freighter: checking",
      hint: "Connecting and preparing transaction...",
      output: "No response yet.",
    });

    try {
      const access = await requestAccess();
      if (access?.error) {
        throw new Error(access.error.message ?? access.error);
      }

      const address = access?.address ?? (await readFreighterAddress());
      if (!address) {
        throw new Error("Freighter did not return a public key.");
      }

      const destination = prepareForm.destination.trim();
      const amount = prepareForm.amount.trim();
      const memo = prepareForm.memo.trim();
      const idempotencyKey = submitForm.idempotency_key.trim();

      if (!destination || !amount) {
        throw new Error("Destination and amount are required before using Freighter.");
      }
      if (!idempotencyKey) {
        throw new Error("Idempotency key is required before submitting.");
      }

      setPrepareForm((current) => ({
        ...current,
        source_account: address,
      }));

      const preparePayload = {
        source_account: address,
        destination,
        amount,
        asset: { type: "native" },
        ...(memo ? { memo } : {}),
      };

      const prepared = await requestJson("/tx/prepare", {
        method: "POST",
        body: JSON.stringify(preparePayload),
      });

      const network = await readFreighterNetwork();
      if (
        prepared?.network_passphrase &&
        network?.networkPassphrase &&
        network.networkPassphrase !== prepared.network_passphrase
      ) {
        throw new Error(
          `Freighter is on ${network.network ?? "another network"} but this app prepared ${prepared.network_passphrase}.`,
        );
      }

      const signed = await signTransaction(prepared.transaction, {
        networkPassphrase: prepared.network_passphrase,
        address,
      });
      if (signed?.error) {
        throw new Error(signed.error.message ?? signed.error);
      }

      if (!signed.signedTxXdr) {
        throw new Error("Freighter did not return a signed transaction.");
      }

      const submission = await requestJson("/tx/submit", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          signed_transaction: signed.signedTxXdr,
        }),
      });

      setSubmitForm((current) => ({
        ...current,
        signed_transaction: signed.signedTxXdr,
      }));
      setPrepareOutput(prettyPrint(prepared));
      setSubmitOutput(prettyPrint(submission));
      setFreighter({
        className: "status-ok",
        label: "Freighter: ready",
        hint: `Prepared, signed, and submitted with ${shortenAddress(address)}.`,
        output: prettyPrint({
          address,
          prepared,
          submission,
        }),
      });
    } catch (error) {
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: "Freighter submission failed.",
        output: formatError(error),
      });
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <div className="brand-lockup">
            <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
            <div>
              <p className="eyebrow">stellar-payment-service</p>
              <h1>Operations Console</h1>
            </div>
          </div>
          <div className="status-cluster" aria-label="Service status">
            <div className="status-row">
              <span className={`pill status-pill ${serviceStatus.className}`} aria-live="polite">
                {serviceStatus.label}
              </span>
              <button className="button button-secondary" type="button" onClick={() => void refreshHealth()}>
                Check health
              </button>
            </div>
            <div className="status-row">
              <span className={`pill status-pill ${freighter.className}`} aria-live="polite">
                {freighter.label}
              </span>
              <button className="button button-secondary" type="button" onClick={() => void checkFreighter()}>
                Check extension
              </button>
              <button className="button button-secondary" type="button" onClick={() => void connectFreighterWallet()}>
                Connect wallet
              </button>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <p className="lede">
            Use this panel to verify health, inspect accounts, and submit or trace transactions.
          </p>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Workspace tabs">
        <TabButton active={workspaceTab === "account"} onClick={() => setWorkspaceTab("account")}>
          Account
        </TabButton>
        <TabButton active={workspaceTab === "transactions"} onClick={() => setWorkspaceTab("transactions")}>
          View Transactions
        </TabButton>
        <TabButton active={workspaceTab === "submit"} onClick={() => setWorkspaceTab("submit")}>
          Submit Transaction
        </TabButton>
      </nav>

      <section className="tab-panels">
        <div className="tab-panel" hidden={workspaceTab !== "account"} role="tabpanel">
          <div className="grid">
            <Card kicker="Read" title="Account" copy="Fetch sequence and balances for a Stellar public key.">
              <form className="form" onSubmit={(event) => void handleAccountLookup(event)}>
                <Field
                  label="Public key"
                  name="address"
                  placeholder="G..."
                  value={accountAddress}
                  onChange={setAccountAddress}
                />
                <button className="button" type="submit">
                  GET /account/:address
                </button>
              </form>
              <OutputPane id="accountOutput" value={accountOutput} />
            </Card>
          </div>
        </div>

        <div className="tab-panel" hidden={workspaceTab !== "transactions"} role="tabpanel">
          <section className="tx-grid">
            <Card
              kicker="Read"
              title="Transaction list"
              copy="List all transactions, optionally filtered by account, with limit and offset pagination."
            >
              <form className="form" onSubmit={(event) => void handleTransactionList(event)}>
                <Field
                  label="Account"
                  name="account"
                  placeholder="optional G..."
                  value={transactionListForm.account}
                  onChange={(value) => setTransactionListForm((current) => ({ ...current, account: value }))}
                />
                <Field
                  label="Limit"
                  name="limit"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={transactionListForm.limit}
                  onChange={(value) => setTransactionListForm((current) => ({ ...current, limit: value }))}
                />
                <Field
                  label="Offset"
                  name="offset"
                  type="number"
                  min="0"
                  step="1"
                  value={transactionListForm.offset}
                  onChange={(value) => setTransactionListForm((current) => ({ ...current, offset: value }))}
                />
                <button className="button" type="submit">
                  GET /tx
                </button>
              </form>
              <OutputPane id="transactionListOutput" value={transactionListOutput} />
            </Card>

            <Card kicker="Look-up" title="Transaction" copy="Fetch a transaction by UUID or Stellar hash.">
              <form className="form" onSubmit={(event) => void handleTransactionLookup(event)}>
                <Field
                  label="Transaction ID or hash"
                  name="id"
                  placeholder="UUID or 64-char hash"
                  value={transactionLookupId}
                  onChange={setTransactionLookupId}
                />
                <button className="button" type="submit">
                  GET /tx/:id
                </button>
                <p className="hint">Use the ID or hash returned by the payment response.</p>
              </form>
              <OutputPane id="transactionLookupOutput" value={transactionLookupOutput} />
            </Card>
          </section>
        </div>

        <div className="tab-panel" hidden={workspaceTab !== "submit"} role="tabpanel">
          <section className="tx-grid">
            <Card kicker="Write" title="Prepare" copy="Build an unsigned native XLM payment for wallet signing.">
              <form className="form" onSubmit={(event) => void handlePrepareSubmit(event)}>
                <Field
                  label="Source account"
                  name="source_account"
                  placeholder="G..."
                  value={prepareForm.source_account}
                  onChange={(value) => setPrepareForm((current) => ({ ...current, source_account: value }))}
                />
                <Field
                  label="Destination"
                  name="destination"
                  placeholder="G..."
                  value={prepareForm.destination}
                  onChange={(value) => setPrepareForm((current) => ({ ...current, destination: value }))}
                />
                <Field
                  label="Amount"
                  name="amount"
                  placeholder="1.0000000"
                  inputMode="decimal"
                  value={prepareForm.amount}
                  onChange={(value) => setPrepareForm((current) => ({ ...current, amount: value }))}
                />
                <Field
                  label="Memo"
                  name="memo"
                  placeholder="optional memo"
                  maxLength="28"
                  value={prepareForm.memo}
                  onChange={(value) => setPrepareForm((current) => ({ ...current, memo: value }))}
                />
                <button className="button" type="submit">
                  POST /tx/prepare
                </button>
              </form>
              <OutputPane id="prepareOutput" value={prepareOutput} />
            </Card>

            <Card kicker="Write" title="Submit" copy="Send a wallet-signed XDR to Horizon and start tracking it.">
              <form className="form" onSubmit={(event) => void handleSubmitPayment(event)}>
                <Field
                  label="Idempotency key"
                  name="idempotency_key"
                  placeholder="xlm-demo-001"
                  value={submitForm.idempotency_key}
                  onChange={(value) => setSubmitForm((current) => ({ ...current, idempotency_key: value }))}
                />
                <TextareaField
                  label="Signed transaction"
                  name="signed_transaction"
                  placeholder="base64 XDR from wallet"
                  rows={6}
                  value={submitForm.signed_transaction}
                  onChange={(value) => setSubmitForm((current) => ({ ...current, signed_transaction: value }))}
                />
                <button className="button" type="submit">
                  POST /tx/submit
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void prepareSignAndSubmitWithFreighter()}
                >
                  Prepare, sign, submit with Freighter
                </button>
              </form>
              <OutputPane id="submitOutput" value={submitOutput} />
            </Card>
          </section>
        </div>
      </section>
    </main>
  );
}

function Card({ kicker, title, copy, children }) {
  return (
    <article className="card">
      <div className="card-head">
        <div>
          <p className="card-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <p className="card-copy">{copy}</p>
      {children}
    </article>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      className={`tab-button ${active ? "is-active" : ""}`}
      type="button"
      role="tab"
      aria-selected={String(active)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  min,
  max,
  step,
  maxLength,
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}

function TextareaField({
  label,
  name,
  value,
  onChange,
  placeholder,
  rows = 6,
  maxLength,
}) {
  return (
    <label>
      {label}
      <textarea
        name={name}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}

function OutputPane({ id, value }) {
  return (
    <pre className="output" id={id}>
      {value}
    </pre>
  );
}

function shortenAddress(address) {
  if (!address) {
    return "";
  }

  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

async function readFreighterAddress() {
  const result = await getAddress();
  if (result?.error) {
    throw new Error(result.error.message ?? result.error);
  }

  return result?.address ?? "";
}

async function readFreighterNetwork() {
  const result = await getNetwork();
  if (result?.error) {
    throw new Error(result.error.message ?? result.error);
  }

  return result;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
