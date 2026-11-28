(function () {
  "use strict";
  const KEY = "goschool_preferences";
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
  function getPrefs() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function setDensity(value) {
    if (!["compact", "comfortable", "spacious"].includes(value)) return;
    document.documentElement.dataset.density = value;
    const prefs = getPrefs();
    prefs.density = value;
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }
  function init() {
    if (!document.getElementById("goschoolPreferenceStyle")) {
      const style = document.createElement("style");
      style.id = "goschoolPreferenceStyle";
      style.textContent = densityStyle;
      document.head.appendChild(style);
    }
    const prefs = getPrefs();
    if (prefs.density) document.documentElement.dataset.density = prefs.density;
  }
  window.GoSchoolPrefs = {
    setDensity,
    apply: () => {
      const prefs = getPrefs();
      if (prefs.density) setDensity(prefs.density);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
