export function setupTabs(tabButtons, tabPanels, initialTab) {
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const tabName = button.dataset.tab;
      if (tabName) {
        setActiveTab(tabButtons, tabPanels, tabName);
      }
    });
  }

  setActiveTab(tabButtons, tabPanels, initialTab);
}

function setActiveTab(tabButtons, tabPanels, tabName) {
  for (const button of tabButtons) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== tabName;
  }
}
