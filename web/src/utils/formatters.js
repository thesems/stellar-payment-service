export function shortenAddress(address) {
  if (!address) {
    return "";
  }

  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export function shortenId(id) {
  if (!id) {
    return "";
  }

  if (id.length <= 14) {
    return id;
  }

  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function shortenHash(hash, head = 10, tail = 6) {
  if (!hash) {
    return "";
  }

  if (hash.length <= head + tail + 1) {
    return hash;
  }

  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function describeAsset(asset) {
  if (!asset) {
    return "";
  }

  if (asset.type === "native") {
    return "Native XLM";
  }

  return `${asset.code ?? asset.type}${asset.issuer ? ` · ${shortenAddress(asset.issuer)}` : ""}`;
}

export function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function statusClass(status) {
  if (status === "confirmed") {
    return "status-ok";
  }

  if (status === "failed") {
    return "status-error";
  }

  return "status-checking";
}
