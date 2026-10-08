import { useCallback, useEffect, useMemo, useState } from "react";
import { useSavedState } from "./hooks.js";
import { keepWithinRetention } from "./retention.js";
import { SLA_BY_PRIORITY, today } from "./utils.js";
import { hasSupabaseSession, restRpc, restSelect, restUpdate, supabaseEnabled, supabaseGetUser, supabaseSignIn, supabaseSignOut, supabaseSignUp, supabaseUpdatePassword, supabaseSendPasswordReset, writeAuditEvent } from "./supabaseApi.js";

/* =====================================================================
   Backend local multi-empresa (baseado em localStorage).
   - Cada empresa tem: cadastro (CNPJ validado), usuário admin/dono,
     equipe e dados próprios (chamados, estoque, despesas, notas).
   - Funcionários entram pelo e-mail corporativo + senha.
   - Sessão expira após 12 h; senhas usam PBKDF2 (WebCrypto) com salt
     aleatório por usuário; logins entre abas ficam sincronizados.
   ===================================================================== */

const ORGS_KEY = "tigest-orgs-v1";
const SESSION_KEY = "tigest-session-v2";
const EVENTS_KEY = "tigest-events-v1";
const LOGS_KEY = "tigest-logs-v1";
const persistOrganizations = (items) => items.map((item) => /^[0-9a-f-]{36}$/i.test(item.id)
  ? { id: item.id, company: { name: item.company?.name || "Empresa" }, people: [], tickets: [], clients: [], inventory: [], services: [], expenses: [], invoices: [], movementLog: [], suppliers: [], budgets: [], replyTemplates: [] }
  : item);

/* Sessão expira após 12 horas. */
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/* Bloqueio de força bruta: 5 tentativas → 30 s de espera. */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_COOLDOWN_MS = 30 * 1000;

/* Níveis de prioridade válidos (a média foi retirada do fluxo). */
export const PRIORITY_LEVELS = ["Baixa", "Alta", "Urgente"];

/* --------------------- classificação automática de prioridade ---------------------
   Regra determinística por categoria + palavras-chave do chamado.
   A equipe de TI pode ajustar manualmente depois (override registrado). */
const URGENT_HINTS = ["servidor", "indisponível", "indisponivel", "fora do ar", "não liga", "nao liga", "perda de dados", "sem internet", "criptografado", "ransomware", "invasão", "invasao", "roubo", "urgente", "parado", "sem acesso", "bloqueado", "caiu"];
const HIGH_HINTS = ["não conecta", "nao conecta", "wi-fi", "wifi", "rede", "impressora", "monitor", "teclado", "mouse", "notebook", "computador", "lento", "travando", "quebrado", "queimado", "sem imagem", "não abre", "nao abre", "erro", "falha", "vírus", "virus", "não imprime", "nao imprime"];
const LOW_HINTS = ["atualização", "atualizacao", "instalar", "instalação", "instalacao", "dúvida", "duvida", "melhoria", "sugestão", "sugestao", "agendar", "quando puder", "rotina", "backup", "limpeza", "consulta", "pesquisa"];

export function classifyTicketPriority(_category, text = "") {
  const haystack = String(text || "").toLowerCase();
  if (URGENT_HINTS.some((hint) => haystack.includes(hint))) return "Urgente";
  if (HIGH_HINTS.some((hint) => haystack.includes(hint))) return "Alta";
  if (LOW_HINTS.some((hint) => haystack.includes(hint))) return "Baixa";
  return "Alta";
}

/* --------------------------- hash de senha (PBKDF2) ---------------------------
   O hash antigo (djb2 com salt fixo) era reversível na prática. Agora:
   PBKDF2-SHA256, 210 mil iterações, salt aleatório de 16 bytes por usuário.
   Formato guardado: pbkdf2$<iterações>$<salt-base64>$<hash-base64>. */
