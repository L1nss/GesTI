import { useMemo, useState } from "react";
import { ExpenseCharts } from "../ExpenseCharts.jsx";
import { Badge, Button, EmptyState, Icon, PageErrorBoundary, Reveal } from "../shared.jsx";
import { useToast } from "../toast.js";
import { downloadCsv, money, shortDate, today } from "../utils.js";

const TABS = [
  ["Resumo", "chart"], ["Lançamentos", "list"], ["Compras", "box"],
  ["Contas a pagar", "download"], ["Contas a receber", "trend"], ["Orçamentos", "receipt"],
];
const PURCHASE_STAGES = ["Solicitada", "Em cotação", "Pedido emitido", "Recebida"];
const paymentLabel = (expense) => expense.status === "Aprovada" && expense.paymentStatus === "Aguardando aprovação"
  ? "A pagar"
  : expense.paymentStatus || (expense.status === "Aprovada" ? "A pagar" : "Aguardando aprovação");
const isOverdue = (date, paid) => Boolean(date && date < today() && !paid);
const csvRows = (expenses, invoices) => [
  ...expenses.filter((item) => item.status !== "Rejeitada").map((item) => [
    item.date || "", item.kind === "Compra" ? "Compra" : "Despesa", item.category || "", item.title || "",
    item.supplier || item.requester || "", item.costCenter || "", item.dueDate || "", -Math.abs(Number(item.amount) || 0),
    item.status || "", paymentLabel(item), item.purchaseStage || "",
  ]),
  ...invoices.filter((item) => item.status === "Emitida").map((item) => [
    item.createdAt || "", "Receita", "Serviços", `Nota ${item.number}/${item.series}`, item.customer?.name || "",
    "", item.dueDate || "", Number(item.total) || 0, item.status, item.paymentStatus || "Não informado", "",
  ]),
];

function SummaryCards({ expenses, invoices }) {
  const approved = expenses.filter((item) => item.status === "Aprovada");
  const paid = approved.filter((item) => paymentLabel(item) === "Paga").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const payable = approved.filter((item) => paymentLabel(item) !== "Paga").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const emitted = invoices.filter((item) => item.status === "Emitida");
  const billed = emitted.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const receivable = emitted.filter((item) => item.paymentStatus === "A receber").reduce((sum, item) => sum + Number(item.total || 0), 0);
  return <section aria-label="Indicadores financeiros" className="finance-kpis">
    <article><span>Faturado em notas emitidas</span><strong>{money(billed)}</strong><small>{emitted.length} documento(s)</small></article>
    <article><span>A receber</span><strong>{money(receivable)}</strong><small>Pagamento ainda não registrado</small></article>
    <article><span>Contas aprovadas a pagar</span><strong>{money(payable)}</strong><small>Não inclui solicitações pendentes</small></article>
    <article><span>Despesas já pagas</span><strong>{money(paid)}</strong><small>Comprovante deve ser conferido pela empresa</small></article>
  </section>;
}

