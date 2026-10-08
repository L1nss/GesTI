import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* =====================================================================
   Hooks compartilhados (sem componentes — mantém o fast-refresh limpo).
   ===================================================================== */

export const STORAGE_ERROR_EVENT = "tigest:storage-error";
const identity = (current) => current;

function readSavedValue(key, initialValue) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (Array.isArray(initialValue) && !Array.isArray(saved)) return initialValue;
    return saved ?? initialValue;
  } catch {
    return initialValue;
  }
}

/* Estado persistido no localStorage. A escrita tem debounce de 250 ms para
   não serializar tudo a cada tecla; se a quota estourar, um evento é
   disparado para o ToastProvider avisar o usuário (antes o erro era
   engolido e o usuário achava que tinha salvado). */
export function useSavedState(key, initialValue, serialize = identity) {
  const [value, setValue] = useState(() => readSavedValue(key, initialValue));
  const latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(serialize(value)));
      } catch {
        window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { key } }));
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [key, value, serialize]);

  /* Garante que a última alteração chega ao disco mesmo fechando rápido. */
  useEffect(() => () => {
    try {
      window.localStorage.setItem(key, JSON.stringify(serialize(latest.current)));
    } catch {
      // Sem armazenamento: segue o fluxo.
    }
  }, [key, serialize]);

  const update = useCallback((next) => {
    setValue((current) => (typeof next === "function" ? next(current) : next));
  }, []);

  return [value, update];
}

/* --------------------------------- tema --------------------------------- */

const THEME_KEY = "tigest-theme-v2";

function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Sem acesso ao armazenamento: mantém o tema claro padrão.
  }
  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Tema aplicado apenas nesta sessão.
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a090c" : "#f0edee");
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((current) => (current === "dark" ? "light" : "dark")), []);
  return [theme, toggleTheme];
}
