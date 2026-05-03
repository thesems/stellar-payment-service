import { useEffect, useState } from "react";
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

import { TransactionTable } from "./components/TransactionTable.jsx";
import { Card, Field, OutputPane, TabButton } from "./components/ui.jsx";
import { formatError, prettyPrint, requestJson } from "../js/http.js";
import { shortenAddress } from "./utils/formatters.js";
import brandMarkUrl from "../favicon.svg";
import "../styles.css";

const DEFAULT_CREATE_TRANSACTION = {
  destination: "",
  amount: "",
  memo: "",
  idempotency_key: "xlm-demo-001",
};

const DEFAULT_TRANSACTION_LIST = {
  limit: 20,
  offset: 0,
};

const TRANSACTION_REFRESH_SECONDS = 10;
const WORKSPACE_TABS = new Set(["account", "transactions"]);

function App() {
  const [workspaceTab, setWorkspaceTab] = useState(() => readWorkspaceTabFromUrl());

  const [serviceStatus, setServiceStatus] = useState({
    className: "status-checking",
    label: "Health: checking",
  });

  const [accountAddress, setAccountAddress] = useState("");
  const [accountOutput, setAccountOutput] = useState("No response yet.");

  const [createTransactionForm, setCreateTransactionForm] = useState(DEFAULT_CREATE_TRANSACTION);
  const [createTransactionOutput, setCreateTransactionOutput] = useState("No response yet.");
  const [createTransactionModalOpen, setCreateTransactionModalOpen] = useState(false);

  const [transactionListForm, setTransactionListForm] = useState(DEFAULT_TRANSACTION_LIST);
  const [transactionListRows, setTransactionListRows] = useState([]);
  const [transactionListSummary, setTransactionListSummary] = useState("No page loaded yet.");
  const [transactionListLoading, setTransactionListLoading] = useState(false);
  const [transactionListError, setTransactionListError] = useState("");
  const [transactionRefreshSeconds, setTransactionRefreshSeconds] = useState(TRANSACTION_REFRESH_SECONDS);
  const [submittingTransactionId, setSubmittingTransactionId] = useState("");

  const [transactionIdFilter, setTransactionIdFilter] = useState("");

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

  useEffect(() => {
    function handlePopState() {
      setWorkspaceTab(readWorkspaceTabFromUrl());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (workspaceTab !== "transactions") {
      return;
    }

    void loadTransactionList();
  }, [workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== "transactions") {
      setTransactionRefreshSeconds(TRANSACTION_REFRESH_SECONDS);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (transactionRefreshSeconds <= 1) {
        void loadTransactionList();
        return;
      }

      setTransactionRefreshSeconds((current) => current - 1);
    }, 1_000);

    return () => window.clearTimeout(timeoutId);
  }, [workspaceTab, transactionListForm.offset, transactionRefreshSeconds]);

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

  async function loadTransactionList(overrides = {}) {
    const nextForm = {
      ...transactionListForm,
      ...overrides,
    };

    const query = new URLSearchParams();
    query.set("limit", String(DEFAULT_TRANSACTION_LIST.limit));
    query.set("offset", String(nextForm.offset));

    setTransactionListLoading(true);
    setTransactionListError("");
    setTransactionRefreshSeconds(TRANSACTION_REFRESH_SECONDS);

    try {
      const data = await requestJson(`/tx${query.toString() ? `?${query.toString()}` : ""}`);
      setTransactionListForm({
        limit: DEFAULT_TRANSACTION_LIST.limit,
        offset: nextForm.offset,
      });
      setTransactionListSummary(`Showing ${DEFAULT_TRANSACTION_LIST.limit} transactions from offset ${nextForm.offset}.`);
      setTransactionListRows(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch (error) {
      setTransactionListSummary("Unable to load transaction page.");
      setTransactionListError(formatError(error));
      setTransactionListRows([]);
    } finally {
      setTransactionListLoading(false);
    }
  }

  async function handleTransactionList(event) {
    event.preventDefault();
    await loadTransactionList();
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
      console.error("[freighter] check failed", error);
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: `Could not load Freighter. ${describeError(error)}`,
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
      console.error("[freighter] connect failed", error);
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: `Freighter connection failed. ${describeError(error)}`,
        output: formatError(error),
      });
    }
  }

  async function createPreparedTransaction(event) {
    event.preventDefault();

    setFreighter({
      className: "status-checking",
      label: "Freighter: checking",
      hint: "Connecting and creating transaction...",
      output: "No response yet.",
    });

    try {
      console.info("[freighter] request access");
      const access = await requestAccess();
      if (access?.error) {
        throw new Error(describeFreighterApiError(access.error));
      }

      const address = access?.address ?? (await readFreighterAddress());
      if (!address) {
        throw new Error("Freighter did not return a public key.");
      }

      const destination = createTransactionForm.destination.trim();
      const amount = createTransactionForm.amount.trim();
      const memo = createTransactionForm.memo.trim();
      const idempotencyKey = createTransactionForm.idempotency_key.trim();

      if (!destination || !amount) {
        throw new Error("Destination and amount are required before using Freighter.");
      }
      if (!idempotencyKey) {
        throw new Error("Idempotency key is required before submitting.");
      }

      console.info("[freighter] preparing transaction", {
        address,
        destination,
        amount,
        memo: memo || null,
      });
      const preparePayload = {
        idempotency_key: idempotencyKey,
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

      setCreateTransactionOutput(prettyPrint(prepared));
      setCreateTransactionModalOpen(false);
      await loadTransactionList({ offset: "0" });
      setFreighter({
        className: "status-ok",
        label: "Freighter: ready",
        hint: `Created transaction with ${shortenAddress(address)}.`,
        output: prettyPrint({
          address,
          prepared,
        }),
      });
    } catch (error) {
      console.error("[freighter] create transaction failed", error);
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: `Transaction creation failed. ${describeError(error)}`,
        output: formatError(error),
      });
      setCreateTransactionOutput(formatError(error));
    }
  }

  async function submitCreatedTransaction(transaction) {
    setSubmittingTransactionId(transaction.id);
    setTransactionListError("");
    setFreighter({
      className: "status-checking",
      label: "Freighter: checking",
      hint: "Signing prepared transaction...",
      output: "No response yet.",
    });

    try {
      if (!transaction.prepared_transaction) {
        throw new Error("Transaction does not include a prepared XDR.");
      }

      const access = await requestAccess();
      if (access?.error) {
        throw new Error(describeFreighterApiError(access.error));
      }

      const address = access?.address ?? (await readFreighterAddress());
      if (!address) {
        throw new Error("Freighter did not return a public key.");
      }
      if (address !== transaction.source_account) {
        throw new Error(`Connect Freighter as ${shortenAddress(transaction.source_account)} before submitting.`);
      }

      const network = await readFreighterNetwork();
      if (
        transaction.network_passphrase &&
        network?.networkPassphrase &&
        network.networkPassphrase !== transaction.network_passphrase
      ) {
        throw new Error(
          `Freighter is on ${network.network ?? "another network"} but this transaction is for ${transaction.network_passphrase}.`,
        );
      }

      const signed = await signTransaction(transaction.prepared_transaction, {
        networkPassphrase: transaction.network_passphrase,
        address,
      });
      if (signed?.error) {
        throw new Error(describeFreighterApiError(signed.error));
      }
      if (!signed.signedTxXdr) {
        throw new Error("Freighter did not return a signed transaction.");
      }

      const submission = await requestJson("/tx/submit", {
        method: "POST",
        body: JSON.stringify({
          transaction_id: transaction.id,
          signed_transaction: signed.signedTxXdr,
        }),
      });

      await loadTransactionList();
      setFreighter({
        className: "status-ok",
        label: "Freighter: ready",
        hint: "Submitted transaction.",
        output: prettyPrint({
          address,
          submission,
        }),
      });
    } catch (error) {
      console.error("[freighter] submit transaction failed", error);
      setTransactionListError(formatError(error));
      setFreighter({
        className: "status-error",
        label: "Freighter: error",
        hint: `Transaction submission failed. ${describeError(error)}`,
        output: formatError(error),
      });
    } finally {
      setSubmittingTransactionId("");
    }
  }

  function selectWorkspaceTab(nextTab) {
    setWorkspaceTab(nextTab);
    writeWorkspaceTabToUrl(nextTab);
  }

  const freighterReady = freighter.className === "status-ok";

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <div className="brand-lockup">
            <img className="brand-mark" src={brandMarkUrl} alt="" aria-hidden="true" />
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
            </div>
            <div className="status-row">
              <span className={`pill status-pill ${freighter.className}`} aria-live="polite">
                {freighter.label}
              </span>
              {!freighterReady ? (
                <button className="button button-secondary" type="button" onClick={() => void connectFreighterWallet()}>
                  Connect wallet
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <p className="lede">
            Use this panel to inspect accounts and submit or trace transactions.
          </p>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Workspace tabs">
        <TabButton active={workspaceTab === "account"} onClick={() => selectWorkspaceTab("account")}>
          Account
        </TabButton>
        <TabButton active={workspaceTab === "transactions"} onClick={() => selectWorkspaceTab("transactions")}>
          Transactions
        </TabButton>
      </nav>

      <section className="tab-panels">
        <div className="tab-panel" hidden={workspaceTab !== "account"} role="tabpanel">
          <div className="account-grid">
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
          <section className="tx-stack tx-stack--full">
            <Card
              className="card-wide"
              kicker="Read"
              title="Transactions"
              copy="Shows paginated transactions by default. Use the controls below to move through pages."
            >
              <div className="tx-summary">
                <p className="hint">{transactionListSummary}</p>
                <button className="button" type="button" onClick={() => setCreateTransactionModalOpen(true)}>
                  Create Transaction
                </button>
              </div>
              <form className="form tx-controls" onSubmit={(event) => void handleTransactionList(event)}>
                <Field
                  label="Transaction ID or hash"
                  name="transaction_id_filter"
                  placeholder="Filter this page..."
                  value={transactionIdFilter}
                  onChange={setTransactionIdFilter}
                />
                <div className="button-row tx-button-row">
                  <button className="button button-secondary" type="button" onClick={() => void loadTransactionList()}>
                    Refresh <span className="button-muted">({transactionRefreshSeconds}s)</span>
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      const previousOffset = Math.max(0, transactionListForm.offset - DEFAULT_TRANSACTION_LIST.limit);
                      void loadTransactionList({ offset: previousOffset });
                    }}
                  >
                    Previous
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      const nextOffset = Math.max(0, transactionListForm.offset + DEFAULT_TRANSACTION_LIST.limit);
                      void loadTransactionList({ offset: nextOffset });
                    }}
                  >
                    Next
                  </button>
                </div>
              </form>
              {transactionListError ? (
                <pre className="output" aria-live="polite">
                  {transactionListError}
                </pre>
              ) : null}
              <TransactionTable
                rows={transactionListRows}
                loading={transactionListLoading}
                filter={transactionIdFilter}
                onSelectId={setTransactionIdFilter}
                onSubmitCreated={(transaction) => void submitCreatedTransaction(transaction)}
                submittingTransactionId={submittingTransactionId}
              />
            </Card>
          </section>
        </div>
      </section>

      {createTransactionModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="createTransactionTitle">
            <div className="modal-head">
              <div>
                <p className="card-kicker">Write</p>
                <h2 id="createTransactionTitle">Create Transaction</h2>
              </div>
              <button className="button button-secondary" type="button" onClick={() => setCreateTransactionModalOpen(false)}>
                Close
              </button>
            </div>
            <form className="form" onSubmit={(event) => void createPreparedTransaction(event)}>
              <Field
                label="Destination"
                name="destination"
                placeholder="G..."
                value={createTransactionForm.destination}
                onChange={(value) => setCreateTransactionForm((current) => ({ ...current, destination: value }))}
              />
              <Field
                label="Amount"
                name="amount"
                placeholder="1.0000000"
                inputMode="decimal"
                value={createTransactionForm.amount}
                onChange={(value) => setCreateTransactionForm((current) => ({ ...current, amount: value }))}
              />
              <Field
                label="Memo"
                name="memo"
                placeholder="optional memo"
                maxLength="28"
                value={createTransactionForm.memo}
                required={false}
                onChange={(value) => setCreateTransactionForm((current) => ({ ...current, memo: value }))}
              />
              <Field
                label="Idempotency key"
                name="idempotency_key"
                placeholder="xlm-demo-001"
                value={createTransactionForm.idempotency_key}
                onChange={(value) => setCreateTransactionForm((current) => ({ ...current, idempotency_key: value }))}
              />
              <div className="button-row tx-button-row">
                <button className="button button-secondary" type="button" onClick={() => setCreateTransactionModalOpen(false)}>
                  Cancel
                </button>
                <button className="button" type="submit">
                  Create Transaction
                </button>
              </div>
            </form>
            <OutputPane id="createTransactionOutput" value={createTransactionOutput} />
          </section>
        </div>
      ) : null}
    </main>
  );
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

function describeError(error) {
  if (error instanceof Error) {
    return error.message || "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    return describeFreighterApiError(error);
  }

  return "Unknown error";
}

function describeFreighterApiError(error) {
  if (!error) {
    return "Unknown Freighter error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object") {
    const record = error;
    const message = typeof record.message === "string" ? record.message : "";
    const apiError = typeof record.apiError === "string" ? record.apiError : "";
    const code = typeof record.code === "string" ? record.code : "";

    if (message) {
      return message;
    }

    if (apiError) {
      return apiError;
    }

    if (code) {
      return code;
    }
  }

  return "Unknown Freighter error";
}

function readWorkspaceTabFromUrl() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return WORKSPACE_TABS.has(tab) ? tab : "account";
}

function writeWorkspaceTabToUrl(tab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.pushState({}, "", url);
}

export default App;