function ExpenseTable({ rows, canApprove, onStatus, onPaymentStatus, onSelectPayment, purchases = false }) {
  const notify = useToast();
  const handleStatus = async (expense, status) => {
    await onStatus(expense.id, status);
    notify({ tone: status === "Aprovada" ? "success" : "info", title: status === "Aprovada" ? "Despesa aprovada" : "Despesa rejeitada", message: status === "Aprovada" ? `${expense.title} liberada para pagamento.` : `${expense.title} não seguirá para pagamento.` });
  };
  if (!rows.length) return <EmptyState note={purchases ? "Registre uma solicitação de compra para acompanhar cotações e recebimento." : "Registre um lançamento ou ajuste os filtros."} title={purchases ? "Nenhuma compra" : "Sem lançamentos"} />;
  return <div className="table-scroll"><table><thead><tr>
    <th>{purchases ? "Compra" : "Lançamento"}</th><th>Fornecedor / solicitante</th><th>Categoria</th>{purchases && <th>Cotações</th>}<th>Vencimento</th><th>Valor</th><th>Aprovação</th>{purchases && <th>Etapa da compra</th>}<th>Pagamento</th>{canApprove && <th>Ações</th>}
  </tr></thead><tbody>{rows.map((expense) => {
    const paid = paymentLabel(expense) === "Paga";
    const overdue = isOverdue(expense.dueDate, paid);
    return <tr key={expense.id}>
      <td><span className="cell-title">{expense.title}</span><span className="cell-subtitle">{expense.id} · {expense.kind === "Compra" ? "Compra" : "Despesa"}{expense.costCenter ? ` · ${expense.costCenter}` : ""}{expense.notes ? ` · ${expense.notes}` : ""}</span></td>
      <td>{expense.supplier || expense.requester || "—"}</td><td>{expense.category || "—"}</td>
      {purchases && <td>{expense.supplierQuotes?.length ? <span className="finance-quote-summary" title={expense.supplierQuotes.map((quote) => `${quote.supplier}: ${money(quote.amount)}`).join(" · ")}>{expense.supplierQuotes.length} cotação(ões) · menor {money(Math.min(...expense.supplierQuotes.map((quote) => Number(quote.amount))))}</span> : "—"}</td>}
      <td><span className={overdue ? "text-warning" : ""}>{expense.dueDate ? shortDate(expense.dueDate) : "—"}{overdue ? " · vencida" : ""}</span></td>
      <td className="amount-cell">{money(expense.amount)}</td>
      <td><Badge tone={expense.status === "Aprovada" ? "green" : expense.status === "Rejeitada" ? "red" : "amber"}>{expense.status}</Badge></td>
      {purchases && <td><select aria-label={`Etapa da compra ${expense.title}`} className="finance-inline-select" disabled={!canApprove || expense.status !== "Aprovada"} onChange={(event) => onSelectPayment(expense.id, { purchaseStage: event.target.value })} value={expense.purchaseStage || "Solicitada"}>{PURCHASE_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></td>}
      <td><Badge tone={paid ? "green" : overdue ? "red" : "neutral"}>{paymentLabel(expense)}</Badge></td>
      {canApprove && <td><div className="approval-actions">
        {expense.status === "Pendente" ? <><button aria-label={`Aprovar ${expense.title}`} className="approve-button" onClick={() => handleStatus(expense, "Aprovada")} type="button"><Icon name="check" size={16}/></button><button aria-label={`Rejeitar ${expense.title}`} className="reject-button" onClick={() => handleStatus(expense, "Rejeitada")} type="button"><Icon name="close" size={16}/></button></> : expense.status === "Aprovada" && !paid ? <button className="button button-secondary finance-small-action" onClick={() => onPaymentStatus(expense.id, "Paga")} type="button">Marcar paga</button> : <span className="quiet-note">{paid ? "Concluída" : "—"}</span>}
      </div></td>}
    </tr>;
  })}</tbody></table></div>;
}

export function ExpensesPage({ expenses = [], budgets = [], invoices = [], canApprove, onStatus, onPaymentStatus, onPurchaseStage, onInvoicePaymentStatus, onSaveBudget, role }) {
  const [tab, setTab] = useState("Resumo");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [monthFilter, setMonthFilter] = useState("");
  const month = today().slice(0, 7);
  const filtered = useMemo(() => expenses.filter((expense) =>
    (statusFilter === "Todos" || expense.status === statusFilter)
    && (categoryFilter === "Todas" || expense.category === categoryFilter)
    && (!monthFilter || String(expense.date || "").startsWith(monthFilter))
    && `${expense.id} ${expense.title} ${expense.requester} ${expense.supplier || ""} ${expense.category} ${expense.notes || ""}`.toLowerCase().includes(query.toLowerCase())),
  [expenses, statusFilter, categoryFilter, monthFilter, query]);
  const purchases = filtered.filter((expense) => expense.kind === "Compra");
  const payable = filtered.filter((expense) => expense.status === "Aprovada");
  const categories = useMemo(() => [...new Set(expenses.map((expense) => expense.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [expenses]);
  const payableInvoices = invoices.filter((invoice) => invoice.status === "Emitida" && ["A receber", "Recebida"].includes(invoice.paymentStatus));
  const spreadsheet = () => downloadCsv(csvRows(expenses, invoices), `gesti-financeiro-${today()}`, ["Data", "Tipo", "Categoria", "Descrição", "Contraparte", "Centro de custo", "Vencimento", "Valor", "Status", "Pagamento", "Etapa da compra"], (row) => row);
  const resetFilters = () => { setCategoryFilter("Todas"); setMonthFilter(""); setQuery(""); setStatusFilter("Todos"); };

  return <PageErrorBoundary>
    <SummaryCards expenses={expenses} invoices={invoices}/>
    <Reveal><section aria-label="Seções financeiras" className="finance-tabs" role="tablist">{TABS.map(([label, icon]) => <button aria-selected={tab === label} className={tab === label ? "finance-tab active" : "finance-tab"} key={label} onClick={() => setTab(label)} role="tab" type="button"><Icon name={icon} size={16}/>{label}{label === "Contas a pagar" && payable.length > 0 && <span>{payable.length}</span>}{label === "Contas a receber" && payableInvoices.length > 0 && <span>{payableInvoices.length}</span>}</button>)}</section></Reveal>

    {tab === "Resumo" && <>
      <ExpenseCharts budgets={budgets} expenses={expenses} invoices={invoices} onSelectCategory={(category) => { setCategoryFilter(category); setMonthFilter(month); setQuery(""); setStatusFilter("Todos"); setTab("Lançamentos"); }} onSelectExpense={(expense) => { setQuery(expense.title); setMonthFilter(String(expense.date || "").slice(0, 7)); setStatusFilter("Todos"); setTab("Lançamentos"); }} onSelectMonth={(selected) => { setMonthFilter(selected); setQuery(""); setStatusFilter("Todos"); setTab("Lançamentos"); }} selectedCategory={categoryFilter} selectedMonth={monthFilter}/>
      <p className="finance-method-note">Faturamento, recebimentos, aprovações e pagamentos são acompanhados separadamente. Emissão de nota não confirma recebimento; despesas aprovadas não são consideradas pagas até o registro manual.</p>
    </>}

    {(tab === "Lançamentos" || tab === "Compras" || tab === "Contas a pagar") && <Reveal><section className="panel page-panel">
      <div className="panel-heading"><div><h2>{tab}</h2><p>{tab === "Compras" ? "Solicitação, aprovação, cotação, pedido e recebimento." : tab === "Contas a pagar" ? "Acompanhe obrigações aprovadas, vencimentos e pagamentos realizados." : "Despesas operacionais e solicitações de compra da empresa."}</p></div><Button onClick={spreadsheet} variant="secondary"><Icon name="download" size={15}/> Planilha CSV</Button></div>
      {tab !== "Compras" && <div className="toolbar">
        <label className="search-box"><Icon name="search" size={18}/><input aria-label="Buscar lançamento" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição, fornecedor ou categoria" value={query}/></label>
        {tab === "Lançamentos" && <><select aria-label="Filtrar por status de aprovação" className="filter-select" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option>Todos</option><option>Pendente</option><option>Aprovada</option><option>Rejeitada</option></select><select aria-label="Filtrar por categoria" className="filter-select" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}><option>Todas</option>{categories.map((category) => <option key={category}>{category}</option>)}</select><input aria-label="Filtrar por mês" className="filter-select" onChange={(event) => setMonthFilter(event.target.value)} type="month" value={monthFilter}/></>}
        {(query || categoryFilter !== "Todas" || monthFilter || statusFilter !== "Todos") && <button className="text-link" onClick={resetFilters} type="button">Limpar filtros</button>}
      </div>}
      {tab === "Lançamentos" && <ExpenseTable canApprove={canApprove} onPaymentStatus={onPaymentStatus} onSelectPayment={onPurchaseStage} onStatus={onStatus} rows={filtered}/>}
      {tab === "Compras" && <ExpenseTable canApprove={canApprove} onPaymentStatus={onPaymentStatus} onSelectPayment={onPurchaseStage} onStatus={onStatus} purchases rows={purchases}/>}
      {tab === "Contas a pagar" && <ExpenseTable canApprove={canApprove} onPaymentStatus={onPaymentStatus} onSelectPayment={onPurchaseStage} onStatus={onStatus} rows={payable}/>}
    </section></Reveal>}

    {tab === "Contas a receber" && <Reveal><section className="panel page-panel"><div className="panel-heading"><div><h2>Contas a receber</h2><p>Notas emitidas com situação financeira registrada. Marque o recebimento após conferir no banco.</p></div><Button onClick={spreadsheet} variant="secondary"><Icon name="download" size={15}/> Planilha CSV</Button></div>
      {payableInvoices.length ? <div className="table-scroll"><table><thead><tr><th>Nota / cliente</th><th>Emissão</th><th>Vencimento</th><th>Valor</th><th>Pagamento</th>{canApprove && <th>Ação</th>}</tr></thead><tbody>{payableInvoices.map((invoice) => { const received = invoice.paymentStatus === "Recebida"; return <tr key={invoice.id}><td><span className="cell-title">{invoice.number}/{invoice.series} · {invoice.customer?.name || "Cliente"}</span><span className="cell-subtitle">{invoice.id}</span></td><td>{shortDate(invoice.createdAt)}</td><td><span className={isOverdue(invoice.dueDate, received) ? "text-warning" : ""}>{invoice.dueDate ? shortDate(invoice.dueDate) : "—"}{isOverdue(invoice.dueDate, received) ? " · vencida" : ""}</span></td><td className="amount-cell">{money(invoice.total)}</td><td><Badge tone={received ? "green" : isOverdue(invoice.dueDate, false) ? "red" : "amber"}>{received ? "Recebida" : "A receber"}</Badge></td>{canApprove && <td>{!received ? <button className="button button-secondary finance-small-action" onClick={() => onInvoicePaymentStatus(invoice, "Recebida")} type="button">Registrar recebimento</button> : <button className="text-link" onClick={() => onInvoicePaymentStatus(invoice, "A receber")} type="button">Reabrir</button>}</td>}</tr>; })}</tbody></table></div> : <EmptyState note="Emita uma nota de serviço para acompanhar valores a receber." title="Nenhum valor em aberto"/>}
      <p className="finance-method-note">Notas antigas sem estado de pagamento não entram nesta lista para evitar tratá-las como recebidas ou pendentes sem confirmação.</p>
    </section></Reveal>}

    {tab === "Orçamentos" && <Reveal><section className="panel page-panel"><div className="panel-heading"><div><h2>Orçamentos por categoria</h2><p>Compare solicitações e despesas aprovadas com o limite mensal.</p></div><Button onClick={spreadsheet} variant="secondary"><Icon name="download" size={15}/> Planilha CSV</Button></div>
      {canApprove && <form className="toolbar" onSubmit={onSaveBudget}><input aria-label="Categoria do orçamento" list="budget-categories" name="category" placeholder="Categoria" required/><datalist id="budget-categories">{categories.map((category) => <option key={category} value={category}/>)}</datalist><input aria-label="Mês do orçamento" defaultValue={month} name="month" required type="month"/><input aria-label="Limite mensal" min="0.01" name="amount" placeholder="Limite (R$)" required step="0.01" type="number"/><Button type="submit"><Icon name="plus" size={14}/> Salvar orçamento</Button></form>}
      {budgets.length ? <div className="table-scroll"><table><thead><tr><th>Categoria</th><th>Mês</th><th>Solicitado + aprovado</th><th>Limite</th><th>Uso</th></tr></thead><tbody>{budgets.map((budget) => { const spent = expenses.filter((expense) => expense.category === budget.category && String(expense.date || "").startsWith(String(budget.month).slice(0, 7)) && expense.status !== "Rejeitada").reduce((sum, expense) => sum + Number(expense.amount || 0), 0); const pct = budget.amount ? Math.round(spent / budget.amount * 100) : 0; return <tr key={budget.id}><td>{budget.category}</td><td>{String(budget.month).slice(0, 7)}</td><td>{money(spent)}</td><td>{money(budget.amount)}</td><td><span className={pct >= 90 ? "text-warning" : ""}>{pct}%</span><div className="budget-meter"><i style={{ width: `${Math.min(pct, 100)}%` }}/></div></td></tr>; })}</tbody></table></div> : <EmptyState note="Defina um limite mensal para acompanhar a execução do orçamento." title="Nenhum orçamento cadastrado"/>}
    </section></Reveal>}
    <Reveal delay={0.05}><p className="permission-note">Aprovação e atualização de pagamentos disponíveis para perfis com acesso financeiro{role ? ` · perfil ${role}` : ""}.</p></Reveal>
  </PageErrorBoundary>;
}