const PBKDF2_ITERATIONS = 210000;

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ iterations: PBKDF2_ITERATIONS, name: "PBKDF2", salt }, key, 256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(bits)}`;
}

/* Confere a senha contra o formato novo; aceita o legado djb2 apenas para
   migrar contas antigas na próxima gravação (ver migratePeople). */
export async function verifyPassword(password, stored) {
  const value = String(stored || "");
  if (value.startsWith("pbkdf2$")) {
    if (!globalThis.crypto?.subtle) throw new Error("A validação de senha criptografada requer uma conexão segura (HTTPS ou localhost).");
    const [, iterations, saltB64, hashB64] = value.split("$");
    try {
      const salt = Uint8Array.from(atob(saltB64), (char) => char.charCodeAt(0));
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ iterations: Number(iterations), name: "PBKDF2", salt }, key, 256);
      return toBase64(bits) === hashB64;
    } catch {
      return false;
    }
  }
  /* Legado: mesmo djb2 das versões anteriores (salt fixo "tigest::"). */
  let hash = 5381;
  const salted = `tigest::${password}`;
  for (let index = 0; index < salted.length; index += 1) {
    hash = ((hash << 5) + hash + salted.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36) === value;
}

/* ===================== livro fiscal (anti caixa 2) ===================== */

function hashString(text) {
  let forward = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    forward ^= text.charCodeAt(index);
    forward = Math.imul(forward, 0x01000193) >>> 0;
  }
  let backward = 0x1b873593;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    backward = (backward ^ text.charCodeAt(index)) >>> 0;
    backward = Math.imul(backward, 0x85ebca6b) >>> 0;
    backward = ((backward << 13) | (backward >>> 19)) >>> 0;
  }
  return forward.toString(16).padStart(8, "0") + backward.toString(16).padStart(8, "0");
}

function invoiceFingerprint(invoice, includeTicketLink = false) {
  return JSON.stringify({
    id: invoice.id, number: invoice.number, series: invoice.series, createdAt: invoice.createdAt,
    ...(invoice.dueDate ? { dueDate: invoice.dueDate } : {}),
    ...(includeTicketLink && invoice.ticketId ? { ticketId: invoice.ticketId } : {}),
    issuer: invoice.issuer, status: invoice.status,
    customer: invoice.customer, description: invoice.description || "", items: invoice.items,
    subtotal: invoice.subtotal, issRate: invoice.issRate, issValue: invoice.issValue,
    shipping: invoice.shipping, discount: invoice.discount, total: invoice.total,
  });
}

export function sealInvoice(invoice, previousSealed) {
  const previousHash = previousSealed?.seal?.hash || "GENESIS";
  const ticketLinkIncluded = Boolean(invoice.ticketId);
  return {
    hash: hashString(`${previousHash}|${invoiceFingerprint(invoice, ticketLinkIncluded)}`),
    previousHash,
    ticketLinkIncluded,
    sealedAt: new Date().toISOString(),
  };
}

/* Confere a cadeia inteira em ordem cronológica. */
export function verifyLedger(invoices) {
  const ordered = [...(invoices || [])].sort((a, b) => `${a.createdAt}#${a.id}`.localeCompare(`${b.createdAt}#${b.id}`));
  const problems = [];
  let previousHash = "GENESIS";
  for (const invoice of ordered) {
    if (!invoice.seal) {
      problems.push(invoice.id);
      continue;
    }
    const expected = hashString(`${previousHash}|${invoiceFingerprint(invoice, invoice.seal.ticketLinkIncluded === true)}`);
    if (invoice.seal.previousHash !== previousHash || invoice.seal.hash !== expected) problems.push(invoice.id);
    previousHash = invoice.seal.hash;
  }
  const bySeries = new Map();
  for (const invoice of ordered.filter((item) => item.status === "Emitida" && /^\d+$/.test(String(item.number || "")))) {
    const series = String(invoice.series || "—");
    bySeries.set(series, [...(bySeries.get(series) || []), Number(invoice.number)]);
  }
  const sequenceGaps = [];
  for (const [series, numbers] of bySeries) {
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    for (let number = unique[0] || 0; number < unique.at(-1); number += 1) {
      if (!unique.includes(number + 1)) sequenceGaps.push(`${series}: ${String(number + 1).padStart(4, "0")}`);
    }
  }
  return { valid: problems.length === 0 && ordered.length > 0, problems, count: ordered.length, sequenceGaps };
}

/* --------------------------- máscaras e validações --------------------------- */

export function maskDocument(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function validateCnpj(cnpj) {
  const digits = String(cnpj || "").replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (slice) => {
    let sum = 0;
    let weight = slice.length - 7;
    for (let index = 0; index < slice.length; index += 1) {
      sum += Number(slice[index]) * weight;
      weight = weight - 1 < 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(digits.slice(0, 12)) === Number(digits[12]) && calc(digits.slice(0, 13)) === Number(digits[13]);
}

export function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function maskCep(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/* Valida e-mail real (qualquer domínio) — antes o cadastro de nota exigia
   @gmail.com, contradizendo o fluxo de "e-mail corporativo". */
export function validateEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9._%+-]{0,62})?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z]{2,})+$/.test(email) && !email.includes("..");
}

/* Mantida para compatibilidade: alias da validação geral. */
export const validateGmail = validateEmail;

/* Validação local de CPF pelos dígitos verificadores (não consulta serviços externos). */
export function validateCpf(cpf) {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  const checkDigit = (slice) => {
    let sum = 0;
    for (let index = 0; index < slice.length; index += 1) {
      sum += Number(slice[index]) * (slice.length + 1 - index);
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return checkDigit(digits.slice(0, 9)) === Number(digits[9]) && checkDigit(digits.slice(0, 10)) === Number(digits[10]);
}

/* Valida celular brasileiro: DDD (2 dígitos, 11–99) + 9 dígitos iniciando em 9. */
export function validateCellphone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return false;
  const ddd = Number(digits.slice(0, 2));
  return ddd >= 11 && ddd <= 99 && digits[2] === "9";
}

/* Consulta o endereço de um CEP com fallback entre provedores públicos.
   Única implementação no app (antes havia duas com ordens trocadas). */
export async function lookupCep(cep) {
  const digits = String(cep || "").replace(/\D/g, "");
  if (digits.length !== 8) throw new Error("Informe os 8 dígitos do CEP.");
  const providers = [
    {
      url: `https://brasilapi.com.br/api/cep/v1/${digits}`,
      parse: (data) => ({ cep: data.cep, street: data.street, neighborhood: data.neighborhood, city: data.city, state: data.state }),
    },
    {
      url: `https://viacep.com.br/ws/${digits}/json/`,
      parse: (data) => (data.erro ? null : {
        cep: data.cep, street: data.logradouro, neighborhood: data.bairro, city: data.localidade, state: data.uf,
      }),
    },
  ];
  for (const provider of providers) {
    try {
      const response = await fetch(provider.url);
      if (!response.ok) continue;
      const data = await response.json();
      const address = provider.parse(data);
      if (address && address.city) return address;
    } catch {
      // Falhou neste provedor: tenta o próximo.
    }
  }
  throw new Error("CEP não encontrado. Confira o número e tente novamente.");
}

/* ------------------------------- logs do sistema ------------------------------- */

export function readLogs() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(LOGS_KEY) ?? "[]");
    const retained = keepWithinRetention(stored);
    if (retained.length !== stored.length) window.localStorage.setItem(LOGS_KEY, JSON.stringify(retained));
    return retained;
  } catch {
    return [];
  }
}

