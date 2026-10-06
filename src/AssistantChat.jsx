import { useMemo, useState } from "react";
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
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState(() => [{ role: "assistant", content: `Olá, ${personName.split(" ")[0]}! Sou o Guest, seu ajudante no GesTI. Posso ajudar com as tarefas e informações da sua empresa que seu perfil permite consultar.` }]);
  const canSend = enabled && draft.trim().length > 0 && !busy;
  const visibleMessages = useMemo(() => messages.slice(-12), [messages]);

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
    <div className="assistant-dock">
      {open && <section aria-label="Guest, ajuda do GesTI" aria-modal="false" className="assistant-panel" role="dialog">
        <header className="assistant-header"><span className="assistant-mark"><GuestMascot className="assistant-guest-icon" /></span><div><strong>Guest</strong><small>Ajuda do GesTI · {enabled ? "dados da sua empresa" : "sessão local"}</small></div><button aria-label="Fechar Guest" className="assistant-close" onClick={() => setOpen(false)} type="button"><Icon name="close" size={18} /></button></header>
        <div aria-live="polite" className="assistant-messages">
          {visibleMessages.map((message, index) => <div className={`assistant-message ${message.role === "user" ? "from-user" : "from-assistant"}`} key={`${index}-${message.role}`}><span>{message.content}</span></div>)}
          {busy && <div className="assistant-message from-assistant"><span className="assistant-thinking"><i /> <i /> <i /></span></div>}
          {messages.length === 1 && <div className="assistant-suggestions">{quickQuestions.map((question) => <button key={question} onClick={() => void send(question)} type="button">{question}</button>)}</div>}
        </div>
        <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea aria-label="Mensagem para o Guest" maxLength={1500} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Pergunte sobre o GesTI..." rows={2} value={draft} /><button aria-label="Enviar mensagem" disabled={!canSend} type="submit"><Icon name={busy ? "spinner" : "arrow"} size={17} /></button></form>
        <p className="assistant-privacy">Usa somente o GesTI e os dados permitidos pelo seu perfil. Perguntas e contexto autorizado são enviados ao Gemini para gerar respostas.</p>
      </section>}
      <button aria-expanded={open} aria-label={open ? "Fechar conversa com Guest" : "Abrir conversa com Guest"} className="assistant-launcher" onClick={() => setOpen((current) => !current)} title={open ? "Fechar conversa" : "Conversar com Guest"} type="button"><GuestMascot className="assistant-launcher-guest" mode={open ? "eject" : "idle"} /></button>
    </div>
  );
}
