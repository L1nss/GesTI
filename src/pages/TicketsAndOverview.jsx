import { useMemo, useState } from "react";
import { Badge, EmptyState, Icon, PageErrorBoundary, Reveal, CountUp } from "../shared.jsx";
import { useToast } from "../toast.js";
import { downloadCsv, money, SLA_BY_PRIORITY, CRITICAL_PRIORITIES, priorityTone } from "../utils.js";
import { PRIORITY_LEVELS } from "../store.js";

const TICKET_STATUSES = ["Aberto", "Em processamento", "Resolvido"];
const DEFAULT_REPLIES = ["Recebemos sua solicitação e estamos analisando o caso.", "Estamos trabalhando na solução e atualizaremos este chamado em breve.", "A correção foi aplicada. Pode confirmar se o problema foi resolvido?", "Precisamos de mais informações para continuar. Por favor, descreva quando o problema ocorre."];

const formatDueDate = (value) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(Date.parse(value));

/* Central de chamados: fila crítica, filtros, SLA e histórico.
   Prazo exibido a partir do dueAt real; prioridade editável só para TI/Admin. */
export function TicketsPage({ now, tickets, invoices, query, setQuery, canManage, canClaim, canSetCategory, canSetPriority, canManageServices, services, onLinkService, onUnlinkService, onClaim, onDeclineAssignment, onChangeStatus, onChangePriority, onAddComment, detail, setDetail, replyTemplates = [], canManageReplies = false, onSaveReply, onDeleteReply, currentPersonName, role, onSurvey }) {
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [priorityFilter, setPriorityFilter] = useState("Todas as prioridades");
  const [categoryFilter, setCategoryFilter] = useState("Todas as categorias");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const categories = [...new Set(tickets.map((ticket) => ticket.category).filter(Boolean))].sort();
  const rows = tickets.filter((ticket) => (statusFilter === "Todos" || ticket.status === statusFilter)
    && (priorityFilter === "Todas as prioridades" || ticket.priority === priorityFilter)
    && (categoryFilter === "Todas as categorias" || ticket.category === categoryFilter)
    && (!fromDate || String(ticket.createdAt).slice(0, 10) >= fromDate)
    && (!toDate || String(ticket.createdAt).slice(0, 10) <= toDate));
  const critical = rows.filter((ticket) => CRITICAL_PRIORITIES.includes(ticket.priority) && ticket.status !== "Resolvido");
  const normal = rows.filter((ticket) => !CRITICAL_PRIORITIES.includes(ticket.priority) || ticket.status === "Resolvido");
  const renderRow = (ticket) => <tr className={CRITICAL_PRIORITIES.includes(ticket.priority) && ticket.status !== "Resolvido" ? "critical-row" : ""} key={ticket.id}><td><span className="cell-title">{ticket.title}</span><span className="cell-subtitle">{ticket.id}{ticket.category ? ` · ${ticket.category}` : ""}{ticket.prioritySource === "manual" ? " · prioridade ajustada" : " · prioridade automática"}</span></td><td>{ticket.requester}</td><td><span className="assignee-cell"><span className={`assignee-dot ${ticket.assignee && ticket.assignee !== "—" ? "dot-on" : ""}`} />{ticket.assignee || "—"}</span></td><td>{canSetPriority
    ? <select aria-label={`Prioridade do chamado ${ticket.id}`} className={`inline-priority priority-${ticket.priority.toLowerCase()}`} onChange={(event) => onChangePriority(ticket, event.target.value)} value={ticket.priority}>{PRIORITY_LEVELS.map((level) => <option key={level}>{level}</option>)}</select>
    : <Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge>}</td><td><Badge tone={ticket.status === "Resolvido" ? "green" : ticket.status === "Em processamento" ? "blue" : "neutral"}>{ticket.status}</Badge></td><td><span className={ticket.status !== "Resolvido" && ticket.dueAt && Date.parse(ticket.dueAt) < now.getTime() ? "text-warning" : ""}>{ticket.status === "Resolvido" ? (ticket.resolvedAt ? formatDueDate(ticket.resolvedAt) : "—") : ticket.dueAt ? formatDueDate(ticket.dueAt) : "Sem prazo"}</span><small className="cell-subtitle">{ticket.status === "Resolvido" ? "concluído" : ticket.dueAt && Date.parse(ticket.dueAt) < now.getTime() ? "prazo excedido" : `prazo alvo · ${ticket.slaHours || SLA_BY_PRIORITY[ticket.priority] || 40} h`}</small></td><td><div className="row-actions">{canClaim && (!ticket.assignee || ticket.assignee === "—") && ticket.status !== "Resolvido" && <button className="text-link" onClick={() => onClaim(ticket)} type="button"><Icon name="user" size={14} /> Assumir</button>}<button className="text-link" onClick={() => setDetail(ticket.id)} type="button"><Icon name="eye" size={14} /> Detalhes</button></div></td></tr>;

  return (
    <PageErrorBoundary>
      {critical.length > 0 && <section className="critical-queue">
        <div className="critical-head"><span className="critical-pulse" /><div><strong>Fila crítica — ação imediata</strong><small>{critical.length} chamado(s) de prioridade Alta ou Urgente aguardando conclusão. Atendimento prioritário.</small></div></div>
        <div className="table-scroll"><table><thead><tr><th>Chamado</th><th>Solicitante</th><th>Atendido por</th><th>Prioridade</th><th>Situação</th><th>Abertura</th><th>Ações</th></tr></thead><tbody>{critical.map(renderRow)}</tbody></table></div>
      </section>}
      <section className="panel page-panel"><div className="toolbar"><label className="search-box"><Icon name="search" size={18} /><input aria-label="Buscar chamado" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por assunto, solicitante, status ou responsável" value={query} /></label><select aria-label="Filtrar chamados por status" className="filter-select" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option>Todos</option>{TICKET_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Filtrar chamados por prioridade" className="filter-select" onChange={(event) => setPriorityFilter(event.target.value)} value={priorityFilter}><option>Todas as prioridades</option>{PRIORITY_LEVELS.map((priority) => <option key={priority}>{priority}</option>)}</select>{categories.length > 0 && <select aria-label="Filtrar chamados por categoria" className="filter-select" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}><option>Todas as categorias</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>}<label className="date-filter">De <input aria-label="Chamados a partir desta data" max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} /></label><label className="date-filter">Até <input aria-label="Chamados até esta data" min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} /></label><button className="button button-secondary" onClick={() => downloadCsv(rows, "gesti-chamados", ["Código", "Assunto", "Solicitante", "Categoria", "Prioridade", "Status", "Responsável", "Abertura", "Prazo", "Conclusão"], (ticket) => [ticket.id, ticket.title, ticket.requester, ticket.category || "", ticket.priority, ticket.status, ticket.assignee || "", ticket.createdAt, ticket.dueAt || "", ticket.resolvedAt || ""])} type="button"><Icon name="download" size={15} /> CSV</button></div>
        {rows.length ? <div className="table-scroll"><table><thead><tr><th>Chamado</th><th>Solicitante</th><th>Atendido por</th><th>Prioridade</th><th>Situação</th><th>Prazo / conclusão</th><th>Ações</th></tr></thead><tbody>{[...critical, ...normal].map(renderRow)}</tbody></table></div> : <EmptyState note="Tente outro termo ou altere os filtros." title="Nenhum chamado encontrado" />}</section>
      {detail && <TicketDetailModal canClaim={canClaim} canManage={canManage} canManageServices={canManageServices} canSetCategory={canSetCategory} canSetPriority={canSetPriority} currentPersonName={currentPersonName} invoices={invoices} now={now} onChangePriority={onChangePriority} onChangeStatus={onChangeStatus} onAddComment={onAddComment} onClaim={onClaim} onDeclineAssignment={onDeclineAssignment} onLinkService={onLinkService} onUnlinkService={onUnlinkService} onSurvey={onSurvey} replyTemplates={replyTemplates} role={role} services={services} setOpenDetail={setDetail} ticket={tickets.find((item) => item.id === detail)} />}
      <ReplyTemplatesPanel canManage={canManageReplies} onDelete={onDeleteReply} onSave={onSaveReply} templates={replyTemplates} />
    </PageErrorBoundary>
  );
}

