import { requestJson } from "./http.js";

export function createHealthMonitor({ statusElement, pingButton, intervalMs }) {
  let inFlight = false;

  const refresh = async () => {
    if (inFlight) return;

    inFlight = true;
    setStatus(statusElement, "Health: checking", "checking");

    try {
      const data = await requestJson("/health");
      setStatus(statusElement, data.ok ? "Health: ok" : "Health: unexpected", data.ok ? "ok" : "error");
    } catch (error) {
      setStatus(statusElement, "Health: down", "error");
      console.error(error);
    } finally {
      inFlight = false;
    }
  };

  pingButton.addEventListener("click", () => void refresh());
  void refresh();
  setInterval(() => void refresh(), intervalMs);
}

function setStatus(element, text, state) {
  element.textContent = text;
  element.classList.remove("status-checking", "status-ok", "status-error");
  element.classList.add(`status-${state}`);
}
