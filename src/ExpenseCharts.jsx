import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CountUp, EmptyState, Icon, Reveal } from "./shared.jsx";
import { money, shortDate } from "./utils.js";

const CATEGORY_COLORS = ["#262626", "#fca311", "#737373", "#000000", "#a0a0a0", "#505050"];
const AXIS_COLOR = "var(--chart-axis)";
const GRID_COLOR = "var(--chart-grid)";

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
  const total = payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.dataKey}><i style={{ background: entry.color || entry.payload?.fill }} />{entry.name}: <b>{money(entry.value)}</b></span>
      ))}
      {payload.length > 1 && <small>Total: {money(total)}</small>}
    </div>
  );
}

/* --------------------- gráficos de gastos (aba Custos) --------------------- */

export function ExpenseCharts({ expenses }) {
  const [range, setRange] = useState(6);
  const [category, setCategory] = useState("Todas");

  const categories = useMemo(() => Array.from(new Set(expenses.map((expense) => expense.category))).sort(), [expenses]);

  const monthly = useMemo(() => {
    const keys = lastMonths(range);
    const buckets = Object.fromEntries(keys.map((key) => [key, { total: 0, approved: 0, pending: 0 }]));
    for (const expense of expenses) {
      const key = String(expense.date || "").slice(0, 7);
      if (!(key in buckets)) continue;
      if (expense.status === "Rejeitada") continue;
      const value = Number(expense.amount) || 0;
      buckets[key].total += value;
      if (expense.status === "Aprovada") buckets[key].approved += value;
      if (expense.status === "Pendente") buckets[key].pending += value;
    }
    return keys.map((key) => ({
      month: monthLabel(key),
      Total: Number(buckets[key].total.toFixed(2)),
      Aprovado: Number(buckets[key].approved.toFixed(2)),
      Pendente: Number(buckets[key].pending.toFixed(2)),
    }));
  }, [expenses, range]);

  const byCategory = useMemo(() => {
    const totals = {};
    for (const expense of expenses) {
      if (expense.status === "Rejeitada" || (category !== "Todas" && expense.category !== category)) continue;
      totals[expense.category] = (totals[expense.category] || 0) + (Number(expense.amount) || 0);
    }
    return Object.entries(totals)
      .map(([name, value], index) => ({ name, value: Number(value.toFixed(2)), fill: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
  }, [expenses, category]);

  const topExpenses = useMemo(() => expenses.filter((expense) => expense.status !== "Rejeitada")
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5), [expenses]);

  const totalRange = monthly.reduce((sum, entry) => sum + entry.Total, 0);
  const monthKeys = lastMonths(range);
  const currentMonth = monthKeys[monthKeys.length - 1];
  const previousMonth = monthKeys[monthKeys.length - 2];
  const sumFor = (key) => monthly.find((entry) => entry.month === monthLabel(key))?.Total || 0;
  const delta = previousMonth && sumFor(currentMonth) && sumFor(previousMonth)
    ? ((sumFor(currentMonth) - sumFor(previousMonth)) / sumFor(previousMonth)) * 100
    : 0;
  const average = monthly.length ? totalRange / monthly.length : 0;
  const highest = monthly.reduce((best, entry) => (entry.Total > best.Total ? entry : best), { month: "—", Total: 0 });

  if (!expenses.length) {
    return <EmptyState title="Sem dados de gastos ainda" note="Registre despesas para ver os gráficos de custos." />;
  }

  return (
    <>
    <Reveal>
        <section className="charts-toolbar">
          <div className="charts-range">
            {[3, 6, 12].map((option) => (
              <button className={range === option ? "range-on" : ""} key={option} onClick={() => setRange(option)} type="button">{option} meses</button>
            ))}
          </div>
          <label className="charts-category">
            <span>Categoria</span>
            <select onChange={(event) => setCategory(event.target.value)} value={category}>
              <option>Todas</option>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </section>
      </Reveal>

      <Reveal delay={0.04}>
        <section className="mini-metrics">
          <div><span>Previsto + aprovado</span><strong><CountUp format={money} value={totalRange} /></strong></div>
          <div><span>Média mensal</span><strong><CountUp format={money} value={average} /></strong></div>
          <div>
            <span>Variação vs. mês anterior</span>
            <strong className={delta > 0 ? "text-warning" : delta < 0 ? "text-positive" : ""}>
              {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta).toFixed(1)}%
            </strong>
          </div>
          <div><span>Mês com maior gasto previsto</span><strong>{highest.month}</strong></div>
        </section>
      </Reveal>

      <div className="charts-grid">
        <Reveal className="chart-card" delay={0.06}>
          <div className="chart-head">
            <div><h3>Evolução dos gastos</h3><p>Total, aprovado e pendente por mês</p></div>
            <span className="chart-icon"><Icon name="trend" size={16} /></span>
          </div>
          <div className="chart-body">
            <ResponsiveContainer height="100%" width="100%">
              <AreaChart data={monthly} margin={{ bottom: 0, left: 4, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gradTotal" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#4C6FE7" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#4C6FE7" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradApproved" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#0AA6A6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0AA6A6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="4 6" vertical={false} />
                <XAxis axisLine={false} dataKey="month" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis axisLine={false} stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={(value) => (value >= 1000 ? `R$ ${(value / 1000).toFixed(1)}k` : `R$ ${value}`)} tickLine={false} width={64} />
                <Tooltip content={<ChartsTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} />
                <Area dataKey="Total" fill="url(#gradTotal)" stroke="#4C6FE7" strokeWidth={2.2} type="monotone" />
                <Area dataKey="Aprovado" fill="url(#gradApproved)" stroke="#0AA6A6" strokeWidth={1.8} type="monotone" />
                <Area dataKey="Pendente" fill="transparent" stroke="#F2A93B" strokeDasharray="5 4" strokeWidth={1.8} type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Reveal>

        <Reveal className="chart-card" delay={0.1}>
          <div className="chart-head">
            <div><h3>Distribuição por categoria</h3><p>{category === "Todas" ? "Todas as categorias" : `Filtro: ${category}`}</p></div>
            <span className="chart-icon"><Icon name="chart" size={16} /></span>
          </div>
          <div className="chart-body">
            {byCategory.length ? (
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie
                    data={byCategory}
                    dataKey="value"
                    innerRadius="58%"
                    nameKey="name"
                    outerRadius="82%"
                    paddingAngle={3}
                    stroke="var(--chart-pie-stroke)"
                    strokeWidth={2}
                  >
                    {byCategory.map((entry) => <Cell fill={entry.fill} key={entry.name} />)}
                  </Pie>
                  <Tooltip content={<ChartsTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Sem lançamentos" note="Nenhuma despesa nesta categoria." />
            )}
          </div>
        </Reveal>

        <Reveal className="chart-card" delay={0.14}>
          <div className="chart-head">
            <div><h3>Maiores despesas</h3><p>Top 5 lançamentos por valor</p></div>
            <span className="chart-icon"><Icon name="receipt" size={16} /></span>
          </div>
          <div className="chart-body">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={topExpenses} layout="vertical" margin={{ bottom: 0, left: 8, right: 16, top: 4 }}>
                <CartesianGrid stroke={GRID_COLOR} horizontal={false} strokeDasharray="4 6" />
                <XAxis axisLine={false} stroke={AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={(value) => (value >= 1000 ? `R$ ${(value / 1000).toFixed(1)}k` : `R$ ${value}`)} tickLine={false} />
                <YAxis axisLine={false} dataKey="title" stroke={AXIS_COLOR} tick={{ fontSize: 10.5 }} tickLine={false} width={150} />
                <Tooltip content={<ChartsTooltip />} cursor={{ fill: "var(--chart-cursor)" }} />
                <Bar barSize={16} dataKey="amount" name="Valor" radius={[0, 7, 7, 0]}>
                  {topExpenses.map((entry, index) => <Cell fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} key={entry.id} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Reveal>

        <Reveal className="chart-card chart-table" delay={0.18}>
          <div className="chart-head">
            <div><h3>Detalhamento</h3><p>Lançamentos mais relevantes do período</p></div>
          </div>
          <table>
            <thead><tr><th>Despesa</th><th>Data</th><th>Status</th><th>Valor</th></tr></thead>
            <tbody>
              {topExpenses.map((expense) => (
                <tr key={expense.id}>
                  <td><span className="cell-title">{expense.title}</span><span className="cell-subtitle">{expense.category}</span></td>
                  <td>{shortDate(expense.date)}</td>
                  <td><span className={`badge badge-${expense.status === "Aprovada" ? "green" : expense.status === "Rejeitada" ? "red" : "amber"}`}>{expense.status}</span></td>
                  <td className="amount-cell">{money(expense.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </>
  );
}
