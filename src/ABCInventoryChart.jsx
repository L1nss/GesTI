import { useMemo } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "./shared.jsx";
import { money } from "./utils.js";

const CLASS_COLORS = { A: "#fca311", B: "#737373", C: "#c7c7c7" };

function AbcTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <span><i style={{ background: CLASS_COLORS[item?.classification] }} />Valor em estoque: <b>{money(item?.stockValue || 0)}</b></span>
      <span><i style={{ background: "#262626" }} />Acumulado: <b>{item?.cumulativePercent || 0}%</b></span>
      <small>Classe {item?.classification}</small>
    </div>
  );
}

export function ABCInventoryChart({ inventory = [] }) {
  const data = useMemo(() => {
    const ranked = inventory
      .map((item) => ({ ...item, stockValue: Math.max(0, Number(item.quantity || 0) * Number(item.unitCost || 0)) }))
      .sort((a, b) => b.stockValue - a.stockValue);
    const total = ranked.reduce((sum, item) => sum + item.stockValue, 0);
    let accumulated = 0;
    return ranked.map((item) => {
      const previousShare = total ? accumulated / total : 0;
      accumulated += item.stockValue;
      const cumulativeShare = total ? accumulated / total : 0;
      return {
        ...item,
        cumulativePercent: Number((cumulativeShare * 100).toFixed(1)),
        classification: previousShare < 0.8 ? "A" : previousShare < 0.95 ? "B" : "C",
      };
    });
  }, [inventory]);

  const total = data.reduce((sum, item) => sum + item.stockValue, 0);
  if (!data.length || !total) {
    return <section className="panel abc-panel"><div className="panel-heading"><div><h2>Análise ABC do estoque</h2><p>Distribuição do valor em estoque por componente</p></div></div><EmptyState title="Sem dados para classificar" note="Cadastre componentes com quantidade e custo unitário para ver a curva ABC." /></section>;
  }

  return (
    <section aria-label="Análise ABC do estoque" className="panel abc-panel">
      <div className="panel-heading abc-heading">
        <div><h2>Análise ABC do estoque</h2><p>Valor por componente e participação acumulada no estoque</p></div>
        <div aria-label="Classes ABC" className="abc-legend"><span><i className="abc-a" />A · até 80%</span><span><i className="abc-b" />B · até 95%</span><span><i className="abc-c" />C · restante</span></div>
      </div>
      <div className="abc-chart">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 14, bottom: 32, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis axisLine={false} dataKey="name" interval={data.length > 10 ? Math.ceil(data.length / 10) - 1 : 0} stroke="var(--chart-axis)" tick={{ fontSize: 10 }} tickLine={false} tickFormatter={(name) => { const label = String(name || "Sem nome"); return label.length > 13 ? `${label.slice(0, 12)}…` : label; }} angle={-24} textAnchor="end" />
            <YAxis axisLine={false} stroke="var(--chart-axis)" tick={{ fontSize: 10 }} tickFormatter={(value) => value >= 1000 ? `R$ ${(value / 1000).toFixed(0)}k` : `R$ ${value}`} tickLine={false} width={58} />
            <YAxis axisLine={false} domain={[0, 100]} orientation="right" stroke="var(--chart-axis)" tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}%`} tickLine={false} ticks={[0, 20, 40, 60, 80, 100]} yAxisId="percent" width={42} />
            <Tooltip content={<AbcTooltip />} />
            <ReferenceLine y={80} yAxisId="percent" stroke="#fca311" strokeDasharray="4 4" />
            <ReferenceLine y={95} yAxisId="percent" stroke="#737373" strokeDasharray="4 4" />
            <Bar dataKey="stockValue" name="Valor em estoque" radius={[4, 4, 0, 0]}>
              {data.map((item) => <Cell fill={CLASS_COLORS[item.classification]} key={item.id || item.name} />)}
            </Bar>
            <Line activeDot={{ r: 4 }} dataKey="cumulativePercent" dot={{ r: 2 }} name="Acumulado" stroke="#262626" strokeWidth={2} type="monotone" yAxisId="percent" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