/* Detalhe do chamado: timeline, comentários, anexos e ações. */
export function TicketDetailModal({ now, ticket, canManage, canClaim, canSetCategory, canManageServices, canSetPriority, services, invoices, replyTemplates = [], currentPersonName, role, onSurvey, onLinkService, onUnlinkService, onClaim, onDeclineAssignment, onChangeStatus, onChangePriority, onAddComment, setOpenDetail }) {
  const notify = useToast();
  const [note, setNote] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [comment, setComment] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [surveyScore, setSurveyScore] = useState("");
  const [surveyComment, setSurveyComment] = useState("");
  const cannedReplies = [...DEFAULT_REPLIES.map((body) => ({ id: body, title: body.slice(0, 54), body })), ...replyTemplates.filter((item) => item.active !== false)];
  if (!ticket) return null;
  const history = ticket.history || [{ status: ticket.status, person: ticket.assignee || ticket.requester, date: ticket.createdAt, note: "" }];
  const linkedServices = (ticket.serviceIds || []).map((id) => services.find((service) => service.id === id)).filter(Boolean);
  const linkedInvoices = invoices.filter((invoice) => invoice.ticketId === ticket.id || (ticket.invoiceIds || []).includes(invoice.id));
  const servicesTotal = linkedServices.reduce((sum, service) => sum + Number(ticket.servicePrices?.[service.id] ?? service.price ?? 0), 0);
  const closed = ticket.status === "Resolvido";
  const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
  const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];
  const readAttachment = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setAttachmentError("");
    if (!file) return;
    if (attachments.length >= 3) { setAttachmentError("Cada chamado aceita até 3 anexos."); return; }
    if (file.size > 512 * 1024) { setAttachmentError("O arquivo pode ter no máximo 512 KB para caber no armazenamento local."); return; }
    if (!/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(file.type)) { setAttachmentError("Use imagem, PDF ou arquivo de texto."); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachment({ name: file.name, type: file.type, size: file.size, data: reader.result });
    reader.onerror = () => setAttachmentError("Não foi possível ler este arquivo.");
    reader.readAsDataURL(file);
  };
  const saveUpdate = () => {
    onAddComment(ticket.id, comment, attachment);
    notify({ tone: "success", message: "Atualização publicada no histórico do chamado.", title: ticket.id });
    setComment(""); setAttachment(null); setAttachmentError("");
  };
  return (
    <ModalWrapper onClose={() => setOpenDetail("")} title={`Chamado ${ticket.id} · ${ticket.title}`}>
      <div className="ticket-detail">
        <div className="detail-grid">
          <div className="detail-block"><span>SOLICITANTE</span><strong>{ticket.requester}</strong><small>{canSetCategory && ticket.category ? `${ticket.category} · ` : ""}{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(Date.parse(ticket.createdAt))}</small></div>
          <div className="detail-block"><span>ATENDIMENTO</span><strong>{ticket.assignee && ticket.assignee !== "—" ? ticket.assignee : "Aguardando responsável"}</strong><small>{closed ? "Serviço concluído" : ticket.status === "Em processamento" ? "Em andamento" : "Aguardando início"}</small></div>
          <div className="detail-block"><span>PRIORIDADE</span>
            {canSetPriority
              ? <select aria-label="Prioridade do chamado" className={`inline-priority priority-${ticket.priority.toLowerCase()}`} onChange={(event) => onChangePriority(ticket, event.target.value)} value={ticket.priority}>{PRIORITY_LEVELS.map((level) => <option key={level}>{level}</option>)}</select>
              : <Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge>}
            <small>{ticket.prioritySource === "manual" ? `Ajustada por ${ticket.priorityBy}` : "Definida automaticamente pelo sistema"}</small>
          </div>
          <div className="detail-block"><span>SITUAÇÃO</span><Badge tone={closed ? "green" : ticket.status === "Em processamento" ? "blue" : "neutral"}>{closed ? "Concluído" : ticket.status}</Badge></div>
        </div>
        <p className="detail-desc">{ticket.description}</p>
        {ticket.dueAt && <div className={`ticket-sla-note ${!closed && Date.parse(ticket.dueAt) < now.getTime() ? "overdue" : ""}`}><Icon name="clock" size={14} /> Prazo alvo: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(ticket.dueAt))} · {ticket.slaHours || SLA_BY_PRIORITY[ticket.priority] || 40} h{!closed && Date.parse(ticket.dueAt) < now.getTime() ? " · PRAZO EXCEDIDO" : ""}</div>}
        {linkedServices.length > 0 && (
          <div className="detail-services"><span>SERVIÇOS VINCULADOS</span><ul>{linkedServices.map((service) => <li key={service.id}><Icon name="wrench" size={13} /> {service.name}<b>{money(ticket.servicePrices?.[service.id] ?? service.price)}</b>{canManageServices && !closed && <button className="text-link" onClick={() => onUnlinkService(ticket, service.id)} type="button">Remover</button>}</li>)}</ul><div className="detail-total"><span>Total de serviços</span><b>{money(servicesTotal)}</b></div></div>
        )}
        {canManageServices && !closed && <div className="detail-service-add"><label htmlFor="ticket-service">Adicionar serviço</label><select id="ticket-service" onChange={(event) => setServiceId(event.target.value)} value={serviceId}><option value="">Selecione um serviço ativo</option>{services.filter((service) => service.active !== false && !(ticket.serviceIds || []).includes(service.id)).map((service) => <option key={service.id} value={service.id}>{service.name} · {money(service.price)}</option>)}</select><button className="button button-secondary" disabled={!serviceId} onClick={() => { onLinkService(ticket.id, serviceId); setServiceId(""); }} type="button"><Icon name="plus" size={14} /> Vincular</button></div>}
        {linkedInvoices.length > 0 && <div className="detail-services"><span>NOTAS FISCAIS VINCULADAS</span><ul>{linkedInvoices.map((invoice) => <li key={invoice.id}><Icon name="file" size={13} /> Nota {invoice.number}/{invoice.series} · {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(Date.parse(invoice.createdAt))}<b>{money(invoice.total)}</b></li>)}</ul></div>}
        <div className="timeline"><span className="timeline-title">HISTÓRICO DE ATENDIMENTO — quem fez, o que foi feito e quando</span>
          {history.map((entry, index) => (
            <div className="timeline-row" key={`${entry.date}-${index}`}>
              <span className={`timeline-dot dot-${String(entry.status).toLowerCase().replaceAll(" ", "-")}`} />
              <div className="timeline-copy"><strong>{entry.status}{index === history.length - 1 && !closed ? " (em andamento)" : ""}</strong><small>{entry.person} · {formatDateSafe(entry.date)}{entry.note ? ` · ${entry.note}` : ""}</small></div>
            </div>
          ))}
        </div>
        <section className="ticket-conversation"><div className="timeline-title">COMENTÁRIOS E ANEXOS</div>
          {[...comments.map((item) => ({ ...item, kind: "comment" })), ...attachments.map((item) => ({ ...item, kind: "attachment" }))].sort((a, b) => new Date(a.date) - new Date(b.date)).map((item) => <article className="ticket-message" key={item.id}>{item.kind === "comment" ? <><strong>{item.person}</strong><p>{item.text}</p></> : <><strong>{item.person} anexou</strong><p><a href={item.data} download={item.name}>{item.name}</a> · {((item.size || 0) / 1024).toFixed(0)} KB</p></>}<small>{formatDateSafe(item.date)}</small></article>)}
          <label className="field-label" htmlFor="ticket-comment">Adicionar comentário</label><select aria-label="Modelo de resposta" onChange={(event) => event.target.value && setComment(event.target.value)} value=""><option value="">Inserir modelo de resposta…</option>{cannedReplies.map((reply) => <option key={reply.id} value={reply.body}>{reply.title}</option>)}</select><textarea id="ticket-comment" maxLength="1000" onChange={(event) => setComment(event.target.value)} placeholder="Escreva uma atualização clara para quem abriu o chamado…" rows="3" value={comment} />
          <div className="ticket-update-actions"><label className="button button-secondary"><Icon name="file" size={14} />{attachment ? attachment.name : "Anexar arquivo"}<input accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain" hidden onChange={readAttachment} type="file" /></label><button className="button button-secondary" disabled={!comment.trim() && !attachment} onClick={saveUpdate} type="button">Publicar atualização</button></div>{attachmentError && <small className="text-warning">{attachmentError}</small>}
        </section>
        {closed && role !== "TI" && ticket.requester === currentPersonName && <section className="ticket-survey"><strong>Como foi o atendimento?</strong>{ticket.satisfaction ? <p>Avaliação registrada: {"★".repeat(ticket.satisfaction.score)}{"☆".repeat(5 - ticket.satisfaction.score)}{ticket.satisfaction.comment ? ` · ${ticket.satisfaction.comment}` : ""}</p> : <form onSubmit={(event) => { event.preventDefault(); if (surveyScore) onSurvey(ticket.id, Number(surveyScore), surveyComment); }}><label className="field-label" htmlFor="satisfaction-score">Nota de 1 a 5</label><select id="satisfaction-score" onChange={(event) => setSurveyScore(event.target.value)} required value={surveyScore}><option value="">Escolha uma nota</option>{[5,4,3,2,1].map((value) => <option key={value} value={value}>{value} · {value === 5 ? "Excelente" : value === 4 ? "Bom" : value === 3 ? "Regular" : value === 2 ? "Ruim" : "Muito ruim"}</option>)}</select><textarea maxLength="1000" onChange={(event) => setSurveyComment(event.target.value)} placeholder="Comentário (opcional)" rows="2" value={surveyComment} /><button className="button button-primary" type="submit">Enviar avaliação</button></form>}</section>}
        {canManage && !closed && (
          <div className="detail-actions">
            {ticket.assignmentStatus === "Pendente de aceite" && ticket.assignee === currentPersonName && <><button className="button button-primary" onClick={() => onClaim(ticket)} type="button"><Icon name="check" size={15} /> Aceitar atendimento</button><button className="button button-secondary" onClick={() => onDeclineAssignment(ticket)} type="button">Recusar</button></>}
            {canClaim && (!ticket.assignee || ticket.assignee === "—") && <button className="button button-primary" onClick={() => onClaim(ticket)} type="button"><Icon name="user" size={15} /> Assumir chamado</button>}
            {canClaim && ticket.status === "Aberto" && ticket.assignee && ticket.assignee !== "—" && <button className="button button-secondary" onClick={() => onChangeStatus(ticket, "Em processamento", "Atendimento iniciado.")} type="button"><Icon name="clock" size={15} /> Iniciar atendimento</button>}
            {canClaim && ticket.status === "Em processamento" && <><input className="detail-note" onChange={(event) => setNote(event.target.value)} placeholder="Descreva a solução para concluir (obrigatório)" value={note} /><button className="button button-primary" disabled={!note.trim()} onClick={() => onChangeStatus(ticket, "Resolvido", note)} type="button"><Icon name="check" size={15} /> Concluir chamado</button></>}
          </div>
        )}
        {canManage && closed && <button className="button button-secondary" onClick={() => onChangeStatus(ticket, "Aberto", "Chamado reaberto")} type="button"><Icon name="clock" size={15} /> Reabrir chamado</button>}
      </div>
    </ModalWrapper>
  );
}

