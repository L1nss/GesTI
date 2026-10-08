import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CountUp, EmptyState, Icon, Reveal } from "./shared.jsx";
import { money, shortDate } from "./utils.js";

const COLORS = ["#2C666E", "#90DDF0", "#07393C", "#718A8C", "#B7C7C8", "#C28D38"];
const AXIS_COLOR = "var(--chart-axis)";
const GRID_COLOR = "var(--chart-grid)";
const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key) => {
  const [year, month] = key.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(Number(year), Number(month) - 1, 1)).replace(".", "");
};
function lastMonths(count) {
  const keys = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}
function ChartsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((entry) => <span key={entry.dataKey}><i style={{ background: entry.color || entry.payload?.fill }} />{entry.name}: <b>{money(entry.value)}</b></span>)}</div>;
}

/* Gráficos de custos ligados aos filtros da lista de lançamentos. */
export function ExpenseCharts({ expenses = [], invoices = [], budgets = [], selectedMonth = "", onSelectMonth, selectedCategory = "Todas", onSelectCategory, onSelectExpense }) {
  const [range, setRange] = useState(6);
  const categories = useMemo(() => Array.from(new Set(expenses.map((expense) => expense.category).filter(Boolean))).sort(), [expenses]);
  const keys = useMemo(() => lastMonths(range), [range]);
  const monthly = useMemo(() => {
    const buckets = Object.fromEntries(keys.map((key) => [key, { key, approved: 0, pending: 0, billed: 0, received: 0, paid: 0 }]));
    for (const expense of expenses) {
      const key = String(expense.date || "").slice(0, 7);
      if (!buckets[key] || expense.status === "Rejeitada" || (selectedCategory !== "Todas" && expense.category !== selectedCategory)) continue;
      const value = Number(expense.amount) || 0;
      if (expense.status === "Aprovada") buckets[key].approved += value;
      if (expense.status === "Pendente") buckets[key].pending += value;
      if (expense.status === "Aprovada" && expense.paymentStatus === "Paga") {
        const paidKey = String(expense.paidAt || expense.date || "").slice(0, 7);
        if (buckets[paidKey]) buckets[paidKey].paid += value;
      }
    }
    for (const invoice of invoices) {
      if (invoice.status !== "Emitida") continue;
      const billedKey = String(invoice.createdAt || "").slice(0, 7);
      if (buckets[billedKey]) buckets[billedKey].billed += Number(invoice.total) || 0;
      if (invoice.paymentStatus === "Recebida") {
        const receivedKey = String(invoice.paidAt || invoice.createdAt || "").slice(0, 7);
        if (buckets[receivedKey]) buckets[receivedKey].received += Number(invoice.total) || 0;
      }
    }
    return keys.map((key) => ({ ...buckets[key], month: monthLabel(key), total: buckets[key].approved + buckets[key].pending }));
  }, [expenses, invoices, keys, selectedCategory]);

  const activeMonth = selectedMonth || currentMonthKey();
  const categoryData = useMemo(() => {
    const grouped = new Map();
    for (const expense of expenses) {
      if (String(expense.date || "").slice(0, 7) !== activeMonth || expense.status === "Rejeitada") continue;
      if (selectedCategory !== "Todas" && expense.category !== selectedCategory) continue;
      const row = grouped.get(expense.category) || { name: expense.category || "Sem categoria", approved: 0, pending: 0 };
      row[expense.status === "Aprovada" ? "approved" : "pending"] += Number(expense.amount) || 0;
      grouped.set(expense.category, row);
    }
    return [...grouped.values()].map((entry) => ({ ...entry, total: entry.approved + entry.pending })).sort((a, b) => b.total - a.total);
  }, [expenses, activeMonth, selectedCategory]);

  const budgetData = useMemo(() => {
    const byName = new Map(categoryData.map((entry) => [entry.name, { ...entry }]));
    for (const item of budgets) {
      if (String(item.month || "").slice(0, 7) !== activeMonth) continue;
      const name = item.category || "Sem categoria";
      if (selectedCategory !== "Todas" && name !== selectedCategory) continue;
      const entry = byName.get(name) || { name, approved: 0, pending: 0, total: 0, budget: 0 };
      entry.budget = (entry.budget || 0) + (Number(item.amount) || 0);
      byName.set(name, entry);
    }
    return [...byName.values()].map((entry) => ({ ...entry, budget: entry.budget || 0 })).sort((a, b) => b.total - a.total || b.budget - a.budget);
  }, [categoryData, budgets, activeMonth, selectedCategory]);
  const topExpenses = useMemo(() => expenses.filter((expense) => expense.status !== "Rejeitada" && String(expense.date || "").startsWith(activeMonth) && (selectedCategory === "Todas" || expense.category === selectedCategory)).slice().sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5), [expenses, activeMonth, selectedCategory]);

  const totalRange = monthly.reduce((sum, entry) => sum + entry.total, 0);
  const average = monthly.length ? totalRange / monthly.length : 0;
  const pendingCurrent = expenses.filter((entry) => entry.status === "Pendente" && String(entry.date || "").startsWith(currentMonthKey()) && (selectedCategory === "Todas" || entry.category === selectedCategory)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const budgetsCurrent = budgets.filter((entry) => String(entry.month || "").slice(0, 7) === activeMonth && (selectedCategory === "Todas" || entry.category === selectedCategory)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const spendingCurrent = expenses.filter((entry) => entry.status !== "Rejeitada" && String(entry.date || "").startsWith(activeMonth) && (selectedCategory === "Todas" || entry.category === selectedCategory)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const budgetUsage = budgetsCurrent ? Math.round(spendingCurrent / budgetsCurrent * 100) : null;

  if (!expenses.length && !invoices.some((invoice) => invoice.status === "Emitida")) return <EmptyState title="Sem dados financeiros ainda" note="Registre uma despesa ou emita um documento para acompanhar o fluxo financeiro." />;

  return <>
    <Reveal><section className="charts-toolbar">
      <div className="charts-range" aria-label="Período dos gráficos">{[3, 6, 12].map((option) => <button className={range === option ? "range-on" : ""} key={option} onClick={() => setRange(option)} type="button">{option} meses</button>)}</div>
      <label className="charts-category"><span>Categoria</span><select onChange={(event) => onSelectCategory?.(event.target.value)} value={selectedCategory}><option>Todas</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="charts-category"><span>Mês em foco</span><input aria-label="Mês em foco dos custos" onChange={(event) => onSelectMonth?.(event.target.value)} type="month" value={selectedMonth} /></label>
      {(selectedMonth || selectedCategory !== "Todas") && <button className="text-link" onClick={() => { onSelectMonth?.(""); onSelectCategory?.("Todas"); }} type="button">Limpar filtros</button>}
    </section></Reveal>

    <Reveal delay={0.04}><section className="mini-metrics">
      <div><span>Gastos no período</span><strong><CountUp format={money} value={totalRange} /></strong></div>
      <div><span>Média mensal</span><strong><CountUp format={money} value={average} /></strong></div>
      <div><span>Pendente de aprovação · mês atual</span><strong><CountUp format={money} value={pendingCurrent} /></strong></div>
      <div><span>Uso do orçamento · {monthLabel(activeMonth)}</span><strong className={budgetUsage !== null && budgetUsage >= 90 ? "text-warning" : ""}>{budgetUsage === null ? "Sem limite" : `${budgetUsage}%`}</strong></div>
    </section></Reveal>

    <div className="charts-grid">
      <Reveal className="chart-card" delay={0.05}>
        <div className="chart-head"><div><h3>Faturado, recebido e pago</h3><p>Faturamento não significa recebimento; pagamentos são registrados separadamente.</p></div><span className="chart-icon"><Icon name="trend" size={16}/></span></div>
        <div className="chart-body"><ResponsiveContainer height="100%" width="100%"><BarChart data={monthly} margin={{ bottom: 0, left: 4, right: 8, top: 8 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="4 6" vertical={false}/><XAxis axisLine={false} dataKey="month" stroke={AXIS_COLOR} tick={{fontSize:11}} tickLine={false}/><YAxis axisLine={false} stroke={AXIS_COLOR} tick={{fontSize:11}} tickFormatter={(value)=>value>=1000?`R$ ${(value/1000).toFixed(1)}k`:`R$ ${value}`} tickLine={false} width={64}/><Tooltip content={<ChartsTooltip/>} cursor={{fill:"var(--chart-cursor)"}}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11.5,paddingTop:6}}/>
          <Bar dataKey="billed" name="Faturado" fill="#40798C" radius={[5,5,0,0]}/><Bar dataKey="received" name="Recebido" fill="#70A9A1" radius={[5,5,0,0]}/><Bar dataKey="paid" name="Despesas pagas" fill="#C28D38" radius={[5,5,0,0]}/>
        </BarChart></ResponsiveContainer></div>
      </Reveal>
      <Reveal className="chart-card" delay={0.06}>
        <div className="chart-head"><div><h3>Despesas por mês</h3><p>Selecione uma coluna para filtrar os lançamentos. Rejeitadas ficam fora.</p></div><span className="chart-icon"><Icon name="trend" size={16} /></span></div>
        <div className="chart-body"><ResponsiveContainer height="100%" width="100%"><BarChart data={monthly} margin={{ bottom: 0, left: 4, right: 8, top: 8 }} onClick={(event) => { const point = event?.activePayload?.[0]?.payload; if (point) onSelectMonth?.(point.key); }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="4 6" vertical={false} /><XAxis axisLine={false} dataKey="month" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={(value) => value >= 1000 ? `R$ ${(value / 1000).toFixed(1)}k` : `R$ ${value}`} tickLine={false} width={64} /><Tooltip content={<ChartsTooltip />} cursor={{ fill: "var(--chart-cursor)" }} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} />
          <Bar dataKey="approved" name="Aprovadas" stackId="spend" fill="#2C666E" radius={[0, 0, 0, 0]} /><Bar dataKey="pending" name="Pendentes" stackId="spend" fill="#90DDF0" radius={[6, 6, 0, 0]} />
        </BarChart></ResponsiveContainer></div>
      </Reveal>

      <Reveal className="chart-card" delay={0.1}>
        <div className="chart-head"><div><h3>Orçamento por categoria</h3><p>Realizado e pendente contra o limite mensal de {monthLabel(activeMonth)}.</p></div><span className="chart-icon"><Icon name="chart" size={16} /></span></div>
        <div className="chart-body">{budgetData.length ? <ResponsiveContainer height="100%" width="100%"><BarChart data={budgetData} layout="vertical" margin={{ bottom: 0, left: 8, right: 14, top: 4 }} onClick={(event) => { const point = event?.activePayload?.[0]?.payload; if (point) onSelectCategory?.(point.name); }}>
          <CartesianGrid stroke={GRID_COLOR} horizontal={false} strokeDasharray="4 6" /><XAxis axisLine={false} stroke={AXIS_COLOR} tick={{ fontSize: 10 }} tickFormatter={(value) => value >= 1000 ? `R$ ${(value / 1000).toFixed(1)}k` : `R$ ${value}`} tickLine={false} /><YAxis axisLine={false} dataKey="name" stroke={AXIS_COLOR} tick={{ fontSize: 10.5 }} tickLine={false} width={110} /><Tooltip content={<ChartsTooltip />} cursor={{ fill: "var(--chart-cursor)" }} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Bar barSize={13} dataKey="budget" name="Limite" fill="#B7C7C8" radius={[0, 6, 6, 0]} /><Bar barSize={13} dataKey="approved" name="Aprovado" stackId="actual" fill="#2C666E" /><Bar barSize={13} dataKey="pending" name="Pendente" stackId="actual" fill="#C28D38" radius={[0, 6, 6, 0]} />
        </BarChart></ResponsiveContainer> : <EmptyState title="Sem despesas neste mês" note="Escolha outro mês ou registre um lançamento." />}</div>
      </Reveal>

      <Reveal className="chart-card" delay={0.14}>
        <div className="chart-head"><div><h3>Maiores despesas · {monthLabel(activeMonth)}</h3><p>Selecione uma barra para localizar o lançamento.</p></div><span className="chart-icon"><Icon name="receipt" size={16} /></span></div>
        <div className="chart-body">{topExpenses.length ? <ResponsiveContainer height="100%" width="100%"><BarChart data={topExpenses} layout="vertical" margin={{ bottom: 0, left: 8, right: 16, top: 4 }} onClick={(event) => { const point = event?.activePayload?.[0]?.payload; if (point) onSelectExpense?.(point); }}>
          <CartesianGrid stroke={GRID_COLOR} horizontal={false} strokeDasharray="4 6" /><XAxis axisLine={false} stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={(value) => value >= 1000 ? `R$ ${(value / 1000).toFixed(1)}k` : `R$ ${value}`} tickLine={false} /><YAxis axisLine={false} dataKey="title" stroke={AXIS_COLOR} tick={{ fontSize: 10.5 }} tickLine={false} width={150} /><Tooltip content={<ChartsTooltip />} cursor={{ fill: "var(--chart-cursor)" }} /><Bar barSize={16} dataKey="amount" name="Valor" fill="#2C666E" radius={[0, 7, 7, 0]}>{topExpenses.map((entry, index) => <Cell fill={COLORS[index % COLORS.length]} key={entry.id} />)}</Bar>
        </BarChart></ResponsiveContainer> : <EmptyState title="Sem lançamentos" note="Não há despesas nos filtros selecionados." />}</div>
      </Reveal>

      <Reveal className="chart-card chart-table" delay={0.18}>
        <div className="chart-head"><div><h3>Maiores lançamentos</h3><p>Os mesmos filtros da lista abaixo são aplicados aqui.</p></div></div>
        <table><thead><tr><th>Despesa</th><th>Data</th><th>Status</th><th>Valor</th></tr></thead><tbody>{topExpenses.map((expense) => <tr key={expense.id} onClick={() => onSelectExpense?.(expense)}><td><span className="cell-title">{expense.title}</span><span className="cell-subtitle">{expense.category}</span></td><td>{shortDate(expense.date)}</td><td><span className={`badge badge-${expense.status === "Aprovada" ? "green" : "amber"}`}>{expense.status}</span></td><td className="amount-cell">{money(expense.amount)}</td></tr>)}</tbody></table>
      </Reveal>
    </div>
  </>;
}
