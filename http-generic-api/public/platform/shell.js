(() => {
  "use strict";

  const THEME_KEY = "mad4b_platform_theme";
  const root = document.documentElement;
  const selector = document.querySelector("#theme-select");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

  function storedTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return ["light", "dark", "system"].includes(value) ? value : "system";
    } catch {
      return "system";
    }
  }

  function applyTheme(preference) {
    const theme = preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    if (selector) selector.value = preference;
  }

  function saveTheme(preference) {
    try { localStorage.setItem(THEME_KEY, preference); } catch { /* storage may be disabled */ }
    applyTheme(preference);
  }

  applyTheme(storedTheme());
  selector?.addEventListener("change", (event) => saveTheme(event.target.value));
  systemTheme.addEventListener?.("change", () => {
    if (root.dataset.themePreference === "system") applyTheme("system");
  });

  const grid = document.querySelector("#surface-grid");
  const state = document.querySelector("#catalog-state");
  const count = document.querySelector("#surface-count");
  const template = document.querySelector("#surface-template");

  function renderSurface(surface) {
    const node = template.content.firstElementChild.cloneNode(true);
    const locked = ["locked", "deferred"].includes(surface.status);
    node.dataset.locked = String(locked);
    node.querySelector(".surface-group").textContent = surface.group.replaceAll("-", " ");
    node.querySelector(".surface-state").textContent = surface.status.replaceAll("_", " ");
    node.querySelector("h3").textContent = surface.label;
    node.querySelector("p").textContent = surface.description || "Repository-governed platform experience.";
    node.querySelector(".surface-scope").textContent = surface.scope;
    const link = node.querySelector(".surface-link");
    if (surface.href?.startsWith("/")) link.href = surface.href;
    return node;
  }

  async function loadCatalog() {
    try {
      const response = await fetch("/platform/ui-surfaces", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("catalog unavailable");
      const catalog = await response.json();
      const surfaces = Array.isArray(catalog.surfaces) ? catalog.surfaces : [];
      grid.replaceChildren(...surfaces.map(renderSurface));
      grid.setAttribute("aria-busy", "false");
      count.textContent = String(surfaces.length);
      state.textContent = `${surfaces.length} governed surfaces`;
      if (!surfaces.length) grid.textContent = "No surfaces have passed the repository policy gates yet.";
    } catch {
      grid.setAttribute("aria-busy", "false");
      grid.textContent = "The governed catalog is temporarily unavailable. No unverified routes were exposed.";
      count.textContent = "0";
      state.textContent = "Catalog unavailable";
    }
  }

  loadCatalog();
})();
