(function () {
  "use strict";
  const KEY = "goschool_preferences";
  const translations = {
    "en": {
      "Início":"Home","Sobre":"About","Contato":"Contact","Entrar":"Sign in","Conheça o sistema":"Explore the system",
      "Configurações":"Settings","Voltar ao painel":"Back to dashboard","Gerencie seus dados e preferências":"Manage your data and preferences","Sair":"Sign out",
      "Painel Administrativo":"Admin Dashboard","Visão geral e gerenciamento do GoSchool":"GoSchool overview and management","Atualizar":"Refresh",
      "Usuários":"Users","Cadastro institucional":"Institutional registration","Cardápio":"Menu","Reservas":"Reservations","Desperdício":"Waste","Preferências":"Preferences","Perfil":"Profile","Alergias":"Allergies","Notificações":"Notifications",
      "Densidade da Interface":"Interface density","Ajuste o espaçamento dos elementos":"Adjust element spacing","Idioma":"Language","Idioma da interface":"Interface language",
      "Confortável":"Comfortable","Compacta":"Compact","Espaçosa":"Spacious","Claro":"Light","Escuro":"Dark","Sistema":"System",
      "Salvar Alterações":"Save changes","Cancelar":"Cancel","Confirmar":"Confirm","Buscar":"Search","Carregando...":"Loading...",
      "Área do aluno":"Student area","Meu perfil":"My profile","Seu espaço escolar":"Your school space","Confira as refeições disponíveis para hoje.":"Check today's available meals.",
      "Relatórios de Desperdício":"Waste reports","Acompanhe os indicadores de desperdício de alimentos.":"Track food waste indicators.",
      "Gerenciamento de usuários":"User management","Consulte os usuários cadastrados no GoSchool.":"View users registered in GoSchool.",
      "Nova reserva":"New reservation","Minhas reservas":"My reservations","Reservas ao vivo":"Live reservations","Solicitar reserva":"Request a reservation",
      "Bem-vindo ao GoSchool":"Welcome to GoSchool","Entre com sua conta Google institucional para continuar.":"Sign in with your institutional Google account to continue."
    },
    "es": {
      "Início":"Inicio","Sobre":"Acerca de","Contato":"Contacto","Entrar":"Entrar","Conheça o sistema":"Conozca el sistema",
      "Configurações":"Configuración","Voltar ao painel":"Volver al panel","Gerencie seus dados e preferências":"Administre sus datos y preferencias","Sair":"Salir",
      "Painel Administrativo":"Panel administrativo","Visão geral e gerenciamento do GoSchool":"Resumen y administración de GoSchool","Atualizar":"Actualizar",
      "Usuários":"Usuarios","Cadastro institucional":"Registro institucional","Cardápio":"Menú","Reservas":"Reservas","Desperdício":"Desperdicio","Preferências":"Preferencias","Perfil":"Perfil","Alergias":"Alergias","Notificações":"Notificaciones",
      "Densidade da Interface":"Densidad de la interfaz","Ajuste o espaçamento dos elementos":"Ajuste el espaciado de los elementos","Idioma":"Idioma","Idioma da interface":"Idioma de la interfaz",
      "Confortável":"Cómoda","Compacta":"Compacta","Espaçosa":"Espaciosa","Claro":"Claro","Escuro":"Oscuro","Sistema":"Sistema",
      "Salvar Alterações":"Guardar cambios","Cancelar":"Cancelar","Confirmar":"Confirmar","Buscar":"Buscar","Carregando...":"Cargando...",
      "Área do aluno":"Área del alumno","Meu perfil":"Mi perfil","Seu espaço escolar":"Su espacio escolar","Confira as refeições disponíveis para hoje.":"Consulte las comidas disponibles para hoy.",
      "Relatórios de Desperdício":"Informes de desperdicio","Acompanhe os indicadores de desperdício de alimentos.":"Consulte los indicadores de desperdicio de alimentos.",
      "Gerenciamento de usuários":"Gestión de usuarios","Consulte os usuários cadastrados no GoSchool.":"Consulte los usuarios registrados en GoSchool.",
      "Nova reserva":"Nueva reserva","Minhas reservas":"Mis reservas","Reservas ao vivo":"Reservas en vivo","Solicitar reserva":"Solicitar reserva",
      "Bem-vindo ao GoSchool":"Bienvenido a GoSchool","Entre com sua conta Google institucional para continuar.":"Inicie sesión con su cuenta institucional de Google para continuar."
    }
  };
  const densityStyle = `
    html[data-density="compact"] { --gs-density-scale:.82; }
    html[data-density="comfortable"] { --gs-density-scale:1; }
    html[data-density="spacious"] { --gs-density-scale:1.18; }
    html[data-density] body { --density-gap:calc(1rem * var(--gs-density-scale,1)); }
    html[data-density="compact"] main,html[data-density="compact"] .main-content,html[data-density="compact"] .content-wrapper { gap:calc(1rem * .82)!important; }
    html[data-density="compact"] section,html[data-density="compact"] article,html[data-density="compact"] .card,html[data-density="compact"] .config-section,html[data-density="compact"] .panel,html[data-density="compact"] .stat-card { padding:calc(var(--card-padding,1rem) * .82)!important; }
    html[data-density="spacious"] main,html[data-density="spacious"] .main-content,html[data-density="spacious"] .content-wrapper { gap:calc(1rem * 1.18)!important; }
    html[data-density="spacious"] section,html[data-density="spacious"] article,html[data-density="spacious"] .card,html[data-density="spacious"] .config-section,html[data-density="spacious"] .panel,html[data-density="spacious"] .stat-card { padding:calc(var(--card-padding,1rem) * 1.18)!important; }
    html[data-density="compact"] button,html[data-density="compact"] input,html[data-density="compact"] select { min-height:30px; }
    html[data-density="spacious"] button,html[data-density="spacious"] input,html[data-density="spacious"] select { min-height:42px; }
  `;
  function getPrefs(){ try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch(_){return {}} }
  function setDensity(value){ if(!["compact","comfortable","spacious"].includes(value))return; document.documentElement.dataset.density=value; const p=getPrefs();p.density=value;localStorage.setItem(KEY,JSON.stringify(p)); }
  const originals = new WeakMap();
  function translateNode(node, dict, lang) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const original = originals.get(node);
    if (lang === "pt-BR") {
      node.nodeValue = original;
      return;
    }
    let translated = original;
    Object.keys(dict || {}).sort((a, b) => b.length - a.length).forEach(key => {
      if (!key) return;
      translated = translated.split(key).join(dict[key]);
    });
    node.nodeValue = translated;
  }
  function translate(lang, root = document.body) {
    const dict = translations[lang];
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => translateNode(node, dict, lang));
    document.documentElement.lang = lang === "en" ? "en-US" : lang === "es" ? "es-ES" : "pt-BR";
  }
  function setLang(value){const lang=value==="en-US"||value==="en"?"en":value==="es-ES"||value==="es"?"es":"pt-BR";const p=getPrefs();p.language=lang==="en"?"en-US":lang==="es"?"es-ES":"pt-BR";localStorage.setItem(KEY,JSON.stringify(p)); translate(lang);}
  function init(){
    if(!document.getElementById("goschoolPreferenceStyle")){const s=document.createElement("style");s.id="goschoolPreferenceStyle";s.textContent=densityStyle;document.head.appendChild(s);}
    const p=getPrefs();if(p.density)document.documentElement.dataset.density=p.density;
    if(p.language&&p.language!=="pt-BR")translate(p.language==="en-US"?"en":"es");
    if (!window.__goSchoolTranslationObserver) {
      window.__goSchoolTranslationObserver = new MutationObserver(records => {
        const lang = getPrefs().language;
        if (!lang || lang === "pt-BR") return;
        const code = lang === "en-US" || lang === "en" ? "en" : "es";
        records.forEach(record => {
          record.addedNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) translateNode(node, translations[code], code);
            else if (node.nodeType === Node.ELEMENT_NODE) translate(code, node);
          });
        });
      });
      window.__goSchoolTranslationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }
  window.GoSchoolPrefs={setLang,setDensity,apply:()=>{const p=getPrefs();if(p.density)setDensity(p.density);if(p.language&&p.language!=="pt-BR")translate(p.language==="en-US"?"en":"es");}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();