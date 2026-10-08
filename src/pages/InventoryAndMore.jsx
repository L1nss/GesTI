import { useEffect, useMemo, useState } from "react";
import { Button, CountUp, EmptyState, Icon, PageErrorBoundary, Reveal } from "../shared.jsx";
import { downloadCsv, money, shortDate } from "../utils.js";
import { ABCInventoryChart } from "../ABCInventoryChart.jsx";

/* Estoque: componentes, níveis mínimos, movimentações e exportação.
   Movimentações agora exibem a quantidade real (antes mostrava ±1 fixo). */
export function InventoryPage({ inventory, allInventory = inventory, query, setQuery, canManage, onAdjust, movements, onDownload, suppliers = [], onAddSupplier, onRemoveSupplier }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const stockValue = allInventory.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
  const lowStockCount = allInventory.filter((item) => item.quantity <= item.minimum).length;
  const [movementFilter, setMovementFilter] = useState(5);
  const [movementQuery, setMovementQuery] = useState("");
  const [movementPage, setMovementPage] = useState(0);
  const filteredMovements = useMemo(() => movements.filter((move) => `${move.item} ${move.person} ${move.date}`.toLowerCase().includes(movementQuery.toLowerCase())), [movements, movementQuery]);
  const movementPages = Math.max(1, Math.ceil(filteredMovements.length / movementFilter));
  const visibleMovements = useMemo(() => filteredMovements.slice(movementPage * movementFilter, (movementPage + 1) * movementFilter), [filteredMovements, movementFilter, movementPage]);
  const abc = useMemo(() => {
    const ranked = [...allInventory].map((item) => ({ ...item, stockValue: Number(item.quantity || 0) * Number(item.unitCost || 0) })).sort((a, b) => b.stockValue - a.stockValue);
    const total = ranked.reduce((sum, item) => sum + item.stockValue, 0);
    return ranked.map((item, index) => { const previousValue = ranked.slice(0, index).reduce((sum, entry) => sum + entry.stockValue, 0); const previousShare = total ? previousValue / total : 0; return { ...item, classification: previousShare < 0.8 ? "A" : previousShare < 0.95 ? "B" : "C" }; });
  }, [allInventory]);
  return (
    <PageErrorBoundary>
      <Reveal><section className="mini-metrics"><div><span>Componentes cadastrados</span><strong><CountUp value={allInventory.length} /></strong></div><div><span>Valor estimado</span><strong><CountUp format={money} value={stockValue} /></strong></div><div><span>Itens para repor</span><strong className={lowStockCount ? "text-warning" : ""}><CountUp value={lowStockCount} /></strong></div><div><span>Acima do estoque mínimo</span><strong className="text-positive"><CountUp value={allInventory.filter((item) => item.quantity > item.minimum).length} /></strong></div></section></Reveal>
      <Reveal delay={0.08}><section className="panel page-panel"><div className="toolbar"><label className="search-box"><Icon name="search" size={18} /><input aria-label="Buscar componente" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, categoria ou SKU" value={query} /></label><button className="button button-secondary" onClick={onDownload} type="button"><Icon name="download" size={16} /> Exportar CSV</button></div>
        {inventory.length ? <div className="table-scroll"><table><thead><tr><th>Componente</th><th>Categoria / SKU</th><th>Quantidade</th><th>Custo unitário</th><th>Valor em estoque</th><th>ABC</th><th>Garantia</th>{canManage && <th>Movimentar</th>}</tr></thead><tbody>{inventory.map((item) => { const rank = abc.find((entry) => entry.id === item.id); const warrantyDays = item.warrantyUntil ? Math.ceil((Date.parse(`${item.warrantyUntil}T23:59:59`) - now) / 86400000) : null; return <tr key={item.id}><td><span className="component-name"><span className="component-icon"><Icon name="cpu" size={17} /></span>{item.name}</span><span className="cell-subtitle">{item.id}</span></td><td>{item.category}<span className="cell-subtitle">{item.sku}</span></td><td><div className="quantity-cell"><strong>{item.quantity}</strong><span className={`badge badge-${item.quantity <= item.minimum ? "amber" : "green"}`}>{item.quantity <= item.minimum ? "Estoque baixo" : "Disponível"}</span></div><span className="cell-subtitle">Mínimo: {item.minimum}</span></td><td>{money(item.unitCost)}</td><td>{money(item.unitCost * item.quantity)}</td><td><span className={`badge badge-${rank?.classification === "A" ? "blue" : rank?.classification === "B" ? "amber" : "neutral"}`}>{rank?.classification || "—"}</span></td><td>{item.warrantyUntil ? <span className={warrantyDays !== null && warrantyDays <= 30 ? "text-warning" : ""}>{shortDate(item.warrantyUntil)}{warrantyDays >= 0 && warrantyDays <= 30 ? <small className="cell-subtitle">Garantia vence em {warrantyDays} dia(s)</small> : warrantyDays < 0 ? <small className="cell-subtitle">Garantia vencida</small> : null}</span> : "—"}</td>{canManage && <td><div className="stock-controls"><button aria-label={`Retirar unidade de ${item.name}`} disabled={item.quantity === 0} onClick={() => onAdjust(item, -1)} type="button">−</button><button aria-label={`Adicionar unidade de ${item.name}`} onClick={() => onAdjust(item, 1)} type="button">+</button></div></td>}</tr>; })}</tbody></table></div> : <EmptyState note="Ajuste a busca ou cadastre um novo item." title="Nenhum componente encontrado" />}</section></Reveal>
      <Reveal><ABCInventoryChart canManage={canManage} inventory={allInventory} onAdjust={onAdjust} /></Reveal>
      <Reveal><section className="panel page-panel"><div className="panel-heading"><div><h2>Curva ABC</h2><p>Classificação pela participação acumulada no valor atual do estoque</p></div></div><div className="table-scroll"><table><thead><tr><th>Classe</th><th>Componente</th><th>Valor em estoque</th></tr></thead><tbody>{abc.map((item) => <tr key={item.id}><td><span className={`badge badge-${item.classification === "A" ? "blue" : item.classification === "B" ? "amber" : "neutral"}`}>{item.classification}</span></td><td>{item.name}</td><td>{money(item.stockValue)}</td></tr>)}</tbody></table></div></section></Reveal>
      <Reveal><section className="panel page-panel"><div className="panel-heading"><div><h2>Fornecedores</h2><p>Contatos para reposição de componentes.</p></div></div>{canManage && <form className="toolbar" onSubmit={onAddSupplier}><input aria-label="Nome do fornecedor" maxLength="120" name="name" placeholder="Nome do fornecedor" required /><input aria-label="E-mail do fornecedor" name="email" placeholder="E-mail" type="email" /><input aria-label="Telefone do fornecedor" name="phone" placeholder="Telefone" /><Button type="submit"><Icon name="plus" size={14} /> Adicionar</Button></form>}{suppliers.length ? <div className="table-scroll"><table><thead><tr><th>Fornecedor</th><th>Contato</th><th>Status</th>{canManage && <th>Ação</th>}</tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.email || "—"}<span className="cell-subtitle">{supplier.phone || ""}</span></td><td>{supplier.active === false ? "Inativo" : "Ativo"}</td>{canManage && <td><button className="text-link remove-link" onClick={() => onRemoveSupplier(supplier)} type="button">Remover</button></td>}</tr>)}</tbody></table></div> : <EmptyState note="Cadastre fornecedores para manter os contatos de reposição em um só lugar." title="Nenhum fornecedor cadastrado" />}</section></Reveal>
      {movements.length > 0 && <Reveal delay={0.1}><section className="panel movement-panel"><div className="panel-heading"><div><h2>Histórico de movimentações</h2><p>{movements.length} entradas e saídas registradas</p></div><select aria-label="Quantidade de movimentações por página" className="filter-select" onChange={(event) => {setMovementFilter(Number(event.target.value)); setMovementPage(0);}} value={movementFilter}><option value={5}>5 por página</option><option value={10}>10 por página</option><option value={25}>25 por página</option></select></div><div className="toolbar"><label className="search-box"><Icon name="search" size={18} /><input aria-label="Filtrar movimentações" onChange={(event) => {setMovementQuery(event.target.value); setMovementPage(0);}} placeholder="Filtrar por item ou pessoa" value={movementQuery} /></label></div>{visibleMovements.length ? <div className="movement-list">{visibleMovements.map((move) => <div className="movement-row" key={move.id}><span className={`movement-sign ${move.quantity > 0 ? "positive" : "negative"}`}>{move.quantity > 0 ? `+${move.quantity}` : `${move.quantity}`}</span><span><strong>{move.item}</strong><small>{move.person} · {new Date(move.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small></span></div>)}</div> : <EmptyState note="Tente outro nome de item ou pessoa." title="Nenhuma movimentação encontrada" />}<div className="panel-heading"><small>Página {movementPage + 1} de {movementPages}</small><div><button className="button button-secondary" disabled={!movementPage} onClick={() => setMovementPage((page) => page - 1)} type="button">Anterior</button> <button className="button button-secondary" disabled={movementPage + 1 >= movementPages} onClick={() => setMovementPage((page) => page + 1)} type="button">Próxima</button></div></div></section></Reveal>}
    </PageErrorBoundary>
  );
}

