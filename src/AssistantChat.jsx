import { useEffect, useMemo, useRef, useState } from "react";
import { askWorkspaceAssistant } from "./supabaseApi.js";
import GuestMascot from "./GuestMascot.jsx";
import { Icon } from "./shared.jsx";

const quickQuestions = [
  "Quais são meus chamados em aberto?",
  "Como priorizar os chamados da equipe?",
  "O que posso fazer nesta área do GesTI?",
];

export default function AssistantChat({ companyId, enabled, personName }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const closeTimer = useRef(null);
  const dockRef = useRef(null);
  const messagesEnd = useRef(null);
  const [messages, setMessages] = useState(() => [{ role: "assistant", content: `Olá, ${personName.split(" ")[0]}! Sou o Guest, seu ajudante no GesTI. Posso ajudar com as tarefas e informações da sua empresa que seu perfil permite consultar.` }]);
  const canSend = enabled && draft.trim().length > 0 && !busy;
  const visibleMessages = useMemo(() => messages.slice(-12), [messages]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    document.body.classList.toggle("assistant-mobile-open", open);
    return () => document.body.classList.remove("assistant-mobile-open");
  }, [open]);
  useEffect(() => {
    if (!open || !window.visualViewport) return undefined;
    const viewport = window.visualViewport;
    const syncViewport = () => {
      dockRef.current?.style.setProperty("--assistant-viewport-height", `${viewport.height}px`);
      dockRef.current?.style.setProperty("--assistant-viewport-top", `${viewport.offsetTop}px`);
    };
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
    };
  }, [open]);
  useEffect(() => {
    if (open) messagesEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [open, visibleMessages, busy]);
  const closeGuest = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 720px)").matches) {
      setOpen(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimer.current = null;
    }, 1200);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (event) => { if (event.key === "Escape") closeGuest(); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  const send = async (value = draft) => {
    const content = String(value || "").trim().slice(0, 1500);
    if (!content || busy) return;
    if (!enabled) {
      setMessages((current) => [...current, { role: "user", content }, { role: "assistant", content: "O Guest precisa de uma sessão de empresa conectada ao Supabase. Entre com sua conta corporativa para continuar." }]);
      setDraft("");
      return;
    }
    const next = [...messages, { role: "user", content }].slice(-12);
    setMessages(next);
    setDraft("");
    setBusy(true);
    try {
      const answer = await askWorkspaceAssistant(companyId, next.filter((message) => message.role === "user").map(({ role, content: text }) => ({ role, content: text })));
      setMessages((current) => [...current, { role: "assistant", content: answer }].slice(-12));
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error.message || "Não consegui acessar o Guest. Tente novamente em instantes." }].slice(-12));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`assistant-dock${open && !closing ? " assistant-dock-printing" : closing ? " assistant-dock-closing" : ""}`} ref={dockRef}>
      {open && <section aria-label="Guest, ajuda do GesTI" aria-modal="false" className={`assistant-panel${closing ? " assistant-panel-closing" : ""}`} role="dialog">
        <header className="assistant-header"><span className="assistant-mark"><GuestMascot className="assistant-guest-icon" /></span><div><strong>Guest</strong><small>Ajuda do GesTI · {enabled ? "dados da sua empresa" : "sessão local"}</small></div><button aria-label="Fechar Guest" className="assistant-close" disabled={closing} onClick={closeGuest} type="button"><Icon name="close" size={18} /></button></header>
        <div aria-live="polite" className="assistant-messages">
          {visibleMessages.map((message, index) => <div className={`assistant-message ${message.role === "user" ? "from-user" : "from-assistant"}`} key={`${index}-${message.role}`}><span>{message.content}</span></div>)}
          {busy && <div className="assistant-message from-assistant"><span className="assistant-thinking"><i /> <i /> <i /></span></div>}
          {messages.length === 1 && <div className="assistant-suggestions">{quickQuestions.map((question) => <button key={question} onClick={() => void send(question)} type="button">{question}</button>)}</div>}
          <div ref={messagesEnd} />
        </div>
        <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea aria-label="Mensagem para o Guest" maxLength={1500} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { event.preventDefault(); void send(); } }} placeholder="Pergunte sobre o GesTI..." rows={2} value={draft} /><button aria-label="Enviar mensagem" disabled={!canSend} type="submit"><Icon name={busy ? "spinner" : "arrow"} size={17} /></button></form>
        <p className="assistant-privacy">Usa somente o GesTI e os dados permitidos pelo seu perfil. Perguntas e contexto autorizado são enviados ao Gemini para gerar respostas.</p>
      </section>}
      <button aria-expanded={open} aria-label={open ? "Fechar conversa com Guest" : "Abrir conversa com Guest"} className="assistant-launcher" disabled={closing} onClick={() => { if (open) closeGuest(); else { setClosing(false); setOpen(true); } }} title={open ? "Fechar conversa" : "Conversar com Guest"} type="button">{open && <span aria-hidden="true" className={`assistant-launcher-sheet${closing ? " assistant-launcher-sheet--retract" : ""}`} />}<GuestMascot className="assistant-launcher-guest" /></button>
    </div>
  );
}
