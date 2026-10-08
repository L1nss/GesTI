import { useEffect, useState } from "react";
import { Button, EmptyState, Icon, PageErrorBoundary, Reveal } from "../shared.jsx";
import { useToast } from "../toast.js";
import { readLogs } from "../store.js";
import { downloadCsv, formatDateTime } from "../utils.js";
import { hasSupabaseSession, restSelect } from "../supabaseApi.js";

/* Logs do sistema: auditoria com filtros, busca e exportação CSV.
   (A exportação dos logs era uma funcionalidade ausente.) */
export function LogsPage({ canLog, orgId, onClear, remoteAuth = false }) {
  const notify = useToast();
  const [allLogs, setLogs] = useState(readLogs);
  const [remoteLogs, setRemoteLogs] = useState([]);
  const logs = [...allLogs.filter((entry) => entry.orgId === orgId), ...remoteLogs];
  const [levelFilter, setLevelFilter] = useState("Todos");
  const [query, setQuery] = useState("");

  const refresh = () => setLogs(readLogs());
  useEffect(() => {
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!canLog || !hasSupabaseSession() || !/^[0-9a-f-]{36}$/i.test(orgId)) return undefined;
    let active = true;
    Promise.all([
      restSelect("audit_events", `company_id=eq.${orgId}&order=created_at.desc&limit=200`),
      restSelect("app_errors", `company_id=eq.${orgId}&order=created_at.desc&limit=100`),
    ]).then(([events, errors]) => {
      if (!active) return;
      setRemoteLogs([
        ...events.map((row) => ({ id: `audit-${row.id}`, orgId, actor: row.actor_user_id || "Usuário", action: row.action, details: `${row.entity_type}${row.entity_id ? ` · ${row.entity_id}` : ""}`, level: row.details?.level || "info", date: row.created_at })),
        ...errors.map((row) => ({ id: `error-${row.id}`, orgId, actor: "Sistema", action: `Erro: ${row.error_name}`, details: row.message, level: "warning", date: row.created_at })),
      ]);
    }).catch(() => { if (active) setRemoteLogs([]); });
    return () => { active = false; };
  }, [canLog, orgId]);

  const rows = logs
    .filter((entry) => levelFilter === "Todos" || entry.level === levelFilter)
    .filter((entry) => `${entry.actor} ${entry.action} ${entry.details}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <PageErrorBoundary>
      <Reveal><section className="mini-metrics">
        <div><span>Eventos registrados</span><strong>{logs.length}</strong></div>
        <div><span>Informações</span><strong className="logs-count-info">{logs.filter((entry) => entry.level === "info").length}</strong></div>
        <div><span>Avisos</span><strong className="logs-count-warning">{logs.filter((entry) => entry.level === "warning").length}</strong></div>
        <div><span>Conclusões</span><strong className="logs-count-success">{logs.filter((entry) => entry.level === "success").length}</strong></div>
      </section></Reveal>
      <Reveal delay={0.08}><section className="panel page-panel">
        <div className="toolbar">
          <label className="search-box"><Icon name="search" size={18} /><input aria-label="Buscar log" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por pessoa, ação ou detalhe" value={query} /></label>
          <select aria-label="Filtrar logs por nível" className="filter-select" onChange={(event) => setLevelFilter(event.target.value)} value={levelFilter}><option>Todos</option><option value="info">Info</option><option value="warning">Avisos</option><option value="success">Conclusões</option></select>
          <Button variant="secondary" onClick={() => { downloadCsv(rows, "gesti-logs", ["Data", "Pessoa", "Ação", "Detalhes", "Nível"], (entry) => [formatDateTime(entry.date), entry.actor, entry.action, entry.details, entry.level]); notify({ message: "Logs exportados em CSV." }); }}><Icon name="download" size={15} /> CSV</Button>
          {canLog && <Button variant="secondary" onClick={onClear}><Icon name="close" size={15} />{remoteAuth ? "Limpar logs locais" : "Limpar logs"}</Button>}
        </div>
        {rows.length ? <div className="log-list">{rows.map((entry) => (
          <div className="log-row" key={entry.id}>
            <span className={`log-dot log-${entry.level}`} />
            <div className="log-copy"><strong>{entry.action}</strong><small>{entry.details}</small></div>
            <div className="log-meta"><strong>{entry.actor}</strong><small>{formatDateTime(entry.date)}</small></div>
          </div>
        ))}</div> : <EmptyState note="As ações do sistema aparecerão aqui automaticamente." title="Nenhum log registrado" />}
      </section></Reveal>
    </PageErrorBoundary>
  );
}