/* Wrapper simples para evitar import circular com shared.jsx. */
function ModalWrapper({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className="modal modal-wide" role="dialog">
        <div className="modal-heading"><h2>{title}</h2><button aria-label="Fechar" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button></div>
        {children}
      </section>
    </div>
  );
}

function ReplyTemplatesPanel({ templates, canManage, onSave, onDelete }) {
  return (
    <section className="panel page-panel"><div className="panel-heading"><div><h2>Modelos de resposta</h2><p>Respostas reutilizáveis disponíveis nos comentários dos chamados.</p></div></div>
      {canManage && <form className="form-grid" onSubmit={onSave}><label className="field"><span>Título do modelo</span><input maxLength="80" name="title" placeholder="Ex.: Solicitar mais informações" required /></label><label className="field"><span>Texto da resposta</span><textarea maxLength="1000" name="body" placeholder="Mensagem para reutilizar no atendimento" required rows="2" /></label><button className="button button-primary" type="submit"><Icon name="plus" size={14} /> Salvar modelo</button></form>}
      {templates.length ? <div className="service-grid">{templates.map((template) => <article className="service-card" key={template.id}><div className="service-copy"><strong>{template.title}</strong><small>{template.body}</small></div>{canManage && <button aria-label={`Remover modelo ${template.title}`} className="reject-button" onClick={() => onDelete(template)} type="button"><Icon name="close" size={14} /></button>}</article>)}</div> : <p className="quiet-note">Nenhum modelo personalizado. Os modelos básicos continuam disponíveis no chamado.</p>}
    </section>
  );
}