export function writeLogs(logs) {
  try {
    window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(0, 300)));
  } catch {
    // Registro de auditoria é best-effort.
  }
}

export function logEvent(orgId, actor, action, details = "", level = "info") {
  const entry = {
    id: `LOG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    orgId, actor, action, details, level,
    date: new Date().toISOString(),
  };
  writeLogs([entry, ...readLogs()]);
  pushEvent(orgId, details ? `${action}: ${details}` : action);
  if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(String(orgId))) {
    try {
      const activeSession = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
      if (activeSession?.orgId === orgId && activeSession.backend === "supabase" && /^[0-9a-f-]{36}$/i.test(activeSession.userId || "")) {
        const actionKey = String(action).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 100);
        void writeAuditEvent(orgId, activeSession.userId, `app.${actionKey}`, "activity", entry.id, { level });
      }
    } catch { /* local audit remains available if remote telemetry is offline */ }
  }
  return entry;
}

/* ------------------------------ migração de dados ------------------------------ */

function migratePeople(people) {
  return (Array.isArray(people) ? people : []).filter((person) => person && typeof person === "object");
}

/* Migração leve: garante services/history em organizações criadas
   antes desta versão, sem descartar os dados salvos. */
function migrateOrg(org) {
  if (!org) return org;
  const draft = { ...org };
  if (!Array.isArray(draft.services)) {
    draft.services = [
      { id: "SV-001", name: "Formatação completa com backup", category: "Software", price: 180, active: true, description: "Backup dos dados, instalação do sistema e drivers atualizados." },
      { id: "SV-002", name: "Troca de peça (mão de obra)", category: "Hardware", price: 90, active: true, description: "Instalação de componente novo com teste de funcionamento." },
      { id: "SV-003", name: "Configuração de rede e Wi-Fi", category: "Rede", price: 120, active: true, description: "Configuração de roteador, repetidores e dispositivos." },
      { id: "SV-004", name: "Remoção de vírus e otimização", category: "Software", price: 75, active: true, description: "Limpeza de malware e ajuste de desempenho do sistema." },
      { id: "SV-005", name: "Manutenção preventiva", category: "Hardware", price: 60, active: true, description: "Limpeza interna, troca de pasta térmica e revisão geral." },
    ];
  }
  if (!Array.isArray(draft.tickets)) draft.tickets = [];
  if (!Array.isArray(draft.invoices)) draft.invoices = [];
  if (!Array.isArray(draft.clients)) draft.clients = [];
  if (!Array.isArray(draft.inventory)) draft.inventory = [];
  if (!Array.isArray(draft.expenses)) draft.expenses = [];
  if (!Array.isArray(draft.people)) draft.people = [];
  draft.tickets = draft.tickets.filter((ticket) => ticket && typeof ticket === "object").map((ticket) => {
    const created = new Date(ticket.createdAt || Date.now());
    const createdAt = Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();
    const legacyPriority = ticket.priority === "Média"
      ? classifyTicketPriority(ticket.category, `${ticket.title || ""} ${ticket.description || ""}`)
      : ticket.priority || classifyTicketPriority(ticket.category, `${ticket.title || ""} ${ticket.description || ""}`);
    const status = ticket.status === "Em atendimento" ? "Em processamento" : ticket.status || "Aberto";
    const safeHistory = Array.isArray(ticket.history) && ticket.history.length
      ? ticket.history.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry, status: entry.status === "Em atendimento" ? "Em processamento" : entry.status || status }))
      : [{ status, person: ticket.assignee && ticket.assignee !== "—" ? ticket.assignee : ticket.requester || "Sistema", date: createdAt, note: "" }];
    const slaHours = Number(ticket.slaHours) || (SLA_BY_PRIORITY[legacyPriority] || 40);
    const due = new Date(ticket.dueAt || new Date(created.getTime() + slaHours * 3600000));
    return ({
    ...ticket,
    /* "Em atendimento" foi renomeado para "Em processamento" nesta versão. */
    status,
    createdAt,
    dueAt: Number.isNaN(due.getTime()) ? new Date(new Date(createdAt).getTime() + slaHours * 3600000).toISOString() : due.toISOString(),
    slaHours,
    resolvedAt: ticket.resolvedAt || (status === "Resolvido" ? safeHistory.at(-1)?.date || createdAt : null),
    comments: Array.isArray(ticket.comments) ? ticket.comments.filter(Boolean) : [],
    attachments: Array.isArray(ticket.attachments) ? ticket.attachments.filter((entry) => entry && typeof entry === "object") : [],
    invoiceIds: Array.isArray(ticket.invoiceIds) ? ticket.invoiceIds : [],
    history: safeHistory,
    serviceIds: Array.isArray(ticket.serviceIds) ? ticket.serviceIds : [],
    servicePrices: ticket.servicePrices && typeof ticket.servicePrices === "object" ? ticket.servicePrices : {},
    priority: legacyPriority,
    prioritySource: ticket.prioritySource || "auto",
    priorityBy: ticket.priorityBy || "Sistema (classificação automática)",
  });
  });
  draft.invoices = draft.invoices.filter((invoice) => invoice && typeof invoice === "object").map((invoice) => ({ ...invoice, customer: invoice.customer && typeof invoice.customer === "object" ? invoice.customer : {} }));
  draft.inventory = (Array.isArray(draft.inventory) ? draft.inventory : []).filter((item) => item && typeof item === "object").map(({ location: _location, ...rest }) => rest);
  draft.expenses = draft.expenses.filter((expense) => expense && typeof expense === "object");
  draft.people = migratePeople(draft.people).map((person) => ({ ...person, capabilities: person.capabilities && typeof person.capabilities === "object" ? person.capabilities : {}, available: person.available ?? person.role === "TI" }));
  draft.clients = draft.clients.filter((client) => client && typeof client === "object");
  if (!draft.company || typeof draft.company !== "object") draft.company = {};
  draft.company = { name: "Minha empresa", document: "", email: "", phone: "", address: "", department: "Tecnologia da Informação", ...draft.company };
  for (const key of ["tickets", "clients", "inventory", "services", "expenses", "invoices", "movementLog", "suppliers", "budgets", "replyTemplates"]) {
    draft[key] = keepWithinRetention(draft[key]);
  }
  if (!Array.isArray(draft.movementLog)) draft.movementLog = [];
  if (!Array.isArray(draft.suppliers)) draft.suppliers = [];
  if (!Array.isArray(draft.budgets)) draft.budgets = [];
  if (!Array.isArray(draft.replyTemplates)) draft.replyTemplates = [];
  return draft;
}

/* ------------------------------ eventos ------------------------------ */

function pushEvent(orgId, message) {
  try {
    const events = JSON.parse(window.localStorage.getItem(EVENTS_KEY) ?? "[]");
    events.unshift({ id: `EV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, orgId, message, date: new Date().toISOString() });
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(0, 30)));
  } catch {
    // Registro de auditoria é best-effort.
  }
}

