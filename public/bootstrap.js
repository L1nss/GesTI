(() => {
  try {
    const saved = JSON.parse(window.localStorage.getItem("tigest-theme") || "null");
    const theme = saved === "dark" || saved === "light"
      ? saved
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  } catch {
    // O tema padrão do CSS mantém a página utilizável sem armazenamento local.
  }

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const recoveryKey = `gesti:chunk-recovery:${window.location.pathname}`;
    try {
      const previousAttempt = Number(window.sessionStorage.getItem(recoveryKey) || 0);
      if (Date.now() - previousAttempt > 15000) {
        window.sessionStorage.setItem(recoveryKey, String(Date.now()));
        window.location.reload();
      }
    } catch {
      // A recuperação é best-effort quando o armazenamento da sessão está bloqueado.
    }
  });
})();