/* Métricas de atendimento: carga por atendente e tempos médios (SLA). */
export function TeamMetrics({ tickets }) {
  const resolved = tickets.filter((ticket) => ticket.status === "Resolvido" && ticket.dueAt && ticket.resolvedAt);
  const withinSla = resolved.filter((ticket) => Date.parse(ticket.resolvedAt) <= Date.parse(ticket.dueAt));
  const compliance = resolved.length ? Math.round(withinSla.length / resolved.length * 100) : 0;
  const rows = useMemo(() => {
    const byAssignee = new Map();
    for (const ticket of tickets) {
      const name = ticket.assignee && ticket.assignee !== "—" ? ticket.assignee : null;
      if (!name) continue;
      const entry = byAssignee.get(name) || { name, open: 0, resolved: 0, totalHours: 0 };
      if (ticket.status === "Resolvido") {
        entry.resolved += 1;
        if (ticket.createdAt && ticket.resolvedAt) {
          entry.totalHours += Math.max(0, (Date.parse(ticket.resolvedAt) - Date.parse(ticket.createdAt)) / 3600000);
        }
      } else {
        entry.open += 1;
      }
      byAssignee.set(name, entry);
    }
    return [...byAssignee.values()].map((entry) => ({
      ...entry,
      avgHours: entry.resolved ? Math.round((entry.totalHours / entry.resolved) * 10) / 10 : null,
    })).sort((a, b) => b.open - a.open);
  }, [tickets]);
  return (
    <section className="panel team-metrics-panel">
      <div className="panel-heading"><div><h2>Carga e desempenho da equipe</h2><p>Taxa de SLA em chamados resolvidos com prazo registrado</p></div></div>
      <div className="mini-metrics"><div><span>Resolvidos dentro do SLA</span><strong>{compliance}%</strong></div><div><span>Dentro do prazo</span><strong>{withinSla.length} de {resolved.length}</strong></div></div>
      <div className="table-scroll"><table><thead><tr><th>Atendente</th><th>Em aberto</th><th>Concluídos</th><th>Dentro do SLA</th><th>Tempo médio de resolução</th></tr></thead><tbody>{rows.map((row) => { const closed = tickets.filter((ticket) => ticket.assignee === row.name && ticket.status === "Resolvido" && ticket.dueAt && ticket.resolvedAt); const onTime = closed.filter((ticket) => Date.parse(ticket.resolvedAt) <= Date.parse(ticket.dueAt)); return <tr key={row.name}><td><span className="cell-title">{row.name}</span></td><td>{row.open}</td><td>{row.resolved}</td><td>{closed.length ? `${Math.round(onTime.length / closed.length * 100)}%` : "—"}</td><td>{row.avgHours ? `${row.avgHours} h` : "—"}</td></tr>; })}</tbody></table></div>
    </section>
  );
}

