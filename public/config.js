/* =========================================================
   GoSchool — Configurações
   Preferências, alergias, notificações e segurança.
   Preferências e alergias são persistidas por usuário no servidor.
   ========================================================= */
(function () {
  "use strict";

  const STORAGE_PREFIX = "goschool_config_v1";
  const DEFAULTS = {
    density: "comfortable",
    theme: "claro",
    language: "pt-BR",
    cardapio_view: "semanal",
    show_allergens: true,
    highlight_restrictions: true,
    push_enabled: false,
    reminder_enabled: true,
    allergy_alert_enabled: true,
    weekly_summary_enabled: false
  };

  const ALLERGENS = [
    { category: "Grãos e cereais", items: ["Glúten", "Trigo", "Centeio", "Cevada", "Aveia"] },
    { category: "Leite e ovos", items: ["Leite", "Lactose", "Ovos"] },
    { category: "Oleaginosas e sementes", items: ["Amendoim", "Castanhas", "Amêndoas", "Nozes", "Avelã", "Gergelim"] },
    { category: "Outros", items: ["Soja", "Peixes", "Crustáceos", "Moluscos", "Mostarda", "Aipo", "Látex"] }
  ];

  let currentUser = null;
  let preferences = { ...DEFAULTS };
  let selectedAllergens = [];

  function userKey(suffix) {
    const id = currentUser && (currentUser.id || currentUser.email);
    return STORAGE_PREFIX + ":" + (id ? String(id).toLowerCase() : "local") + ":" + suffix;
  }

  function readStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("[Config] Não foi possível ler o armazenamento local.", error);
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("[Config] Não foi possível salvar no armazenamento local.", error);
      showStatus("Não foi possível salvar neste navegador.", "error");
      return false;
    }
  }

  function showStatus(message, type) {
    let status = document.getElementById("configStatus");
    if (!status) {
      status = document.createElement("div");
      status.id = "configStatus";
      status.className = "config-toast";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      document.body.appendChild(status);
    }
    status.textContent = message;
    status.dataset.type = type || "success";
    status.classList.add("visible");
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => status.classList.remove("visible"), 3200);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function init() {
    if (!window.Auth) {
      showStatus("O módulo de autenticação não foi carregado.", "error");
      return;
    }

    const authenticated = await Auth.init({
      requireAuth: true,
      allowedRoles: ["aluno", "professor", "adm"]
    });
    if (!authenticated) return;

    currentUser = typeof Auth.getCurrentUser === "function" ? await Auth.getCurrentUser() : null;
    preferences = { ...DEFAULTS };
    selectedAllergens = [];
    try {
      const response = await Auth.apiCall("/api/configuracoes", { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.sucesso !== true) throw new Error(data.erro || "Não foi possível carregar as configurações.");
      preferences = { ...DEFAULTS, ...(data.preferencias || {}) };
      selectedAllergens = Array.isArray(data.alergias) ? data.alergias : [];
    } catch (error) {
      console.error("[Config] Falha ao carregar configurações do servidor.", error);
      showStatus(error.message || "Erro ao carregar configurações do banco.", "error");
    }

    if (preferences.theme && window.GoSchoolTheme) window.GoSchoolTheme.set(preferences.theme);

    initTabs();
    initTopbar();
    initPreferences();
    initAllergens();
    initNotifications();
    initSecurity();
    initProfileFallback();
    initAdminSettings();
    applyPreferences();
    syncControls();
    updateSecurityInfo();
    updateSidebarUser();

    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (["perfil", "preferencias", "alergias", "notificacoes", "seguranca", "administracao"].includes(tab)) {
      switchTab(tab);
    }
  }

  function initTabs() {
    const tabs = document.getElementById("configTabs");
    if (!tabs) return;

    const buttons = Array.from(tabs.querySelectorAll('[role="tab"][data-tab]'));

    buttons.forEach((button) => {
      button.type = "button";
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });

    tabs.addEventListener("keydown", (event) => {
      const index = buttons.indexOf(document.activeElement);
      if (index < 0 || !buttons.length) return;

      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;

      event.preventDefault();
      buttons[next].focus();
      switchTab(buttons[next].dataset.tab);
    });

    // Garante que o painel inicial corresponda ao botão marcado como ativo.
    const selected = buttons.find((button) => button.getAttribute("aria-selected") === "true")
      || buttons[0];
    if (selected) switchTab(selected.dataset.tab, false);
  }

  function switchTab(tab, updateUrl = true) {
    const button = document.querySelector('.config-tab-btn[data-tab="' + tab + '"]');
    const panel = document.getElementById("panel-" + tab);

    // Evita esconder todos os painéis caso exista um nome inválido na URL.
    if (!button || !panel) return;

    document.querySelectorAll(".config-tab-btn").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });

    document.querySelectorAll(".config-tab-panel").forEach((item) => {
      const active = item === panel;
      item.hidden = !active;
      item.classList.toggle("active", active);
      item.setAttribute("aria-hidden", String(!active));
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url);
    }
  }


  function initTopbar() {
    const name = currentUser && (currentUser.nome || currentUser.name);
    const nameEl = document.getElementById("userName");
    if (nameEl && name) nameEl.textContent = name;
    const back = document.getElementById("configBack");
    if (back) {
      const home = { aluno: "/aluno.html", professor: "/professor.html", adm: "/adm.html" };
      back.href = home[currentUser?.tipo] || "/";
    }
    document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());
  }

  function initSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const hamburger = document.getElementById("hamburgerBtn");
    const close = () => {
      sidebar?.classList.remove("open");
      if (overlay) {
        overlay.classList.remove("open");
        overlay.hidden = true;
      }
      hamburger?.setAttribute("aria-expanded", "false");
    };
    hamburger?.addEventListener("click", () => {
      const open = sidebar.classList.toggle("open");
      if (overlay) {
        overlay.hidden = !open;
        overlay.classList.toggle("open", open);
      }
      hamburger.setAttribute("aria-expanded", String(open));
    });
    overlay?.addEventListener("click", close);
    document.querySelectorAll(".menu-item").forEach((item) => {
      item.addEventListener("click", () => {
        if (window.innerWidth < 768) close();
      });
    });
    document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());
  }

  function initPreferences() {
    document.querySelectorAll('input[name="theme"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const themeMap = { light: "claro", dark: "escuro", system: "sistema" };
        const theme = themeMap[radio.value] || "claro";
        preferences.theme = theme;
        if (window.GoSchoolTheme) window.GoSchoolTheme.set(theme);
        savePreferences();
      });
    });

    const map = {
      prefDensidade: "density",
      prefIdioma: "language",
      prefCardapioView: "cardapio_view"
    };
    Object.entries(map).forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener("change", (event) => {
        preferences[key] = event.target.value;
        applyPreferences();
        savePreferences();
      });
    });

    document.querySelectorAll("#panel-preferencias .toggle-switch input").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.closest(".toggle-switch")?.dataset.pref;
        if (!key) return;
        preferences[key] = input.checked;
        savePreferences();
      });
    });
  }

  function applyPreferences() {
    const root = document.documentElement;
    root.dataset.density = preferences.density;
    root.lang = preferences.language;
    root.classList.remove("density-comfortable", "density-compact", "density-spacious");
    root.classList.add("density-" + preferences.density);
    if (window.GoSchoolPrefs && typeof window.GoSchoolPrefs.setLang === "function") {
      // O mecanismo global aceita pt-BR, en e es.
      const lang = preferences.language === "en-US" ? "en" : preferences.language === "es-ES" ? "es" : "pt-BR";
      window.GoSchoolPrefs.setLang(lang);
    }
  }

  function syncControls() {
    const theme = preferences.theme || (window.GoSchoolTheme ? window.GoSchoolTheme.get() : "claro");
    const themeValue = theme === "escuro" ? "dark" : theme === "sistema" ? "system" : "light";
    const themeRadio = document.querySelector('input[name="theme"][value="' + themeValue + '"]');
    if (themeRadio) themeRadio.checked = true;

    const ids = {
      prefDensidade: "density",
      prefIdioma: "language",
      prefCardapioView: "cardapio_view"
    };
    Object.entries(ids).forEach(([id, key]) => {
      const element = document.getElementById(id);
      if (element) element.value = preferences[key];
    });
    document.querySelectorAll("#panel-preferencias .toggle-switch input").forEach((input) => {
      const key = input.closest(".toggle-switch")?.dataset.pref;
      if (key in preferences) input.checked = Boolean(preferences[key]);
    });
    document.querySelectorAll("#panel-notificacoes .toggle-switch input").forEach((input) => {
      const key = input.closest(".toggle-switch")?.dataset.pref;
      if (key in preferences) input.checked = Boolean(preferences[key]);
    });
  }

  async function savePreferences() {
    try {
      const response = await Auth.apiCall("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ preferencias: preferences, alergias: selectedAllergens })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.sucesso !== true) throw new Error(data.erro || "Não foi possível salvar as configurações.");
      showStatus("Preferências salvas no banco de dados.");
    } catch (error) {
      console.error("[Config] Falha ao salvar configurações.", error);
      showStatus(error.message || "Erro ao salvar no banco de dados.", "error");
    }
  }

  function initAllergens() {
    const grid = document.getElementById("alergenosGrid");
    if (!grid) return;

    grid.innerHTML = ALLERGENS.map((group) => `
      <section class="alergenos-categoria">
        <h4 class="alergenos-categoria-titulo">${escapeHtml(group.category)}</h4>
        <div class="alergenos-lista">
          ${group.items.map((name) => `
            <label class="alergeno-item">
              <input type="checkbox" value="${escapeHtml(name)}" ${selectedAllergens.includes(name) ? "checked" : ""}>
              <span class="alergeno-nome">${escapeHtml(name)}</span>
            </label>
          `).join("")}
        </div>
      </section>
    `).join("");

    document.getElementById("btnSalvarAlergias")?.addEventListener("click", () => {
      selectedAllergens = Array.from(grid.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
      savePreferences();
    });
  }

  function initNotifications() {
    document.querySelectorAll("#panel-notificacoes .toggle-switch input").forEach((input) => {
      input.addEventListener("change", async () => {
        const key = input.closest(".toggle-switch")?.dataset.pref;
        if (!key) return;

        if (key === "push_enabled" && input.checked) {
          const allowed = await requestNotificationPermission();
          if (!allowed) {
            input.checked = false;
            preferences.push_enabled = false;
            savePreferences();
            return;
          }
        }
        preferences[key] = input.checked;
        savePreferences();
      });
    });

    document.getElementById("btnTestNotification")?.addEventListener("click", sendTestNotification);
    updateNotificationPermissionStatus();
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      showStatus("Este navegador não oferece suporte a notificações.", "error");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      showStatus("Notificações bloqueadas. Altere a permissão nas configurações do navegador.", "error");
      return false;
    }
    const permission = await Notification.requestPermission();
    updateNotificationPermissionStatus();
    if (permission !== "granted") {
      showStatus("Permissão para notificações não concedida.", "error");
      return false;
    }
    return true;
  }

  function updateNotificationPermissionStatus() {
    const status = document.getElementById("notificationPermissionStatus");
    if (!status) return;
    if (!("Notification" in window)) {
      status.textContent = "Seu navegador não oferece suporte a notificações push.";
    } else if (Notification.permission === "granted") {
      status.textContent = "Permissão concedida pelo navegador. O envio de alertas reais ainda depende do serviço de notificações do sistema.";
    } else if (Notification.permission === "denied") {
      status.textContent = "Permissão bloqueada no navegador. Libere-a nas configurações do site para receber notificações.";
    } else {
      status.textContent = "O navegador ainda não recebeu sua autorização para mostrar notificações.";
    }
  }

  async function sendTestNotification() {
    const allowed = await requestNotificationPermission();
    if (!allowed) return;
    try {
      new Notification("GoSchool", {
        body: "As notificações do navegador estão funcionando neste dispositivo.",
        icon: "/logo-simplificada.png"
      });
      showStatus("Notificação de teste enviada.");
    } catch (error) {
      console.error("[Config] Falha ao exibir notificação.", error);
      showStatus("Não foi possível exibir a notificação.", "error");
    }
  }

  function initSecurity() {
    document.getElementById("btnSecurityLogout")?.addEventListener("click", async () => {
      if (window.confirm("Deseja encerrar sua sessão neste dispositivo?")) {
        await Auth.logout();
      }
    });
  }

  function updateSecurityInfo() {
    const email = document.getElementById("securityEmail");
    if (email) email.textContent = (currentUser && currentUser.email) || "Conta institucional autenticada";
  }

  function updateSidebarUser() {
    const name = currentUser && (currentUser.nome || currentUser.name);
    const label = name ? "Olá, " + name.split(" ")[0] + "!" : "Olá, Usuário!";
    const sidebarName = document.getElementById("sidebarUserName");
    const headerName = document.getElementById("userName");
    const avatar = document.getElementById("userAvatar");
    if (sidebarName) sidebarName.textContent = label;
    if (headerName && name) headerName.textContent = name;
    if (avatar && name) avatar.textContent = name.charAt(0).toUpperCase();
  }


  function initAdminSettings() {
    const panel = document.getElementById("panel-administracao");
    if (!panel || !currentUser || currentUser.tipo !== "adm") return;
    const body = document.getElementById("adminUsuariosTabela");
    const status = document.getElementById("adminUsuariosStatus");
    const button = document.getElementById("btnAtualizarUsuarios");
    const roleLabels = { adm: "Administrador", professor: "Professor", aluno: "Aluno" };

    async function carregarUsuarios() {
      if (button) button.disabled = true;
      if (status) status.textContent = "Consultando usuários no servidor...";
      if (body) body.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';
      try {
        const response = await fetch("/api/admin/usuarios", { credentials: "same-origin", headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.sucesso !== true || !Array.isArray(data.usuarios)) {
          throw new Error(data.erro || "Não foi possível consultar a lista.");
        }
        body.innerHTML = data.usuarios.map((user) => {
          const safe = (value) => escapeHtml(value == null ? "" : value);
          const role = roleLabels[user.role] || user.role || "—";
          return '<tr><td>' + safe(user.nome) + '</td><td>' + safe(user.email) + '</td><td>' + safe(role) + '</td><td><span class="admin-config-status ' + (user.ativo ? "ativo" : "inativo") + '">' + (user.ativo ? "Ativo" : "Inativo") + '</span></td></tr>';
        }).join("") || '<tr><td colspan="4">Nenhum usuário encontrado.</td></tr>';
        if (status) status.textContent = data.usuarios.length + " usuário(s) carregado(s) do backend.";
      } catch (error) {
        if (body) body.innerHTML = '<tr><td colspan="4">Lista indisponível.</td></tr>';
        if (status) status.textContent = error.message || "Erro ao carregar usuários.";
      } finally {
        if (button) button.disabled = false;
      }
    }
    button?.addEventListener("click", carregarUsuarios);
    carregarUsuarios();
  }

  function initProfileFallback() {
    // O backend atual não disponibiliza as rotas de edição de perfil.
    const form = document.getElementById("formPerfil");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        showStatus("A edição do perfil ainda precisa ser conectada a uma rota do servidor.", "error");
      });
    }
    if (currentUser) {
      const name = document.getElementById("perfilNome");
      const email = document.getElementById("perfilEmail");
      const role = document.getElementById("perfilRole");
      if (name) name.value = currentUser.nome || "";
      if (email) email.value = currentUser.email || "";
      if (role) {
        const labels = { aluno: "Aluno", professor: "Professor", adm: "Administrador" };
        role.value = labels[currentUser.tipo] || currentUser.tipo || "";
      }
    }
  }

  window.Config = {
    init,
    switchTab,
    getPreferences: () => ({ ...preferences }),
    getAllergens: () => [...selectedAllergens],
    sendTestNotification
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