/* Clientes: cadastro + histórico derivado de chamados e notas fiscais. */
export function CustomersPage({ clients, query, setQuery, onOpenTickets, canManage, remoteAuth = false, onAdd, onEdit, onToggle }) {
  const rows = clients.filter((client) => `${client.name} ${client.company || ""} ${client.document || ""} ${client.email || ""} ${client.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
  const ticketCount = clients.reduce((sum, client) => sum + client.tickets.length, 0);
  const invoiceTotal = clients.reduce((sum, client) => sum + client.invoices.filter((invoice) => invoice.status === "Emitida").reduce((value, invoice) => value + Number(invoice.total || 0), 0), 0);
  return (
    <PageErrorBoundary>
      <Reveal><section className="mini-metrics"><div><span>Clientes cadastrados ou identificados</span><strong><CountUp value={clients.length} /></strong></div><div><span>Chamados associados</span><strong><CountUp value={ticketCount} /></strong></div><div><span>Faturamento em notas emitidas</span><strong><CountUp format={money} value={invoiceTotal} /></strong></div></section></Reveal>
      <Reveal delay={0.08}><section className="panel page-panel"><div className="toolbar"><label className="search-box"><Icon name="search" size={18} /><input aria-label="Buscar cliente" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, documento, e-mail ou telefone" value={query} /></label>{canManage && <button className="button button-primary" onClick={onAdd} type="button"><Icon name="plus" size={15} /> Novo cliente</button>}<button className="button button-secondary" onClick={() => downloadCsv(rows, "gesti-clientes", ["Cliente", "Empresa", "CPF/CNPJ", "E-mail", "Telefone", "Chamados", "Notas", "Faturamento emitido"], (client) => [client.name, client.company || "", client.document || "", client.email || "", client.phone || "", client.tickets.length, client.invoices.length, client.invoices.filter((invoice) => invoice.status === "Emitida").reduce((sum, invoice) => sum + Number(invoice.total || 0), 0)])} type="button"><Icon name="download" size={15} /> CSV</button></div>
        {rows.length ? <div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Contato</th><th>Chamados</th><th>Notas fiscais</th><th>Faturamento</th><th>Ações</th></tr></thead><tbody>{rows.map((client) => <tr className={client.active === false ? "muted-row" : ""} key={client.id || client.name}><td><span className="cell-title">{client.name}</span><span className="cell-subtitle">{client.company || client.document || "Cadastro identificado pelo histórico"}</span></td><td>{client.email || "—"}<span className="cell-subtitle">{client.phone || ""}</span></td><td>{client.tickets.length}<span className="cell-subtitle">{client.tickets.filter((ticket) => ticket.status !== "Resolvido").length} ativos</span></td><td>{client.invoices.length}</td><td>{money(client.invoices.filter((invoice) => invoice.status === "Emitida").reduce((sum, invoice) => sum + Number(invoice.total || 0), 0))}</td><td className="client-actions">{client.id && canManage && <><button className="text-link" onClick={() => onEdit(client)} type="button">Editar</button><button className="text-link" onClick={() => onToggle(client)} type="button">{client.active === false ? "Reativar" : "Arquivar"}</button></>}<button className="text-link" onClick={() => onOpenTickets(client.name)} type="button"><Icon name="ticket" size={14} /> Chamados</button></td></tr>)}</tbody></table></div> : <EmptyState note="Cadastre um cliente ou registre chamados e notas para preencher o histórico automaticamente." title="Nenhum cliente encontrado" />}</section></Reveal>
      <p className="data-note">{remoteAuth ? "Os contatos cadastrados ficam disponíveis para os membros autorizados da empresa." : "Os contatos cadastrados são locais a este navegador."} Clientes encontrados nos documentos e chamados aparecem automaticamente.</p>
    </PageErrorBoundary>
  );
}

/* Registro: linha do tempo por dia vinculando chamados às suas notas. */
export function RegistryPage({ invoices = [], tickets = [], onOpenInvoice }) {
  const events = [
    ...tickets.filter((ticket) => ticket && typeof ticket === "object").map((ticket) => ({ type: "ticket", id: ticket.id || ticket.title || "chamado", date: ticket.createdAt, ticket })),
    ...invoices.filter((invoice) => invoice && typeof invoice === "object").map((invoice) => ({ type: "invoice", id: invoice.id || invoice.number || "nota", date: invoice.createdAt, invoice })),
  ];
  const grouped = new Map();
  for (const event of events) {
    const parsed = event.date ? new Date(event.date) : null;
    const key = !parsed || Number.isNaN(parsed.getTime()) ? "sem-data" : parsed.toISOString().slice(0, 10);
    grouped.set(key, [...(grouped.get(key) || []), event]);
  }
  const dates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));
  const invoiceForTicket = (ticket) => invoices.filter((invoice) => invoice.ticketId === ticket.id || (ticket.invoiceIds || []).includes(invoice.id));
  const ticketForInvoice = (invoice) => tickets.find((ticket) => ticket.id === invoice.ticketId || (ticket.invoiceIds || []).includes(invoice.id));

  return (
    <PageErrorBoundary>
      <section className="panel registry-panel">
        <div className="panel-heading"><div><h2>Linha do tempo</h2><p>{invoices.length} notas fiscais · {tickets.length} chamados</p></div></div>
        {events.length ? <div className="registry-timeline">{dates.map((date) => {
          const dayEvents = (grouped.get(date) || []).sort((a, b) => `${b.date || ""}#${b.id}`.localeCompare(`${a.date || ""}#${a.id}`));
          return <section className="registry-day" key={date}>
            <h3>{date === "sem-data" ? "Sem data registrada" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`))}</h3>
            <div className="registry-day-events">{dayEvents.map((event) => event.type === "ticket" ? (() => {
              const linked = invoiceForTicket(event.ticket);
              return <article className="registry-event" key={`ticket-${event.id}`}>
                <span className="registry-event-icon registry-ticket"><Icon name="ticket" size={16} /></span>
                <div className="registry-event-copy"><strong>{event.ticket.title || "Chamado sem título"}</strong><small>Chamado {event.ticket.id || "—"} · {event.ticket.requester || "Solicitante não informado"} · {event.ticket.status || "Aberto"} · prioridade {event.ticket.priority || "Baixa"}</small>
                  {linked.length ? <div className="registry-links">{linked.map((invoice) => <button className="text-link" key={invoice.id} onClick={() => onOpenInvoice(invoice.id)} type="button"><Icon name="file" size={13} /> Nota {invoice.number}/{invoice.series} · {money(invoice.total)}</button>)}</div> : <small>Sem nota fiscal vinculada</small>}
                </div>
                <time>{event.date && !Number.isNaN(new Date(event.date).getTime()) ? new Date(event.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Horário indisponível"}</time>
              </article>;
            })() : (() => {
              const ticket = ticketForInvoice(event.invoice);
              return <article className="registry-event" key={`invoice-${event.id}`}>
                <span className="registry-event-icon registry-invoice"><Icon name="file" size={16} /></span>
                <div className="registry-event-copy"><strong>Nota fiscal {event.invoice.number || "—"}/{event.invoice.series || "—"}</strong><small>{event.invoice.customer?.name || "Cliente não informado"} · {event.invoice.status || "Rascunho"} · {money(event.invoice.total)}</small>
                  {ticket ? <small>Vinculada ao chamado {ticket.id}: {ticket.title}</small> : <small>Sem chamado vinculado</small>}
                </div>
                <button className="text-link" disabled={!event.invoice.id} onClick={() => onOpenInvoice(event.invoice.id)} type="button">Abrir nota <Icon name="arrow" size={13} /></button>
              </article>;
            })())}</div>
          </section>;
        })}</div> : <EmptyState note="Chamados e notas fiscais aparecerão aqui quando forem registrados." title="Registro vazio" />}
      </section>
    </PageErrorBoundary>
  );
}
