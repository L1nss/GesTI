/* =====================================================================
   Utilitários puros: constantes de domínio, formatação, IDs, rotas e
   exportação de arquivos. Nenhum React aqui — fácil de testar com Vitest.
   ===================================================================== */

/* ------------------------------ navegação ------------------------------ */

export const PAGES = ["Visão geral", "Chamados", "Clientes", "Estoque", "Custos", "Notas fiscais", "Registro", "Logs", "Empresa", "Sobre"];

/* Páginas visíveis por perfil — único ponto de verdade do menu. */
export const ROLE_PAGES = {
  "Funcionário": ["Visão geral", "Chamados", "Sobre"],
  TI: PAGES.filter((page) => !["Custos", "Empresa", "Logs"].includes(page)),
  Supervisor: PAGES.filter((page) => !["Custos", "Empresa", "Logs"].includes(page)),
  "Gerência": PAGES.filter((page) => page !== "Empresa"),
  Admin: PAGES,
  "Dono da empresa": PAGES,
};

export const ROLES = ["Admin", "Dono da empresa", "TI", "Gerência", "Supervisor", "Funcionário"];

/* Capacidades por perfil — substitui os arrays espalhados pelo app. */
export const ROLE_PERMISSIONS = {
  Admin: ["viewCosts", "manageStock", "manageTickets", "claimTickets", "approve", "manageCompany", "managePeople", "manageServices", "clearLogs", "backup", "manageClients"],
  "Dono da empresa": ["viewCosts", "manageStock", "manageTickets", "claimTickets", "approve", "manageCompany", "managePeople", "manageServices", "clearLogs", "backup", "manageClients"],
  TI: ["manageStock", "manageTickets", "claimTickets", "manageServices"],
  "Gerência": ["viewCosts", "manageStock", "manageTickets", "approve", "managePeople", "manageServices", "clearLogs", "manageClients"],
  Supervisor: ["manageStock", "manageTickets", "manageServices"],
  "Funcionário": [],
};

/* SLA em horas por prioridade — antes repetido em vários pontos. */
export const SLA_BY_PRIORITY = { Urgente: 4, Alta: 8, Baixa: 40 };

export const CRITICAL_PRIORITIES = ["Urgente", "Alta"];

export const priorityTone = (priority) => (priority === "Urgente" ? "red" : priority === "Alta" ? "amber" : "neutral");

/* --------------------------------- rotas --------------------------------- */

export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* Roteamento por hash: #/chamados, #/notas-fiscais... */
export const PAGE_BY_SLUG = Object.fromEntries(PAGES.map((page) => [slugify(page), page]));

/* --------------------------------- datas --------------------------------- */

/* Data local (YYYY-MM-DD). Antes usava toISOString (UTC), o que registrava
   o dia errado para quem está no Brasil depois das 21h. */
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const parseDate = (value) => {
  if (!value) return null;
  /* Data-only ("2026-10-02") é interpretada como UTC; o meio-dia evita
     deslocar um dia para trás em fusos negativos. */
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

export function shortDate(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date) : "—";
}

export function longDate(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(date) : "—";
}

/* Data e hora para histórico e logs. Sem argumento usa o momento atual. */
export function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/* ---------------------------------- IDs ---------------------------------- */

export function nextId(prefix, records) {
  const highest = (records || []).reduce((current, record) => Math.max(current, Number(String(record?.id || "").replace(/\D/g, "")) || 0), 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

/* ------------------------- exportação de arquivos ------------------------- */

export function downloadFile(content, filename, type) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(data, filename) {
  downloadFile(JSON.stringify(data, null, 2), `${filename}.json`, "application/json;charset=utf-8");
}

export function csvCell(value) {
  const safe = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : String(value ?? "").replace(/^[\s\uFEFF]*[=+@-]/, (match) => `'${match}`);
  return `"${safe.replaceAll('"', '""')}"`;
}

export function downloadCsv(records, filename, headers, values) {
  if (!Array.isArray(headers) || typeof values !== "function") throw new TypeError("A exportação CSV precisa de cabeçalhos e valores.");
  const rows = [headers, ...records.map(values)];
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  /* BOM para o Excel reconhecer o ponto-e-vírgula e os acentos. */
  downloadFile(`\uFEFF${csv}`, `${filename}.csv`, "text/csv;charset=utf-8");
}
