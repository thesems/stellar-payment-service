import { formatError, prettyPrint, requestJson } from "./http.js";

export function bindAccountForm(form, output) {
  form.addEventListener("submit", (event) => {
    void submitAccountLookup(event, output);
  });
}

export function bindPaymentForm(form, output) {
  form.addEventListener("submit", (event) => {
    void submitPayment(event, output);
  });
}

export function bindTransactionListForm(form, output) {
  form.addEventListener("submit", (event) => {
    void submitTransactionList(event, output);
  });
}

export function bindTransactionLookupForm(form, output) {
  form.addEventListener("submit", (event) => {
    void submitTransactionLookup(event, output);
  });
}

export function setDefaultPaymentValues(form) {
  const paymentInputs = form.querySelectorAll("input");

  const defaults = {
    idempotency_key: "xlm-demo-001",
  };

  for (const input of paymentInputs) {
    if (input.name in defaults) {
      input.value = defaults[input.name];
    }
  }
}

async function submitAccountLookup(event, output) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const address = String(form.get("address") ?? "").trim();
  if (!address) return;

  try {
    const data = await requestJson(`/account/${encodeURIComponent(address)}`);
    output.textContent = prettyPrint(data);
  } catch (error) {
    output.textContent = formatError(error);
  }
}

async function submitPayment(event, output) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    idempotency_key: String(form.get("idempotency_key") ?? "").trim(),
    source_secret: String(form.get("source_secret") ?? "").trim(),
    destination: String(form.get("destination") ?? "").trim(),
    amount: String(form.get("amount") ?? "").trim(),
    asset: { type: "native" },
  };

  const memo = String(form.get("memo") ?? "").trim();
  if (memo) {
    payload.memo = memo;
  }

  try {
    const data = await requestJson("/tx/payment", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    output.textContent = prettyPrint(data);
  } catch (error) {
    output.textContent = formatError(error);
  }
}

async function submitTransactionList(event, output) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const account = String(form.get("account") ?? "").trim();
  const limit = String(form.get("limit") ?? "").trim();
  const offset = String(form.get("offset") ?? "").trim();

  const query = new URLSearchParams();
  if (account) {
    query.set("account", account);
  }
  if (limit) {
    query.set("limit", limit);
  }
  if (offset) {
    query.set("offset", offset);
  }

  try {
    const data = await requestJson(`/tx${query.toString() ? `?${query.toString()}` : ""}`);
    output.textContent = prettyPrint(data);
  } catch (error) {
    output.textContent = formatError(error);
  }
}

async function submitTransactionLookup(event, output) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = String(form.get("id") ?? "").trim();
  if (!id) return;

  try {
    const data = await requestJson(`/tx/${encodeURIComponent(id)}`);
    output.textContent = prettyPrint(data);
  } catch (error) {
    output.textContent = formatError(error);
  }
}
