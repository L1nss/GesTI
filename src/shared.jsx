import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "motion/react";
import { ToastContext } from "./toast.js";
import { STORAGE_ERROR_EVENT } from "./hooks.js";
import { captureAppError } from "./supabaseApi.js";

/* =====================================================================
   Primitivas de UI. Este arquivo exporta SOMENTE componentes (exigência
   do fast-refresh); helpers ficam em utils.js e hooks em hooks.js.
   ===================================================================== */

export function Icon({ name, size = 20, className = "" }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    ticket: <><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 10v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-10Z" /><path d="M13 5v2m0 4v2m0 4v2" /></>,
    headset: <><path d="M3 14v-3a9 9 0 0 1 18 0v3" /><rect x="3" y="13" width="4" height="7" rx="2" /><rect x="17" y="13" width="4" height="7" rx="2" /><path d="M17 20a5 5 0 0 1-5 2h-1" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9" /></>,
    receipt: <><path d="M4 3h16v18l-4-2-4 2-4-2-4 2V3Z" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-4h6v4M8 7h2m4 0h2M8 11h2m4 0h2" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <path d="M12 5v14m-7-7h14" />,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3M9 9h6v6H9z" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 1 0 7.75M16 3.13a4 4 0 0 1 0 7.75" /></>,
    warning: <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4 1.4" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5m5 5H9" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
    print: <><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6Z" /></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="m1 1 22 22" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 15 4-6 4 3 5-8" /></>,
    trend: <><path d="m23 6-9.5 9.5-5-5L1 18" /><path d="M17 6h6v6" /></>,
    spinner: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    wrench: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    clipboard: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h2m4 0h2"/></>,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></>,
    sliders: <><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /></>,
    user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    spark: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  };
  return <svg aria-hidden="true" className={className || undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.info}</svg>;
}

/* ----------------------------- toasts ----------------------------- */

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const notify = useCallback((toast) => {
    const options = typeof toast === "string" ? { message: toast } : toast;
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { id, title: "GesTI", ...options }]);
    window.setTimeout(() => dismiss(id), 4600);
  }, [dismiss]);

  /* Avisa quando o localStorage está cheio (o erro vinha silenciado). */
  useEffect(() => {
    const handleStorageError = () => notify({
      tone: "info",
      title: "Armazenamento cheio",
      message: "Não foi possível salvar neste navegador. Baixe um backup na Visão geral e remova registros antigos.",
    });
    window.addEventListener(STORAGE_ERROR_EVENT, handleStorageError);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, handleStorageError);
  }, [notify]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div aria-live="polite" className="toast-region">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div animate={{ opacity: 1, scale: 1, x: 0 }} className={`toast toast-${toast.tone || "info"}`} exit={{ opacity: 0, scale: 0.97, x: 24, transition: { duration: 0.16 } }} initial={{ opacity: 0, scale: 0.97, x: 32 }} key={toast.id} layout role="status" transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              <span className="toast-content"><strong className="toast-title">{toast.title}</strong><span className="toast-message">{toast.message}</span></span>
              <button aria-label="Fechar aviso" className="toast-close" onClick={() => dismiss(toast.id)} type="button"><Icon name="close" size={13} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/* --------------------------- primitivas --------------------------- */

export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Button({ children, onClick, variant = "primary", type = "button", disabled = false, className = "" }) {
  const reduceMotion = useReducedMotion();
  return <motion.button className={`button button-${variant} ${className}`} disabled={disabled} onClick={onClick} type={type} whileHover={reduceMotion || disabled ? undefined : { y: -1 }} whileTap={reduceMotion || disabled ? undefined : { scale: 0.99 }} transition={{ duration: reduceMotion ? 0 : 0.16 }}>{children}</motion.button>;
}

/* Modal acessível: foco inicial no diálogo, Tab preso dentro dele, fundo
   sem rolagem e foco devolvido a quem abriu. */
export function Modal({ title, onClose, children, wide = false }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const focusables = () => Array.from(node.querySelectorAll("button, [href], input, select, textarea")).filter((element) => !element.disabled && element.offsetParent !== null);

    focusables()[0]?.focus();

    const handleKey = (event) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const firstElement = list[0];
      const lastElement = list[list.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.style.overflow = "hidden";
    node.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      node.removeEventListener("keydown", handleKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="modal-title" aria-modal="true" className={`modal ${wide ? "modal-wide" : ""}`} ref={dialogRef} role="dialog">
        <div className="modal-heading"><h2 id="modal-title">{title}</h2><button aria-label="Fechar" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button></div>
        {children}
      </section>
    </div>
  );
}

export function Field({ label, children, className = "" }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

export function EmptyState({ title, note }) {
  return <div className="empty-state"><Icon name="box" size={28} /><strong>{title}</strong><span>{note}</span></div>;
}

export function Reveal({ children, className = "", delay = 0 }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 26 }}
      transition={{ duration: reduceMotion ? 0 : 0.7, delay: reduceMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
      viewport={{ once: true, amount: 0.14, margin: "0px 0px -40px 0px" }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}

export function CountUp({ value, format }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!inView) return undefined;
    const controls = animate(latest.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (current) => {
        latest.current = current;
        setDisplay(current);
      },
    });
    return () => controls.stop();
  }, [inView, value]);

  if (reduceMotion) return <span ref={ref}>{format ? format(value) : value}</span>;
  return <span ref={ref}>{format ? format(display) : Math.round(display)}</span>;
}

/* Boundary por página: um erro num gráfico ou tabela não derruba o app
   inteiro — só a página mostra o aviso, com botão para tentar de novo. */
export class PageErrorBoundary extends Component {
  state = { error: null };

  componentDidCatch(error) {
    void captureAppError(error);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="panel page-panel">
        <div className="panel-heading">
          <div>
            <h2>Esta página encontrou um erro</h2>
            <p>{String(error?.message || error)}</p>
          </div>
        </div>
        <Button onClick={() => this.setState({ error: null })} variant="secondary">Tentar novamente</Button>
      </section>
    );
  }
}
