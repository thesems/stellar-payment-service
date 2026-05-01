import { bindAccountForm, bindPaymentForm, bindTransactionListForm, bindTransactionLookupForm, setDefaultPaymentValues } from "./js/forms.js";
import { createHealthMonitor } from "./js/health.js";
import { elements } from "./js/dom.js";
import { setupTabs } from "./js/tabs.js";

setupTabs(elements.workspaceTabButtons, elements.workspaceTabPanels, "accounts");
setupTabs(elements.transactionTabButtons, elements.transactionTabPanels, "view");
setDefaultPaymentValues(elements.paymentForm);

createHealthMonitor({
  statusElement: elements.serviceStatus,
  pingButton: elements.pingButton,
  intervalMs: 10_000,
});

bindAccountForm(elements.accountForm, elements.accountOutput);
bindPaymentForm(elements.paymentForm, elements.paymentOutput);
bindTransactionListForm(elements.transactionListForm, elements.transactionListOutput);
bindTransactionLookupForm(elements.transactionLookupForm, elements.transactionLookupOutput);