/* Visão geral: herói, indicadores e painéis resumo. */
export function Overview({ tickets, overdueTickets, lowStock = [], pendingExpenses = [], onNavigate, company, personName, role, canSeeFinances, canBackup, onBackupExport, onBackupImport, backupBusy, remoteAuth = false }) {
  const openTickets = tickets.filter((ticket) => ticket.status === "Aberto").length;
  const processingTickets = tickets.filter((ticket) => ticket.status === "Em processamento").length;
  const recentTickets = [...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4);

  return (
    <>
      <Reveal><section aria-label="Boas-vindas" className="hero">
        <div aria-hidden="true" className="hero-aurora"><span className="aurora-orb orb-1" /><span className="aurora-orb orb-2" /><span className="aurora-orb orb-3" /></div>
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="hero-chip"><span className="live-dot" /> {company.name.toUpperCase()} · SISTEMA OPERACIONAL</span>
            <h2>Olá, {personName.split(" ")[0]}.</h2>
            <p>{role === "Funcionário" ? "Acompanhe seus chamados ou abra uma nova solicitação." : "Acompanhe os chamados recentes e acesse as áreas principais."}</p>
            <div className="hero-actions">
              <button className="hero-cta" onClick={() => onNavigate("Chamados")} type="button"><span aria-hidden="true" className="cta-ripples"><span /><span /><span /></span>Abrir central de chamados <Icon name="arrow" size={17} /></button>
            </div>
          </div>
        </div>
      </section></Reveal>
      <section aria-label="Indicadores principais" className="metric-grid">
        <button className="metric-card" onClick={() => onNavigate("Chamados")} type="button"><span className="metric-icon metric-violet"><Icon name="ticket" size={19} /></span><span className="metric-label">Aguardando atendimento</span><strong className="metric-value"><CountUp value={openTickets} /></strong><span className="metric-note">Chamados em aberto</span><span className="metric-arrow"><Icon name="arrow" size={15} /></span></button>
        <button className="metric-card" onClick={() => onNavigate("Chamados")} type="button"><span className="metric-icon metric-amber"><Icon name="clock" size={19} /></span><span className="metric-label">Chamados fora do prazo</span><strong className="metric-value"><CountUp value={overdueTickets.length} /></strong><span className="metric-note">Além do prazo definido pela prioridade</span><span className="metric-arrow"><Icon name="arrow" size={15} /></span></button>
        <button className="metric-card" onClick={() => onNavigate("Chamados")} type="button"><span className="metric-icon metric-green"><Icon name="check" size={19} /></span><span className="metric-label">Em atendimento</span><strong className="metric-value"><CountUp value={processingTickets} /></strong><span className="metric-note">Chamados em andamento</span><span className="metric-arrow"><Icon name="arrow" size={15} /></span></button>
      </section>
      <Reveal delay={0.11}><div className="dashboard-grid">
        <section className="panel"><div className="panel-heading"><div><h2>Chamados recentes</h2><p>Solicitações que passaram pela equipe</p></div><button className="subtle-link" onClick={() => onNavigate("Chamados")} type="button">Ver todos <Icon name="chevron" size={15} /></button></div>
          {recentTickets.length ? <div className="table-scroll"><table><thead><tr><th>Solicitação</th><th>Solicitante</th><th>Prioridade</th><th>Status</th></tr></thead><tbody>{recentTickets.map((ticket) => <tr key={ticket.id}><td><span className="cell-title">{ticket.title}</span><span className="cell-subtitle">{ticket.id}</span></td><td>{ticket.requester}</td><td><Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge></td><td><Badge tone={ticket.status === "Resolvido" ? "green" : ticket.status === "Em processamento" ? "blue" : "neutral"}>{ticket.status}</Badge></td></tr>)}</tbody></table></div> : <EmptyState note="Os novos chamados aparecerão aqui." title="Sem chamados" />}
        </section>
        {(role !== "Funcionário" || canSeeFinances) && <div className="side-stack">
          {role !== "Funcionário" && <section className="panel stock-panel"><div className="panel-heading"><div><h2>Estoque</h2><p>{lowStock.length ? `${lowStock.length} ${lowStock.length === 1 ? "item precisa" : "itens precisam"} de reposição` : "Nenhum item abaixo do mínimo"}</p></div><span className="panel-icon amber-icon"><Icon name="box" /></span></div>{lowStock.length > 0 && <ul className="stock-list">{lowStock.slice(0, 3).map((item) => <li key={item.id}><span className="stock-bullet" /><span className="stock-info"><strong>{item.name}</strong><small>{item.category} · mínimo {item.minimum} un.</small></span><Badge tone="amber">{item.quantity} un.</Badge></li>)}</ul>}<button className="subtle-link stock-action" onClick={() => onNavigate("Estoque")} type="button">Ver estoque <Icon name="arrow" size={15} /></button></section>}
          {canSeeFinances && <button className="panel overview-finance" onClick={() => onNavigate("Custos")} type="button"><span className="metric-icon metric-green"><Icon name="receipt" size={19} /></span><span><strong>{pendingExpenses.length}</strong><small>despesas aguardando análise</small></span><Icon name="arrow" size={16} /></button>}
        </div>}
      </div></Reveal>
      {canBackup && <details className="overview-backup"><summary>{remoteAuth ? "Exportar dados" : "Backup e restauração"}</summary><section className="panel backup-panel"><div><strong>Proteção dos dados</strong><p>{remoteAuth ? "Baixe uma cópia dos dados acessíveis nesta empresa. A restauração do Supabase deve ser feita pela administração do banco." : "Baixe uma cópia desta empresa ou restaure um backup feito no GesTI."}</p></div><div className="backup-actions"><button className="button button-secondary" onClick={onBackupExport} type="button"><Icon name="download" size={15} /> {remoteAuth ? "Baixar cópia" : "Baixar backup"}</button>{!remoteAuth && <label className="button button-secondary">{backupBusy ? "Restaurando…" : "Restaurar backup"}<input accept="application/json,.json" disabled={backupBusy} hidden onChange={onBackupImport} type="file" /></label>}</div></section></details>}
    </>
  );
}