/* ------------------------------- seed ------------------------------- */

/* Sementes em hash legado; na primeira verificação de senha a conta é
   atualizada para PBKDF2 (ver login). */
function seedOrg() {
  const legacyHash = (password) => {
    let hash = 5381;
    const salted = `tigest::${password}`;
    for (let index = 0; index < salted.length; index += 1) {
      hash = ((hash << 5) + hash + salted.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
  };
  const historyFrom = (isoDate, offsetMinutes) => new Date(new Date(isoDate).getTime() + offsetMinutes * 60000).toISOString();
  const buildHistory = (isoDate, entries) => entries.map(([status, person, offset]) => ({ status, person, date: historyFrom(isoDate, offset), note: "" }));
  const demoTickets = [
    { id: "CH-1042", title: "Notebook não conecta ao Wi-Fi", description: "Desconecta após alguns minutos de uso.", category: "Rede", priority: "Alta", prioritySource: "auto", priorityBy: "Sistema (classificação automática)", status: "Em processamento", requester: "Ana Souza", assignee: "Rafael Lima", createdAt: today(), history: buildHistory(today(), [["Aberto", "Ana Souza", 0], ["Em processamento", "Rafael Lima", 32]]), serviceIds: [] },
    { id: "CH-1041", title: "Instalar atualização do sistema", description: "Atualização necessária para o software financeiro.", category: "Software", priority: "Baixa", prioritySource: "auto", priorityBy: "Sistema (classificação automática)", status: "Aberto", requester: "Pedro Alves", assignee: "—", createdAt: today(), history: buildHistory(today(), [["Aberto", "Pedro Alves", 0]]), serviceIds: [] },
    { id: "CH-1039", title: "Monitor da sala 3 sem imagem", description: "O monitor acende, mas não exibe imagem.", category: "Hardware", priority: "Baixa", prioritySource: "manual", priorityBy: "Rafael Lima (TI)", status: "Resolvido", requester: "Carla Mendes", assignee: "Rafael Lima", createdAt: today(), history: [...buildHistory(today(), [["Aberto", "Carla Mendes", 0], ["Em processamento", "Rafael Lima", 15], ["Resolvido", "Rafael Lima", 95]])], serviceIds: [] },
  ];
  const demoInventory = [
    { id: "INV-001", name: "SSD Kingston 480 GB", category: "Armazenamento", sku: "SSD-KNG-480", quantity: 8, minimum: 4, unitCost: 289.9 },
    { id: "INV-002", name: "HD Seagate 2 TB", category: "Armazenamento", sku: "HD-ST2000", quantity: 3, minimum: 3, unitCost: 419.9 },
    { id: "INV-003", name: "Memória DDR4 8 GB", category: "Memória", sku: "RAM-DDR4-8", quantity: 12, minimum: 5, unitCost: 119.9 },
    { id: "INV-004", name: "Fonte ATX 500 W", category: "Energia", sku: "PSU-ATX-500", quantity: 2, minimum: 3, unitCost: 239.9 },
    { id: "INV-005", name: "Cabo de rede Cat6 · 2 m", category: "Acessórios", sku: "NET-CAT6-2M", quantity: 16, minimum: 8, unitCost: 18.5 },
  ];
  const demoExpenses = [
    { id: "PC-028", title: "Licença de suporte remoto", category: "Software", amount: 189.9, requester: "Rafael Lima", date: today(), status: "Pendente", notes: "Renovação mensal da ferramenta de suporte." },
    { id: "PC-027", title: "Adaptadores USB-C", category: "Hardware", amount: 156, requester: "Mariana Costa", date: today(), status: "Aprovada", notes: "Reposição para a equipe de atendimento." },
    { id: "PC-026", title: "Cabo HDMI 2 m", category: "Acessórios", amount: 42.5, requester: "Rafael Lima", date: today(), status: "Aprovada", notes: "Uso na sala de reunião." },
  ];
  const demoServices = [
    { id: "SV-001", name: "Formatação completa com backup", category: "Software", price: 180, active: true, description: "Backup dos dados, instalação do sistema e drivers atualizados." },
    { id: "SV-002", name: "Troca de peça (mão de obra)", category: "Hardware", price: 90, active: true, description: "Instalação de componente novo com teste de funcionamento." },
    { id: "SV-003", name: "Configuração de rede e Wi-Fi", category: "Rede", price: 120, active: true, description: "Configuração de roteador, repetidores e dispositivos." },
    { id: "SV-004", name: "Remoção de vírus e otimização", category: "Software", price: 75, active: true, description: "Limpeza de malware e ajuste de desempenho do sistema." },
    { id: "SV-005", name: "Manutenção preventiva", category: "Hardware", price: 60, active: true, description: "Limpeza interna, troca de pasta térmica e revisão geral." },
  ];
  const demoPeople = [
    { id: "U-001", name: "Mariana Costa", email: "mariana@acme.com.br", role: "Dono da empresa", login: "mariana@acme.com.br", passwordHash: legacyHash("acme123") },
    { id: "U-002", name: "Rafael Lima", email: "rafael@acme.com.br", role: "TI", login: "rafael@acme.com.br", passwordHash: legacyHash("acme123") },
    { id: "U-003", name: "Juliana Rocha", email: "juliana@acme.com.br", role: "Gerência", login: "juliana@acme.com.br", passwordHash: legacyHash("acme123") },
    { id: "U-004", name: "Ana Souza", email: "ana@acme.com.br", role: "Supervisor", login: "ana@acme.com.br", passwordHash: legacyHash("acme123") },
    { id: "U-005", name: "Pedro Alves", email: "pedro@acme.com.br", role: "Funcionário", login: "pedro@acme.com.br", passwordHash: legacyHash("acme123") },
  ];
  return {
    id: "ORG-001",
    company: {
      /* CNPJ demo com dígitos verificadores válidos (rejeitado antes pela validação). */
      name: "Acme Tecnologia", document: "11.444.777/0001-61", email: "contato@acme.com.br",
      phone: "(11) 3456-7890", address: "Av. Paulista, 1000 · São Paulo, SP", department: "Tecnologia da Informação",
    },
    admin: { name: "Mariana Costa", email: "mariana@acme.com.br", passwordHash: legacyHash("acme123"), role: "Dono da empresa" },
    people: demoPeople,
    tickets: demoTickets,
    inventory: demoInventory,
    services: demoServices,
    expenses: demoExpenses,
    invoices: [],
    movementLog: [],
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------- store ------------------------------- */

export function useStore() {
  const [orgs, setOrgs] = useSavedState(ORGS_KEY, [], persistOrganizations);
  const [savedSession, setSession] = useSavedState(SESSION_KEY, null);
  const [seeded, setSeeded] = useState(false);

  /* Sessão expira: se passou do prazo máximo, o login é invalidado. */
  const session = useMemo(() => {
    if (!savedSession) return null;
    if (savedSession.backend === "supabase" && !hasSupabaseSession()) return null;
    return savedSession;
  }, [savedSession]);

  useEffect(() => {
    if (!savedSession) return undefined;
    const createdAt = Date.parse(savedSession.at || "");
    const expiresIn = Number.isFinite(createdAt) ? createdAt + SESSION_MAX_AGE_MS - Date.now() : 0;
    const timer = window.setTimeout(() => setSession(null), Math.max(0, expiresIn));
    return () => window.clearTimeout(timer);
  }, [savedSession, setSession]);

  /* A organização ativa é memoizada: antes migrateOrg rodava a cada render,
     recriando objetos e invalidando memoizações a jusante. */
  const org = useMemo(() => {
    const foundOrg = session ? orgs.find((item) => item.id === session.orgId) || null : null;
    return foundOrg ? migrateOrg(foundOrg) : null;
  }, [orgs, session]);

  const currentPerson = useMemo(() => org && session
    ? org.people.find((person) => person.email === session.email) || { id: "U-000", name: session.name, email: session.email, role: session.role }
    : null, [org, session]);

  useEffect(() => {
    try {
      const events = JSON.parse(window.localStorage.getItem(EVENTS_KEY) || "[]");
      const retainedEvents = keepWithinRetention(events);
      if (retainedEvents.length !== events.length) window.localStorage.setItem(EVENTS_KEY, JSON.stringify(retainedEvents));
    } catch { /* mantém o restante do workspace mesmo se o log local estiver corrompido */ }
    readLogs();
    if (!orgs.length) {
      setOrgs([seedOrg()]);
      pushEvent("ORG-001", "Empresa demonstrativa Acme Tecnologia provisionada");
    } else {
      setOrgs((current) => current.map(migrateOrg));
    }
    const readyTimer = window.setTimeout(() => setSeeded(true), 0);
    // Executa apenas na montagem: garante a existência da empresa demo.
    return () => window.clearTimeout(readyTimer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sincronia entre abas: mudanças salvas em outra aba recarregam o estado
     (antes, duas abas sobrescreviam os dados da última gravação vencer). */
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === ORGS_KEY || event.key === SESSION_KEY) window.location.reload();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const updateOrg = useCallback((orgId, updater) => {
    setOrgs((current) => current.map((candidate) => {
      if (candidate.id !== orgId) return candidate;
      const draft = typeof updater === "function" ? updater(candidate) : { ...candidate, ...updater };
      return draft;
    }));
  }, [setOrgs]);

  const login = useCallback(async (email, password, useCurrentSession = false) => {
    /* Bloqueio simples de força bruta. */
    try {
      const attempt = JSON.parse(window.localStorage.getItem("tigest-login-attempts") ?? "null");
      if (attempt?.until && Date.now() < attempt.until) {
        const seconds = Math.ceil((attempt.until - Date.now()) / 1000);
        return { ok: false, error: `Muitas tentativas. Aguarde ${seconds} s e tente novamente.` };
      }
    } catch {
      // Sem registro de tentativas: segue o fluxo.
    }

    const normalized = String(email).trim().toLowerCase();
    let authenticated = null;
    let remoteError = "";
    for (const candidate of orgs.filter((item) => !/^[0-9a-f-]{36}$/i.test(item.id))) {
      const person = candidate.people.find((item) => String(item.login || item.email).toLowerCase() === normalized);
      if (person && await verifyPassword(password, person.passwordHash)) {
        authenticated = { candidate, person };
        break;
      }
    }

    if (!authenticated && supabaseEnabled) {
      try {
        if (useCurrentSession) {
          if (!hasSupabaseSession()) throw new Error("O acesso expirou. Peça ao administrador um novo código de primeiro acesso.");
        } else await supabaseSignIn(String(email).trim().toLowerCase(), password);
        const user = await supabaseGetUser();
        const firstLoginCompanyId = await restRpc("activate_employee_first_login", {});
        let memberships = await restSelect("memberships", `user_id=eq.${user.id}`);
        let membership = (firstLoginCompanyId && memberships.find((item) => item.company_id === firstLoginCompanyId)) || memberships[0];
        if (!membership) {
          const pendingKey = `tigest-pending-company-${String(email).trim().toLowerCase()}`;
          let pending = null;
          try { pending = JSON.parse(window.localStorage.getItem(pendingKey) || "null"); } catch { pending = null; }
          if (!pending) return { ok: false, error: "Seu acesso Supabase ainda não está vinculado a uma empresa GesTI." };
          const companyId = await restRpc("bootstrap_company", { p_name: pending.name, p_display_name: pending.adminName });
          await restUpdate("companies", `id=eq.${companyId}`, { profile_data: pending, branding: { primaryColor: pending.primaryColor || "#2c666e", logoUrl: pending.logoUrl || "" } });
          memberships = await restSelect("memberships", `user_id=eq.${user.id}`);
          membership = memberships?.[0];
          window.localStorage.removeItem(pendingKey);
        }
        if (!membership) return { ok: false, error: "Nenhuma empresa foi vinculada à sua conta." };
        const [remoteCompany] = await restSelect("companies", `id=eq.${membership.company_id}`);
        if (!remoteCompany) return { ok: false, error: "Não foi possível carregar os dados da empresa." };
        const existing = orgs.find((item) => item.id === remoteCompany.id);
        const remoteOrg = existing || {
          id: remoteCompany.id,
          company: { name: remoteCompany.name, ...(remoteCompany.profile_data || {}), ...(remoteCompany.branding || {}) },
          admin: { name: membership.display_name, email: user.email, role: membership.role },
          people: [{ id: user.id, name: membership.display_name, email: user.email, role: membership.role, capabilities: membership.capabilities || {}, available: false }],
          tickets: [], inventory: [], services: [], expenses: [], invoices: [], movementLog: [], suppliers: [], budgets: [], replyTemplates: [],
          createdAt: remoteCompany.created_at,
        };
        setOrgs((current) => existing ? current.map((item) => item.id === remoteCompany.id ? {
          ...item,
          company: { ...item.company, name: remoteCompany.name, ...(remoteCompany.profile_data || {}), ...(remoteCompany.branding || {}) },
          people: item.people.some((person) => person.id === user.id)
            ? item.people.map((person) => person.id === user.id ? { ...person, name: membership.display_name, role: membership.role, capabilities: membership.capabilities || {} } : person)
            : [...item.people, { id: user.id, name: membership.display_name, email: user.email, role: membership.role, capabilities: membership.capabilities || {} }],
        } : item) : [...current, remoteOrg]);
        if (firstLoginCompanyId) void writeAuditEvent(firstLoginCompanyId, user.id, "membership.first_login_activated", "membership", user.id, { role: membership.role });
        setSession({ orgId: remoteCompany.id, email: user.email, name: membership.display_name, role: membership.role, userId: user.id, requiresPasswordSetup: membership.password_setup_required === true, at: new Date().toISOString(), backend: "supabase" });
        pushEvent(remoteCompany.id, `${membership.display_name} entrou no GesTI via Supabase`);
        return { ok: true, person: { name: membership.display_name }, company: remoteCompany.name };
      } catch (error) {
        remoteError = error?.message || "Não foi possível acessar o Supabase. Tente novamente.";
      }
    }

    if (!authenticated) {
      try {
        const attempt = JSON.parse(window.localStorage.getItem("tigest-login-attempts") ?? "null") || { count: 0 };
        attempt.count = (attempt.count || 0) + 1;
        if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
          attempt.until = Date.now() + LOGIN_COOLDOWN_MS;
          attempt.count = 0;
        }
        window.localStorage.setItem("tigest-login-attempts", JSON.stringify(attempt));
      } catch {
        // Best-effort.
      }
      return { ok: false, error: remoteError || "E-mail ou senha inválidos. Verifique com o administrador da sua empresa." };
    }

    try {
      window.localStorage.removeItem("tigest-login-attempts");
    } catch {
      // Best-effort.
    }

    const { candidate, person } = authenticated;

    /* Migração transparente: conta com hash legado é re-salva em PBKDF2. */
    if (!String(person.passwordHash || "").startsWith("pbkdf2$") && globalThis.crypto?.subtle) {
      try {
        const upgraded = await hashPassword(password);
        updateOrg(candidate.id, (current) => ({
          ...current,
          people: current.people.map((item) => (item.id === person.id ? { ...item, passwordHash: upgraded } : item)),
        }));
      } catch {
        /* Uma falha ao atualizar o hash não invalida uma senha legada já
           verificada: mantém o acesso e tenta a migração em outro login. */
      }
    }

    setSession({ orgId: candidate.id, email: person.email, name: person.name, role: person.role, ...(hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(person.id) ? { userId: person.id, backend: "supabase" } : {}), at: new Date().toISOString() });
    pushEvent(candidate.id, `${person.name} entrou no workspace`);
    return { ok: true, person, company: candidate.company.name };
  }, [orgs, setOrgs, setSession, updateOrg]);

  const loginWithCurrentSession = useCallback((email) => login(email, "", true), [login]);

  const registerCompany = useCallback(async (data) => {
    const documentDigits = String(data.document).replace(/\D/g, "");
    if (orgs.some((candidate) => String(candidate.company.document).replace(/\D/g, "") === documentDigits)) {
      return { ok: false, error: "Este CNPJ já possui um workspace cadastrado." };
    }
    if (orgs.some((candidate) => candidate.people.some((person) => String(person.email).toLowerCase() === data.adminEmail.toLowerCase()))) {
      return { ok: false, error: "Este e-mail já está em uso em outra empresa." };
    }
    if (supabaseEnabled) {
      const pendingKey = `tigest-pending-company-${String(data.adminEmail).trim().toLowerCase()}`;
      try {
        window.localStorage.setItem(pendingKey, JSON.stringify({ ...data.company, adminName: data.adminName }));
        const remote = await supabaseSignUp(data.adminEmail, data.password, data.adminName);
        if (!remote.access_token) return { ok: false, error: "Conta criada. Confirme seu e-mail e entre para concluir a criação do workspace." };
        const user = await supabaseGetUser();
        const orgId = await restRpc("bootstrap_company", { p_name: data.company.name, p_display_name: data.adminName });
        await restUpdate("companies", `id=eq.${orgId}`, { profile_data: data.company, branding: { primaryColor: data.company.primaryColor || "#2c666e", logoUrl: data.company.logoUrl || "" } });
        const newOrg = {
          id: orgId, company: { ...data.company }, admin: { name: data.adminName, email: data.adminEmail, role: data.adminRole || "Dono da empresa" },
          people: [{ id: user.id, name: data.adminName, email: data.adminEmail, role: data.adminRole || "Dono da empresa", capabilities: {}, available: false }],
          tickets: [], inventory: [], services: [], expenses: [], invoices: [], movementLog: [], suppliers: [], budgets: [], replyTemplates: [], createdAt: new Date().toISOString(),
        };
        setOrgs((current) => [...current, newOrg]);
        window.localStorage.removeItem(pendingKey);
        pushEvent(orgId, `Empresa ${data.company.name} cadastrada no Supabase`);
        return { ok: true, orgId };
      } catch (error) {
        return { ok: false, error: `Cadastro Supabase não concluído: ${error.message}` };
      }
    }
    const orgId = `ORG-${String(orgs.length + 1).padStart(3, "0")}`;
    const adminHash = await hashPassword(data.password);
    const newOrg = {
      id: orgId,
      company: { ...data.company },
      admin: { name: data.adminName, email: data.adminEmail, passwordHash: adminHash, role: data.adminRole || "Admin" },
      people: [
        { id: "U-001", name: data.adminName, email: data.adminEmail, role: data.adminRole || "Admin", login: data.adminEmail, passwordHash: adminHash },
      ],
      tickets: [],
      inventory: [],
      services: [],
      expenses: [],
      invoices: [],
      movementLog: [],
      createdAt: new Date().toISOString(),
    };
    setOrgs((current) => [...current, newOrg]);
    pushEvent(orgId, `Empresa ${data.company.name} cadastrada com sucesso`);
    return { ok: true, orgId };
  }, [orgs, setOrgs]);

  /* Atalhos para os dados da organização ativa */
  const setData = useCallback((updater) => {
    if (!session) return;
    updateOrg(session.orgId, (candidate) => (typeof updater === "function" ? updater(candidate) : { ...candidate, ...updater }));
  }, [session, updateOrg]);

  const setTickets = useCallback((updater) => setData((candidate) => ({ ...candidate, tickets: typeof updater === "function" ? updater(candidate.tickets) : updater })), [setData]);
  const setInventory = useCallback((updater) => setData((candidate) => ({ ...candidate, inventory: typeof updater === "function" ? updater(candidate.inventory) : updater })), [setData]);
  const setExpenses = useCallback((updater) => setData((candidate) => ({ ...candidate, expenses: typeof updater === "function" ? updater(candidate.expenses) : updater })), [setData]);
  const setInvoices = useCallback((updater) => setData((candidate) => ({ ...candidate, invoices: typeof updater === "function" ? updater(candidate.invoices) : updater })), [setData]);
  const setCompanyData = useCallback((updater) => setData((candidate) => ({ ...candidate, company: typeof updater === "function" ? updater(candidate.company) : updater })), [setData]);
  const setPeople = useCallback((updater) => setData((candidate) => ({ ...candidate, people: typeof updater === "function" ? updater(candidate.people) : updater })), [setData]);
  const setServices = useCallback((updater) => setData((candidate) => ({ ...candidate, services: typeof updater === "function" ? updater(candidate.services || []) : updater })), [setData]);

  const logout = useCallback(() => {
    if (session) pushEvent(session.orgId, `${session.name} saiu do workspace`);
    if (hasSupabaseSession()) void supabaseSignOut();
    setSession(null);
  }, [session, setSession]);

  const completeEmployeePasswordSetup = useCallback(async () => {
    if (!session || session.backend !== "supabase" || !hasSupabaseSession()) throw new Error("A sessão expirou. Entre novamente pelo seu e-mail.");
    await restRpc("complete_employee_password_setup", { p_company_id: session.orgId });
    setSession((current) => current ? { ...current, requiresPasswordSetup: false } : current);
  }, [session, setSession]);

  /* Nova pessoa sempre recebe hash PBKDF2 (nunca a senha em claro). */
  const addPersonWithAccess = useCallback(async (person) => {
    if (!session) return;
    const passwordHash = await hashPassword(person.password || "acme123");
    updateOrg(session.orgId, (candidate) => ({
      ...candidate,
      people: [{ ...person, password: undefined, login: person.email, passwordHash }, ...candidate.people],
    }));
    pushEvent(session.orgId, `${person.name} recebeu acesso (${person.role})`);
  }, [session, updateOrg]);

  const removePerson = useCallback((personId) => {
    if (!session) return;
    updateOrg(session.orgId, (candidate) => ({
      ...candidate,
      people: candidate.people.filter((person) => person.id !== personId),
    }));
  }, [session, updateOrg]);

  /* O usuário troca a própria senha (exigindo a atual) — antes não existia. */
  const changeOwnPassword = useCallback(async (currentPassword, newPassword) => {
    if (!session || !currentPerson) return { ok: false, error: "Sessão inválida." };
    if (String(newPassword).length < 8) return { ok: false, error: "A nova senha deve ter pelo menos 8 caracteres." };
    if (session.backend === "supabase") {
      try { await supabaseUpdatePassword(session.email, currentPassword, newPassword); return { ok: true }; }
      catch (error) { return { ok: false, error: error.message || "Não foi possível atualizar a senha no Supabase." }; }
    }
    if (!(await verifyPassword(currentPassword, currentPerson.passwordHash))) {
      return { ok: false, error: "A senha atual não confere." };
    }
    const passwordHash = await hashPassword(newPassword);
    updateOrg(session.orgId, (candidate) => ({
      ...candidate,
      admin: candidate.admin?.email === currentPerson.email ? { ...candidate.admin, passwordHash } : candidate.admin,
      people: candidate.people.map((person) => (person.id === currentPerson.id ? { ...person, passwordHash } : person)),
    }));
    return { ok: true };
  }, [currentPerson, session, updateOrg]);

  /* Admin/Dono reseta a senha de alguém para um valor provisório. */
  const resetPersonPassword = useCallback(async (personId, newPassword) => {
    if (!session) return { ok: false, error: "Sessão inválida." };
    if (session.backend === "supabase") {
      const person = org?.people.find((item) => item.id === personId);
      if (!person?.email) return { ok: false, error: "O e-mail desta pessoa não está disponível. Peça que ela use a recuperação de senha na tela de acesso." };
      try { await supabaseSendPasswordReset(person.email); return { ok: true, emailed: true }; }
      catch (error) { return { ok: false, error: error.message || "Não foi possível enviar a recuperação." }; }
    }
    if (String(newPassword).length < 8) return { ok: false, error: "A senha deve ter pelo menos 8 caracteres." };
    const passwordHash = await hashPassword(newPassword);
    updateOrg(session.orgId, (candidate) => ({
      ...candidate,
      people: candidate.people.map((person) => (person.id === personId ? { ...person, passwordHash } : person)),
    }));
    return { ok: true };
  }, [session, org, updateOrg]);

  const resetWorkspace = useCallback(() => {
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("tigest-"))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Segue o fluxo sem armazenamento.
    }
    window.location.reload();
  }, []);

  return {
    orgs, org, session, currentPerson, seeded,
    login, loginWithCurrentSession, registerCompany, logout, updateOrg, setData,
    setTickets, setInventory, setExpenses, setInvoices, setCompanyData, setPeople, setServices,
    addPersonWithAccess, removePerson, resetWorkspace, changeOwnPassword, resetPersonPassword, completeEmployeePasswordSetup,
  };
}
