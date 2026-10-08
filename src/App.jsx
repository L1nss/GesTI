import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SideBar } from "./HtmlFunctions.jsx";
import AuthScreen from "./AuthScreen.jsx";
import LoginWelcome from "./LoginWelcome.jsx";
import PrivacyControls from "./PrivacyControls.jsx";
import AssistantChat from "./AssistantChat.jsx";
import { Button, Field, Icon, Modal, Reveal } from "./shared.jsx";
import { useToast } from "./toast.js";
import { useSavedState, useTheme } from "./hooks.js";
import { logEvent, PRIORITY_LEVELS, readLogs, useStore, writeLogs, classifyTicketPriority } from "./store.js";
import { CRITICAL_PRIORITIES, downloadCsv, downloadJson, money, nextId, PAGES, ROLE_PAGES, ROLE_PERMISSIONS, ROLES, SLA_BY_PRIORITY, PAGE_BY_SLUG, slugify, today } from "./utils.js";
import { captureAppError, hasSupabaseSession, restDelete, restInsert, restRpc, restSelect, restUpdate, supabaseRegisterEmployee, supabaseUpdateCurrentPassword, writeAuditEvent } from "./supabaseApi.js";

/* Notas fiscais e Custos carregadas sob demanda: Recharts e o emissor de
   notas respondem pela maior parte do bundle (antes: ~930 kB num chunk só). */
const InvoicePage = lazy(() => import("./InvoicePage.jsx").then((module) => ({ default: module.default })));
const LazyExpensesPage = lazy(async () => {
  const module = await import("./pages/ExpensesPage.jsx");
  return { default: module.ExpensesPage };
});
const LazyOverview = lazy(() => import("./pages/TicketsAndOverview.jsx").then((module) => ({ default: module.Overview })));
const LazyTeamMetrics = lazy(() => import("./pages/TicketsAndOverview.jsx").then((module) => ({ default: module.TeamMetrics })));
const LazyTicketsPage = lazy(() => import("./pages/TicketsAndOverview.jsx").then((module) => ({ default: module.TicketsPage })));
const LazyCustomersPage = lazy(() => import("./pages/InventoryAndMore.jsx").then((module) => ({ default: module.CustomersPage })));
const LazyInventoryPage = lazy(() => import("./pages/InventoryAndMore.jsx").then((module) => ({ default: module.InventoryPage })));
const LazyRegistryPage = lazy(() => import("./pages/InventoryAndMore.jsx").then((module) => ({ default: module.RegistryPage })));
const LazyLogsPage = lazy(() => import("./pages/LogsPage.jsx").then((module) => ({ default: module.LogsPage })));
const LazyCompanyPage = lazy(() => import("./pages/CompanyPage.jsx").then((module) => ({ default: module.CompanyPage })));
const LazyAboutPage = lazy(() => import("./pages/AboutPage.jsx").then((module) => ({ default: module.AboutPage })));
const LazyTeamHub = lazy(() => import("./pages/TeamHub.jsx"));
const EmployeeRegistration = lazy(() => import("./pages/EmployeeRegistration.jsx"));
const FirstLoginPassword = lazy(() => import("./pages/FirstLoginPassword.jsx"));

const currentDateTime = () => new Date().toISOString();
const EMPTY_LIST = [];
const PAGE_CAPABILITIES = { Clientes: ["manageClients"], Estoque: ["manageStock"], Custos: ["viewCosts"], Empresa: ["managePeople", "manageCompany"], Funcionários: ["managePeople"], Logs: ["clearLogs"] };
const createEmployeeAccessCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("");
};
const hashAccessCode = async (code) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/* Roteamento por hash: mantém a página no recarregar (F5) e permite deep link. */
function useHashPage(fallback) {
  const readHash = () => {
    const slug = window.location.hash.replace(/^#\/?/, "");
    return PAGE_BY_SLUG[slug] || fallback;
  };
  const [page, setPage] = useState(readHash);
  useEffect(() => {
    const handleHash = () => setPage(readHash());
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useCallback((nextPage) => {
    window.location.hash = `/${slugify(nextPage)}`;
    setPage(nextPage);
  }, []);
  return [page, navigate];
}

/* ------------------------------ app autenticado ------------------------------ */

function Workspace({ store, theme, toggleTheme }) {
  const reduceMotion = useReducedMotion();
  const notify = useToast();
  const { org, session, currentPerson, setData, setTickets, setInventory, setExpenses, setInvoices, setServices, setCompanyData, logout, addPersonWithAccess, removePerson, resetPersonPassword } = store;

  /* Inicialize permissões antes dos efeitos abaixo: elas são usadas no array
     de dependências e no callback de sincronização remota. */
  const role = currentPerson?.role || session.role;
  const rolePermissions = org.rolePermissions || ROLE_PERMISSIONS;
  const permissions = useMemo(() => {
    const effective = Object.fromEntries((rolePermissions[role] || ROLE_PERMISSIONS[role] || []).map((permission) => [permission, true]));
    return effective;
  }, [role, rolePermissions]);
  const can = useCallback((permission) => permissions[permission] === true, [permissions]);

  const [page, navigateToPage] = useHashPage("Visão geral");
  const [sideOpen, setSideOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [readAlerts, setReadAlerts] = useSavedState(`tigest-alerts-read-v1-${org.id}`, []);
  const [teamMessages, setTeamMessages] = useState([]);
  const seenTeamMessages = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState("");
  const [clientEditing, setClientEditing] = useState(null);
  const [ticketDetail, setTicketDetail] = useState("");
  const [invoiceSignal, setInvoiceSignal] = useState(0);
  const [invoiceFocus, setInvoiceFocus] = useState("");
  const [dashboardMetrics, setDashboardMetrics] = useSavedState(`gesti-dashboard-metrics-v1-${org.id}-${session.userId || session.email}`, ["open", "overdue", "processing"]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [tourStep, setTourStep] = useState(() => org.onboardingComplete ? null : 0);
  const [remoteReady, setRemoteReady] = useState(() => !hasSupabaseSession() || !/^[0-9a-f-]{36}$/i.test(org.id));
  const [remoteError, setRemoteError] = useState("");
  const remoteRecordsRef = useRef({ companyId: "", records: new Map() });
  const remoteWriteQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!remoteReady || !hasSupabaseSession() || !session.userId || !/^[0-9a-f-]{36}$/i.test(org.id)) return;
    let active = true;
    restSelect("member_preferences", `company_id=eq.${org.id}&user_id=eq.${session.userId}`).then((rows) => {
      if (active && Array.isArray(rows) && Array.isArray(rows[0]?.dashboard_metrics)) setDashboardMetrics(rows[0].dashboard_metrics);
    }).catch((error) => { if (active) void captureAppError(error, org.id); });
    return () => { active = false; };
  }, [remoteReady, org.id, session.userId, setDashboardMetrics]);

  useEffect(() => {
    if (!remoteReady || !hasSupabaseSession() || !session.userId || !/^[0-9a-f-]{36}$/i.test(org.id)) return;
    let active = true;
    const refreshTeamMessages = async () => {
      const rows = await restSelect("team_messages", `company_id=eq.${org.id}&recipient_user_id=eq.${session.userId}&read_at=is.null&order=created_at.desc&limit=50`);
      if (!active) return;
      const incoming = new Set(rows.map((item) => item.id));
      if (seenTeamMessages.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        const latest = rows.find((item) => !seenTeamMessages.current.has(item.id));
        if (latest) { try { new Notification("Nova mensagem no GesTI", { body: latest.body.slice(0, 120), tag: `gesti-message-${latest.id}` }); } catch { /* O navegador pode limitar alertas em segundo plano. */ } }
      }
      seenTeamMessages.current = incoming;
      setTeamMessages(rows);
    };
    void refreshTeamMessages().catch((error) => void captureAppError(error, org.id));
    const timer = window.setInterval(() => void refreshTeamMessages().catch((error) => void captureAppError(error, org.id)), 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, [remoteReady, org.id, session.userId]);

  const changeDashboardMetrics = (metrics) => {
    setDashboardMetrics(metrics);
    if (hasSupabaseSession() && session.userId && /^[0-9a-f-]{36}$/i.test(org.id)) void restInsert("member_preferences", { company_id: org.id, user_id: session.userId, dashboard_metrics: metrics }, { upsert: true, onConflict: "company_id,user_id", returnRepresentation: false }).catch((error) => void captureAppError(error, org.id));
  };

  useEffect(() => {
    document.body.classList.toggle("report-printing", modal === "report");
    return () => document.body.classList.remove("report-printing");
  }, [modal]);

  useEffect(() => {
    const onError = (event) => { void captureAppError(event.error || new Error(event.message), org.id); };
    const onRejection = (event) => { void captureAppError(event.reason instanceof Error ? event.reason : new Error("Falha assíncrona não tratada"), org.id); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, [org.id]);

  useEffect(() => {
    if (!hasSupabaseSession() || !session.userId || !/^[0-9a-f-]{36}$/i.test(org.id)) return undefined;
    let active = true;
    const filters = `company_id=eq.${org.id}`;
    Promise.all([
      restSelect("tickets", filters), restSelect("suppliers", filters), restSelect("category_budgets", filters),
      restSelect("reply_templates", filters), restSelect("memberships", filters),
      restSelect("technician_presence", filters), restSelect("onboarding_progress", `${filters}&user_id=eq.${session.userId}`),
      restSelect("workspace_records", filters), restSelect("companies", `id=eq.${org.id}`), restSelect("company_roles", filters),
    ]).then(([remoteTickets, remoteSuppliers, remoteBudgets, remoteReplies, remoteMembers, remotePresence, onboarding, records, companyRows, remoteRoles]) => {
      if (!active) return;
      const presenceByUser = new Map(remotePresence.map((row) => [row.user_id, row]));
      const remotePeople = remoteMembers.map((member) => ({ id: member.user_id, name: member.display_name, email: member.user_id === session.userId ? session.email : "", role: member.role, capabilities: member.capabilities || {}, ...(presenceByUser.has(member.user_id) ? { available: presenceByUser.get(member.user_id).available, maxActiveTickets: presenceByUser.get(member.user_id).max_active_tickets } : { available: member.available === true, maxActiveTickets: member.max_active_tickets || 3 }) }));
      const peopleById = new Map(remotePeople.map((person) => [person.id, person]));
      const mappedTickets = remoteTickets.map((ticket) => {
        const details = ticket.details && typeof ticket.details === "object" ? ticket.details : {};
        const requesterName = peopleById.get(ticket.requester_user_id)?.name || (ticket.requester_user_id === session.userId ? session.name : "Solicitante");
        return {
          id: ticket.id, title: ticket.title, description: ticket.description, category: ticket.category,
          status: ticket.status, priority: ticket.priority, requester: requesterName,
          customerName: details.customerName || requesterName, customerId: details.customerId || null,
          assignee: peopleById.get(ticket.assignee_user_id)?.name || "—",
          assignmentStatus: ({ pending_acceptance: "Pendente de aceite", accepted: "Aceito", declined: "Recusado", unassigned: "Sem técnico disponível" })[ticket.assignment_status] || "Sem técnico disponível",
          dueAt: ticket.due_at, createdAt: ticket.created_at, resolvedAt: ticket.resolved_at,
          satisfaction: ticket.satisfaction_score ? { score: ticket.satisfaction_score, comment: ticket.satisfaction_comment || "" } : null,
          slaHours: Math.max(1, Math.round((Date.parse(ticket.due_at) - Date.parse(ticket.created_at)) / 3600000)),
          serviceIds: Array.isArray(details.serviceIds) ? details.serviceIds : [],
          servicePrices: details.servicePrices && typeof details.servicePrices === "object" ? details.servicePrices : {},
          comments: Array.isArray(details.comments) ? details.comments : [],
          attachments: Array.isArray(details.attachments) ? details.attachments : [],
          invoiceIds: Array.isArray(details.invoiceIds) ? details.invoiceIds : [],
          history: Array.isArray(details.history) && details.history.length ? details.history : [{ status: ticket.status, person: requesterName, date: ticket.created_at, note: "Criado no GesTI." }],
          prioritySource: details.prioritySource || "auto", priorityBy: details.priorityBy || "Sistema",
          firstResponseAt: details.firstResponseAt || null,
        };
      });
      const grouped = new Map(["clients", "inventory", "services", "expenses", "invoices", "movements"].map((type) => [type, []]));
      for (const row of records) grouped.get(row.entity_type)?.push(row.payload);
      remoteRecordsRef.current = { companyId: org.id, records: new Map(records.map((row) => [`${row.entity_type}:${row.entity_id}`, JSON.stringify(row.payload)])) };
      const remoteCompany = companyRows[0];
      if (!remoteCompany || !remoteMembers.some((member) => member.user_id === session.userId)) {
        notify({ tone: "info", title: "Acesso encerrado", message: "Sua associação com esta empresa não está mais ativa." });
        logout();
        return;
      }
      const visibleRemoteRoles = remoteRoles.filter((item) => ROLES.includes(item.name) || !item.is_default || remoteMembers.some((member) => member.role === item.name));
      const remoteRolePermissions = Object.fromEntries(visibleRemoteRoles.map((item) => [item.name, Object.keys(item.capabilities || {}).filter((key) => item.capabilities[key] === true)]));
      setData((current) => ({ ...current, roleCatalog: visibleRemoteRoles.map((item) => ({ name: item.name, isDefault: item.is_default })), rolePermissions: remoteRolePermissions, ...(remoteCompany ? { company: { ...current.company, ...(remoteCompany.profile_data || {}), ...(remoteCompany.branding || {}), name: remoteCompany.name } } : {}), people: remotePeople, tickets: mappedTickets, suppliers: remoteSuppliers.map((row) => ({ id: `FOR-${row.id}`, remoteId: row.id, name: row.name, email: row.email || "", phone: row.phone || "", active: row.active, createdAt: row.created_at })), budgets: remoteBudgets.map((row) => ({ id: row.id, category: row.category, month: row.month, amount: Number(row.limit_amount) })), replyTemplates: remoteReplies.map((row) => ({ id: row.id, remoteId: row.id, title: row.title, body: row.body, active: row.active })), clients: grouped.get("clients"), inventory: grouped.get("inventory"), services: grouped.get("services"), expenses: grouped.get("expenses"), invoices: grouped.get("invoices"), movementLog: grouped.get("movements"), onboardingComplete: Boolean(onboarding[0]?.completed_at) }));
      if (onboarding[0]?.completed_at) setTourStep(null);
      setRemoteReady(true);
    }).catch((error) => { if (active) { setRemoteError(error.message || "Não foi possível carregar os dados da empresa."); void captureAppError(error, org.id); } });
    return () => { active = false; };
  }, [org.id, session.userId, session.email, session.name, setData, logout, notify]);

  useEffect(() => {
    if (!remoteReady || !hasSupabaseSession() || !session.userId || remoteRecordsRef.current.companyId !== org.id) return;
    const writable = {
      clients: permissions.manageClients === true,
      inventory: permissions.manageStock === true,
      services: permissions.manageServices === true,
      expenses: permissions.approve === true && permissions.viewCosts === true,
      movements: permissions.manageStock === true,
    };
    const snapshot = [
      ["clients", org.clients || []], ["inventory", org.inventory || []], ["services", org.services || []],
      ["expenses", org.expenses || []], ["movements", org.movementLog || []],
    ].filter(([type]) => writable[type]).flatMap(([type, items]) => items.filter((item) => item?.id).map((payload) => ({ company_id: org.id, entity_type: type, entity_id: String(payload.id), payload, updated_by: session.userId })));
    const timer = window.setTimeout(() => {
      remoteWriteQueueRef.current = remoteWriteQueueRef.current.catch(() => {}).then(async () => {
        const baseline = remoteRecordsRef.current;
        if (baseline.companyId !== org.id) return;
        const current = new Map(snapshot.map((row) => [`${row.entity_type}:${row.entity_id}`, JSON.stringify(row.payload)]));
        const changed = snapshot.filter((row) => baseline.records.get(`${row.entity_type}:${row.entity_id}`) !== current.get(`${row.entity_type}:${row.entity_id}`));
        const removed = [...baseline.records.keys()].filter((key) => writable[key.split(":", 1)[0]] && !current.has(key));
        if (changed.length) {
          await restInsert("workspace_records", changed, { upsert: true, onConflict: "company_id,entity_type,entity_id", returnRepresentation: false });
          for (const row of changed) baseline.records.set(`${row.entity_type}:${row.entity_id}`, current.get(`${row.entity_type}:${row.entity_id}`));
        }
        for (const key of removed) {
          const divider = key.indexOf(":");
          await restDelete("workspace_records", `company_id=eq.${org.id}&entity_type=eq.${key.slice(0, divider)}&entity_id=eq.${encodeURIComponent(key.slice(divider + 1))}`);
          baseline.records.delete(key);
        }
      }).catch((error) => {
        notify({ tone: "info", title: "Alterações não sincronizadas", message: `${error.message || "Verifique a conexão."} Recarregue para conferir os dados salvos.` });
        void captureAppError(error, org.id);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [remoteReady, org, org.id, session.userId, permissions, notify]);

  const persistWorkspaceRow = async (type, payload) => {
    if (session.backend !== "supabase") return;
    await restInsert("workspace_records", { company_id: org.id, entity_type: type, entity_id: String(payload.id), payload, updated_by: session.userId }, { upsert: true, onConflict: "company_id,entity_type,entity_id", returnRepresentation: false });
    if (remoteRecordsRef.current.companyId === org.id) remoteRecordsRef.current.records.set(`${type}:${payload.id}`, JSON.stringify(payload));
  };

  const company = org.company;
  const people = org.people;
  const tickets = org.tickets || EMPTY_LIST;
  const inventory = org.inventory;
  const expenses = org.expenses;
  const invoices = org.invoices || EMPTY_LIST;
  const services = org.services || EMPTY_LIST;
  const movements = org.movementLog || EMPTY_LIST;
  const clients = useMemo(() => {
    const byName = new Map((Array.isArray(org.clients) ? org.clients : []).filter(Boolean).map((client) => [String(client.name || "").toLowerCase(), { ...client, tickets: [], invoices: [] }]));
    for (const ticket of tickets) {
      const name = String(ticket.customerName || ticket.requester || "").trim();
      if (!name) continue;
      const client = byName.get(name.toLowerCase()) || { name, tickets: [], invoices: [] };
      client.tickets.push(ticket);
      byName.set(name.toLowerCase(), client);
    }
    for (const invoice of invoices) {
      const name = String(invoice.customer?.name || "").trim();
      if (!name) continue;
      const client = byName.get(name.toLowerCase()) || { name, tickets: [], invoices: [] };
      client.invoices.push(invoice);
      byName.set(name.toLowerCase(), client);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [tickets, invoices, org.clients]);

  const visibleTickets = role === "Funcionário" ? tickets.filter((ticket) => ticket.requester === currentPerson.name) : tickets;
  const pendingTickets = visibleTickets.filter((ticket) => ticket.status !== "Resolvido");
  const assignmentAlerts = pendingTickets.filter((ticket) => ticket.assignmentStatus === "Pendente de aceite" && ticket.assignee === currentPerson.name);
  const lowStock = role === "Funcionário" ? [] : inventory.filter((item) => item.quantity <= item.minimum);
  const pendingExpenses = can("viewCosts") ? expenses.filter((expense) => expense.status === "Pendente") : [];
  const approvedTotal = can("viewCosts") ? expenses.filter((expense) => expense.status === "Aprovada").reduce((sum, expense) => sum + Number(expense.amount), 0) : 0;

  const pagesForRole = useMemo(() => PAGES.filter((name) => {
    if (name === "Notas fiscais") return can("viewCosts") || can("claimTickets");
    const baseAccess = (ROLE_PAGES[role] || ["Visão geral", "Chamados", "Equipe", "Sobre"]).includes(name);
    const capabilities = PAGE_CAPABILITIES[name] || [];
    return capabilities.length ? capabilities.some(can) : baseAccess;
  }), [role, can]);
  useEffect(() => {
    if (!pagesForRole.includes(page)) navigateToPage("Visão geral");
  }, [page, pagesForRole, navigateToPage]);
  const overdueTickets = pendingTickets.filter((ticket) => ticket.dueAt && new Date(ticket.dueAt).getTime() < now.getTime());
  /* Chamados a 25% do prazo: alerta antes de estourar. */
  const dueSoonTickets = pendingTickets.filter((ticket) => {
    if (!ticket.dueAt || overdueTickets.includes(ticket)) return false;
    const remaining = new Date(ticket.dueAt).getTime() - now.getTime();
    const total = (ticket.slaHours || 40) * 3600000;
    return remaining > 0 && remaining <= total * 0.25;
  });

  const alerts = [
    ...assignmentAlerts.map((ticket) => ({ id: `assign-${ticket.id}`, target: "Chamados", icon: "ticket", tone: "violet", title: "Chamado aguardando sua aceitação", message: ticket.title })),
    ...overdueTickets.map((ticket) => ({ id: `late-${ticket.id}`, target: "Chamados", icon: "warning", tone: "amber", title: `Chamado ${ticket.id} fora do prazo`, message: ticket.title })),
    ...dueSoonTickets.map((ticket) => ({ id: `soon-${ticket.id}`, target: "Chamados", icon: "clock", tone: "amber", title: `Chamado ${ticket.id} perto do prazo`, message: ticket.title })),
    ...pendingTickets.filter((ticket) => !overdueTickets.includes(ticket) && !dueSoonTickets.includes(ticket)).map((ticket) => ({ id: `t-${ticket.id}`, target: "Chamados", icon: "ticket", tone: CRITICAL_PRIORITIES.includes(ticket.priority) ? "amber" : "blue", title: `Chamado ${ticket.id} · prioridade ${ticket.priority}`, message: ticket.title })),
    ...(role === "Funcionário" ? [] : lowStock.slice(0, 3).map((item) => ({ id: `i-${item.id}`, target: "Estoque", icon: "warning", tone: "amber", title: "Estoque no nível mínimo", message: `${item.name} · ${item.quantity} un. restantes` }))),
    ...pendingExpenses.slice(0, 3).map((expense) => ({ id: `e-${expense.id}`, target: "Custos", icon: "receipt", tone: "violet", title: "Despesa aguardando aprovação", message: `${expense.title} · ${money(expense.amount)}` })),
    ...teamMessages.map((message) => ({ id: `team-${message.id}`, target: "Equipe", icon: "chat", tone: "blue", title: `Mensagem de ${people.find((member) => member.id === message.sender_user_id)?.name || "colega"}`, message: message.body })),
  ];
  const unreadCount = alerts.filter((alert) => !readAlerts.includes(alert.id)).length;
  const badgeCounts = { Chamados: pendingTickets.length, Estoque: lowStock.length, Custos: pendingExpenses.length };

  const filteredTickets = useMemo(() => visibleTickets.filter((ticket) => `${ticket.id} ${ticket.title} ${ticket.requester} ${ticket.customerName || ""} ${ticket.category || ""} ${ticket.assignee || ""} ${ticket.priority} ${ticket.status}`.toLowerCase().includes(query.toLowerCase())), [visibleTickets, query]);
  const filteredInventory = useMemo(() => inventory.filter((item) => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(query.toLowerCase())), [inventory, query]);
  const filteredServices = useMemo(() => services.filter((item) => `${item.name} ${item.category} ${item.description || ""}`.toLowerCase().includes(query.toLowerCase())), [services, query]);
  const filteredInvoices = useMemo(() => invoices.filter((invoice) => `${invoice.number || ""} ${invoice.series || ""} ${invoice.customer?.name || ""} ${invoice.customer?.document || ""} ${invoice.status || ""}`.toLowerCase().includes(query.toLowerCase())), [invoices, query]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const enterSidebar = () => {
    if (window.innerWidth >= 1024) setSideOpen(true);
  };
  const leaveSidebar = () => {
    if (window.innerWidth >= 1024) setSideOpen(false);
  };

  const navigate = (nextPage) => {
    if (!pagesForRole.includes(nextPage)) return;
    navigateToPage(nextPage);
    if (window.innerWidth < 1024) setSideOpen(false);
    setQuery("");
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const addTicket = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "").trim();
    const description = String(data.get("description") || "").trim();
    const repeated = tickets.find((item) => item.status !== "Resolvido" && item.requester === currentPerson.name && String(item.title || "").trim().toLowerCase() === title.toLowerCase() && Date.parse(item.createdAt) > now.getTime() - 86400000);
    if (repeated && !window.confirm(`Já existe o chamado ${repeated.id} com o mesmo assunto aberto nas últimas 24 horas. Deseja registrar outro?`)) return;
    const isTech = can("claimTickets");
    const category = isTech ? data.get("category") || "Outro" : "";
    const selectedClient = clients.find((client) => client.id === data.get("customerName") || client.name === data.get("customerName"));
    const autoPriority = classifyTicketPriority("", `${title} ${description}`);
    const chosenPriority = isTech && data.get("priorityOverride") ? data.get("priorityOverride") : autoPriority;
    const openedAt = currentDateTime();
    const remoteTicket = hasSupabaseSession() && session.userId && /^[0-9a-f-]{36}$/i.test(org.id);
    const activeLoad = new Map();
    for (const item of tickets) if (item.status !== "Resolvido" && item.assignee && item.assignee !== "—") activeLoad.set(item.assignee, (activeLoad.get(item.assignee) || 0) + 1);
    const availableTechnicians = remoteTicket ? [] : people.filter((person) => person.role === "TI" && person.available === true && (activeLoad.get(person.name) || 0) < (person.maxActiveTickets || 3));
    const assignedTechnician = availableTechnicians.length ? availableTechnicians[Math.floor(Math.random() * availableTechnicians.length)] : null;
    /* SLA centralizado: antes os valores 4/8/40 estavam espalhados. */
    const slaHours = SLA_BY_PRIORITY[chosenPriority] || 40;
    /* ID gerado sobre a lista COMPLETA (antes usava a lista visível do
       Funcionário, permitindo IDs duplicados). */
    const ticket = {
      id: remoteTicket ? `CH-${crypto.randomUUID().slice(0, 8).toUpperCase()}` : nextId("CH", tickets), customerId: selectedClient?.id || null,
      title, description, category: category || "Outro",
      priority: chosenPriority,
      prioritySource: isTech && data.get("priorityOverride") ? "manual" : "auto",
      priorityBy: isTech && data.get("priorityOverride") ? `${currentPerson.name} (${role})` : "Sistema (classificação automática)",
      status: "Aberto", requester: currentPerson.name, customerName: selectedClient?.name || String(data.get("customerName") || currentPerson.name).trim(), assignee: assignedTechnician?.name || "—", assignmentStatus: assignedTechnician ? "Pendente de aceite" : "Sem técnico disponível", createdAt: openedAt, dueAt: new Date(new Date(openedAt).getTime() + slaHours * 3600000).toISOString(), slaHours,
      history: [{ status: "Aberto", person: currentPerson.name, date: openedAt, note: `${chosenPriority === autoPriority ? `Prioridade automática ${autoPriority}` : `Prioridade ajustada para ${chosenPriority}`} · SLA ${slaHours} h.${assignedTechnician ? ` Atribuído aleatoriamente a ${assignedTechnician.name}; aguardando aceite.` : " Nenhum técnico está disponível no momento."}` }],
      serviceIds: [], comments: [], attachments: [],
    };
    setTickets((items) => [ticket, ...items]);
    if (hasSupabaseSession() && session.userId && /^[0-9a-f-]{36}$/i.test(org.id)) {
      const requester = people.find((person) => person.email === currentPerson.email);
      void restInsert("tickets", { company_id: org.id, id: ticket.id, title, description, category: category || "Outro", priority: chosenPriority, requester_user_id: session.userId, details: { customerName: ticket.customerName, customerId: ticket.customerId, prioritySource: ticket.prioritySource } }).then((rows) => {
        const saved = rows?.[0];
        if (saved) setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, priority: saved.priority, dueAt: saved.due_at, createdAt: saved.created_at } : item));
        void writeAuditEvent(org.id, session.userId, "ticket.created", "ticket", ticket.id, { priority: saved?.priority || chosenPriority, requester_known: Boolean(requester) });
        notify({ tone: "success", title: "Chamado registrado", message: `${ticket.id} foi salvo. Selecionando técnico disponível.` });
        return restRpc("assign_ticket", { p_company_id: org.id, p_ticket_id: ticket.id })
          .catch((error) => { void captureAppError(error, org.id); return null; });
      }).then(async (assigneeId) => {
        let assignee = null;
        if (assigneeId) assignee = people.find((person) => person.id === assigneeId) || (await restSelect("memberships", `company_id=eq.${org.id}&user_id=eq.${assigneeId}`))[0];
        const name = assignee?.name || assignee?.display_name || "—";
        const status = assigneeId ? "Pendente de aceite" : "Sem técnico disponível";
        setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, assignee: name, assignmentStatus: status } : item));
        notify({ tone: "success", message: assigneeId ? `${ticket.id} enviado para ${name} aceitar.` : `${ticket.id} aguardando técnico disponível.`, title: "Atribuição automática" });
      }).catch((error) => {
        setTickets((items) => items.filter((item) => item.id !== ticket.id));
        notify({ tone: "info", title: "Chamado não confirmado", message: error.message || "Tente registrar novamente." });
        void captureAppError(error, org.id);
      });
    }
    logEvent(org.id, currentPerson.name, "Chamado criado", `${ticket.id} — ${ticket.title} · prioridade ${chosenPriority}${chosenPriority === autoPriority ? " (auto)" : " (ajustada)"}`, chosenPriority === "Urgente" ? "warning" : "info");
    setModal("");
    navigate("Chamados");
    notify({ tone: remoteTicket ? "info" : "success", message: remoteTicket ? `Enviando ${ticket.id} ao servidor…` : `Chamado ${ticket.id} aberto${assignedTechnician ? ` · enviado a ${assignedTechnician.name} para aceite` : " · aguardando técnico disponível"}.`, title: remoteTicket ? "Registro em andamento" : "Chamado registrado" });
  };

  const addClient = async (event) => {
    event.preventDefault();
    if (!can("manageClients")) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    const documentValue = String(data.get("document") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const storedClients = Array.isArray(org.clients) ? org.clients : [];
    const duplicate = storedClients.find((client) => client.id !== clientEditing?.id && ((documentValue && String(client.document || "").replace(/\D/g, "") === documentValue.replace(/\D/g, "")) || (email && String(client.email || "").toLowerCase() === email) || client.name.toLowerCase() === name.toLowerCase()));
    if (duplicate) { notify({ tone: "info", title: "Cliente já cadastrado", message: `${duplicate.name} já consta no cadastro.` }); return; }
    if (clientEditing) {
      const updated = { ...clientEditing, document: documentValue, email, phone: String(data.get("phone") || "").trim(), company: String(data.get("company") || "").trim(), notes: String(data.get("notes") || "").trim(), updatedAt: currentDateTime() };
      try { await persistWorkspaceRow("clients", updated); }
      catch (error) { notify({ tone: "info", title: "Cliente não atualizado", message: error.message }); return; }
      setData((current) => ({ ...current, clients: (current.clients || []).map((client) => client.id === clientEditing.id ? updated : client) }));
      logEvent(org.id, currentPerson.name, "Cadastro de cliente atualizado", clientEditing.name, "info");
      setClientEditing(null); setModal("");
      notify({ tone: "success", title: "Cadastro atualizado", message: `${name} foi atualizado.` });
      return;
    }
    const client = { id: nextId("CLI", storedClients), name, document: documentValue, email, phone: String(data.get("phone") || "").trim(), company: String(data.get("company") || "").trim(), notes: String(data.get("notes") || "").trim(), createdAt: currentDateTime(), active: true };
    try { await persistWorkspaceRow("clients", client); }
    catch (error) { notify({ tone: "info", title: "Cliente não cadastrado", message: error.message }); return; }
    setData((current) => ({ ...current, clients: [client, ...(current.clients || [])] }));
    logEvent(org.id, currentPerson.name, "Cliente cadastrado", `${client.name}${client.document ? ` · ${client.document}` : ""}`, "info");
    setModal("");
    notify({ tone: "success", title: "Cliente cadastrado", message: `${client.name} pode ser vinculado a chamados.` });
  };

  const toggleClient = (client) => {
    if (!can("manageClients") || !client?.id) return;
    setData((current) => ({ ...current, clients: (current.clients || []).map((item) => item.id === client.id ? { ...item, active: item.active === false } : item) }));
    logEvent(org.id, currentPerson.name, client.active === false ? "Cliente reativado" : "Cliente arquivado", client.name, "info");
    notify({ tone: "success", title: client.active === false ? "Cliente reativado" : "Cliente arquivado", message: client.name });
  };

  const changeTicketPriority = async (ticket, priority) => {
    if (!ticket || ticket.priority === priority) return;
    if (session.backend === "supabase") {
      try { await restRpc("change_ticket_priority", { p_company_id: org.id, p_ticket_id: ticket.id, p_priority: priority }); }
      catch (error) { notify({ tone: "info", title: "Prioridade não alterada", message: error.message }); return; }
    }
    const stamp = currentDateTime();
    setTickets((items) => items.map((item) => (item.id === ticket.id ? {
      ...item,
      priority,
      slaHours: SLA_BY_PRIORITY[priority] || 40,
      dueAt: new Date(new Date(item.createdAt).getTime() + (SLA_BY_PRIORITY[priority] || 40) * 3600000).toISOString(),
      prioritySource: "manual",
      priorityBy: `${currentPerson.name} (${role})`,
      history: [...(item.history || []), { status: item.status, person: currentPerson.name, date: stamp, note: `Prioridade ajustada: ${ticket.priority} → ${priority}.` }],
    } : item)));
    logEvent(org.id, currentPerson.name, "Prioridade do chamado", `${ticket.id} — ${ticket.priority} → ${priority}`, priority === "Urgente" ? "warning" : "info");
    notify({ tone: priority === "Urgente" ? "info" : "success", message: `${ticket.id} agora tem prioridade ${priority}.`, title: "Prioridade atualizada" });
  };

  const claimTicket = async (ticket) => {
    if (!can("claimTickets")) {
      notify({ tone: "info", message: "Somente o Admin e a equipe de TI podem adquirir chamados.", title: "Acesso restrito" });
      return;
    }
    if (ticket.status === "Resolvido") {
      notify({ tone: "info", message: "Reabra o chamado antes de assumir um novo atendimento.", title: "Chamado concluído" });
      return;
    }
    if (ticket.assignmentStatus === "Pendente de aceite" && ticket.assignee === currentPerson.name) {
      if (session.backend === "supabase") {
        try { await restRpc("respond_to_ticket_assignment", { p_company_id: org.id, p_ticket_id: ticket.id, p_accept: true }); }
        catch (error) { notify({ tone: "info", title: "Atribuição não aceita", message: error.message }); return; }
      }
      const stamp = currentDateTime();
      setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, status: "Em processamento", assignmentStatus: "Aceito", firstResponseAt: item.firstResponseAt || stamp, history: [...(item.history || []), { status: "Em processamento", person: currentPerson.name, date: stamp, note: "Atribuição aceita pelo técnico." }] } : item));
      logEvent(org.id, currentPerson.name, "Atribuição aceita", ticket.id, "success");
      notify({ tone: "success", message: `${ticket.id} está em atendimento.`, title: "Chamado aceito" });
      return;
    }
    if (ticket.assignee && ticket.assignee !== "—") {
      notify({ tone: "info", message: `${ticket.id} já está com ${ticket.assignee}.`, title: "Chamado já assumido" });
      return;
    }
    if (hasSupabaseSession() && session.userId && /^[0-9a-f-]{36}$/i.test(org.id)) {
      void restRpc("assign_ticket", { p_company_id: org.id, p_ticket_id: ticket.id }).then(async (assigneeId) => {
        if (!assigneeId) {
          setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, assignee: "—", assignmentStatus: "Sem técnico disponível" } : item));
          notify({ tone: "info", message: "Nenhum técnico disponível no momento.", title: "Chamado na fila" });
          return;
        }
        const assigned = people.find((person) => person.id === assigneeId) || (await restSelect("memberships", `company_id=eq.${org.id}&user_id=eq.${assigneeId}`))[0];
        const assigneeName = assigned?.name || assigned?.display_name || "TI";
        setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, assignee: assigneeName, assignmentStatus: "Pendente de aceite" } : item));
        if (assigneeId === session.userId) {
          await restRpc("respond_to_ticket_assignment", { p_company_id: org.id, p_ticket_id: ticket.id, p_accept: true });
          setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, status: "Em processamento", assignmentStatus: "Aceito" } : item));
          notify({ tone: "success", message: `${ticket.id} atribuído a você e aceito.`, title: "Chamado adquirido" });
        } else notify({ tone: "info", message: `${ticket.id} foi encaminhado a ${assigneeName} para aceite.`, title: "Atribuição automática" });
      }).catch((error) => notify({ tone: "info", title: "Atribuição não concluída", message: error.message }));
      return;
    }
    const stamp = currentDateTime();
    setTickets((items) => items.map((item) => (item.id === ticket.id ? {
      ...item,
      assignee: currentPerson.name,
      status: "Em processamento",
      firstResponseAt: ticket.firstResponseAt || stamp,
      history: [...(item.history || []), { status: "Em processamento", person: currentPerson.name, date: stamp, note: "Chamado assumido para atendimento." }],
    } : item)));
    logEvent(org.id, currentPerson.name, "Chamado assumido", `${ticket.id} — responsável: ${currentPerson.name}`, "info");
    notify({ tone: "success", message: `${ticket.id} agora está em processamento por você.`, title: "Chamado adquirido" });
  };

  const declineAssignment = (ticket) => {
    if (ticket.assignee !== currentPerson.name || ticket.assignmentStatus !== "Pendente de aceite") return;
    const stamp = currentDateTime();
    const activeLoad = new Map();
    for (const item of tickets) if (item.status !== "Resolvido" && item.assignee && item.assignee !== "—") activeLoad.set(item.assignee, (activeLoad.get(item.assignee) || 0) + 1);
    const next = people.filter((person) => person.role === "TI" && person.available === true && person.name !== currentPerson.name && (activeLoad.get(person.name) || 0) < (person.maxActiveTickets || 3));
    const replacement = next.length ? next[Math.floor(Math.random() * next.length)] : null;
    const remoteAssignment = hasSupabaseSession() && session.userId && /^[0-9a-f-]{36}$/i.test(org.id);
    if (!remoteAssignment) setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, assignee: replacement?.name || "—", assignmentStatus: replacement ? "Pendente de aceite" : "Sem técnico disponível", history: [...(item.history || []), { status: "Aberto", person: currentPerson.name, date: stamp, note: replacement ? `Atribuição recusada; encaminhado a ${replacement.name}.` : "Atribuição recusada; sem outro técnico disponível." }] } : item));
    if (remoteAssignment) void restRpc("respond_to_ticket_assignment", { p_company_id: org.id, p_ticket_id: ticket.id, p_accept: false }).then(async () => {
      const [remote] = await restSelect("tickets", `company_id=eq.${org.id}&id=eq.${encodeURIComponent(ticket.id)}`);
      const assignee = remote?.assignee_user_id ? people.find((person) => person.id === remote.assignee_user_id) || (await restSelect("memberships", `company_id=eq.${org.id}&user_id=eq.${remote.assignee_user_id}`))[0] : null;
      const name = assignee?.name || assignee?.display_name || "—";
      setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, assignee: name, assignmentStatus: remote?.assignment_status === "pending_acceptance" ? "Pendente de aceite" : "Sem técnico disponível", history: [...(item.history || []), { status: "Aberto", person: currentPerson.name, date: stamp, note: name !== "—" ? `Atribuição recusada; encaminhado a ${name}.` : "Atribuição recusada; sem outro técnico disponível." }] } : item));
      notify({ tone: "info", message: name !== "—" ? `Chamado encaminhado a ${name}.` : "O chamado retornou à fila sem técnico disponível.", title: "Atribuição atualizada" });
    }).catch((error) => notify({ tone: "info", title: "Não foi possível recusar", message: error.message }));
    if (!remoteAssignment) notify({ tone: "info", message: replacement ? `Chamado enviado a ${replacement.name}.` : "O chamado retornou à fila sem técnico disponível.", title: "Atribuição atualizada" });
  };

  const submitSatisfaction = async (ticketId, score, comment) => {
    if (role === "TI") return;
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket || ticket.status !== "Resolvido" || ticket.requester !== currentPerson.name || ticket.satisfaction) return;
    const satisfaction = { score, comment: String(comment || "").trim(), person: currentPerson.name, date: currentDateTime() };
    if (session.backend === "supabase") {
      try { await restRpc("submit_ticket_satisfaction", { p_company_id: org.id, p_ticket_id: ticketId, p_score: score, p_comment: satisfaction.comment }); }
      catch (error) { notify({ tone: "info", title: "Avaliação não registrada", message: error.message }); return; }
    }
    setTickets((items) => items.map((item) => item.id === ticketId ? { ...item, satisfaction } : item));
    void writeAuditEvent(org.id, session.userId, "ticket.satisfaction_submitted", "ticket", ticketId, { score });
    notify({ tone: "success", title: "Avaliação registrada", message: "Obrigado pelo feedback sobre o atendimento." });
  };

  const changeTicketStatus = async (ticket, status, note = "") => {
    if (!can("claimTickets")) {
      notify({ tone: "info", message: "Somente Admin e TI podem alterar o andamento do chamado.", title: "Acesso restrito" });
      return;
    }
    if (status === "Em processamento" && !ticket.assignee) {
      notify({ tone: "info", message: "Assuma o chamado antes de iniciar o atendimento.", title: "Responsável necessário" });
      return;
    }
    if (status === "Resolvido" && !String(note).trim()) {
      notify({ tone: "info", message: "Descreva o que foi feito antes de concluir o chamado.", title: "Falta a solução" });
      return;
    }
    if (status === "Resolvido" && ticket.status !== "Em processamento") {
      notify({ tone: "info", message: "Inicie o atendimento antes de concluir o chamado.", title: "Etapa pendente" });
      return;
    }
    if (status === "Resolvido" && ticket.assignee !== currentPerson.name && role !== "Admin") {
      notify({ tone: "info", message: `Somente ${ticket.assignee} ou o Admin pode concluir este chamado.`, title: "Responsável diferente" });
      return;
    }
    if (ticket.status === status) return;
    if (session.backend === "supabase") {
      try { await restRpc("update_ticket_status_with_note", { p_company_id: org.id, p_ticket_id: ticket.id, p_status: status, p_note: String(note).trim() }); }
      catch (error) { notify({ tone: "info", title: "Status não alterado", message: error.message }); return; }
    }
    const stamp = currentDateTime();
    setTickets((items) => items.map((item) => (item.id === ticket.id ? {
      ...item,
      status,
      assignee: status === "Aberto" ? "—" : item.assignee && item.assignee !== "—" ? item.assignee : currentPerson.name,
      ...(status === "Resolvido" ? { resolvedAt: stamp } : { resolvedAt: null }),
      firstResponseAt: status === "Em processamento" ? (item.firstResponseAt || stamp) : item.firstResponseAt,
      history: [...(item.history || []), { status, person: currentPerson.name, date: stamp, note: String(note).trim() }],
    } : item)));
    logEvent(org.id, currentPerson.name, "Status do chamado", `${ticket.id} → ${status}${note ? ` · ${note}` : ""}`, status === "Resolvido" ? "success" : "info");
    notify({
      tone: status === "Resolvido" ? "success" : "info",
      title: `Chamado ${ticket.id}`,
      message: status === "Em processamento" ? "Chamado adquirido — registrado no histórico como em processamento."
        : status === "Resolvido" ? "Serviço concluído — histórico atualizado."
          : "Chamado reaberto para novo atendimento.",
    });
  };

  const addInventoryItem = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const item = {
      id: nextId("INV", inventory), name: data.get("name"), category: data.get("category"),
      sku: data.get("sku"), quantity: Number(data.get("quantity")), minimum: Number(data.get("minimum")),
      unitCost: Number(data.get("unitCost")), warrantyUntil: data.get("warrantyUntil") || "",
    };
    try { await persistWorkspaceRow("inventory", item); }
    catch (error) { notify({ tone: "info", title: "Item não cadastrado", message: error.message }); return; }
    setInventory((items) => [item, ...items]);
    logEvent(org.id, currentPerson.name, "Estoque", `Item cadastrado: ${item.name} (${item.quantity} un.)`, "info");
    setModal("");
    notify({ tone: "success", message: `${item.name} disponível no estoque.`, title: "Componente cadastrado" });
  };

  const addService = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const service = {
      id: nextId("SV", services), name: data.get("name"), category: data.get("category"),
      price: Number(data.get("price")), active: true, description: data.get("description") || "",
    };
    try { await persistWorkspaceRow("services", service); }
    catch (error) { notify({ tone: "info", title: "Serviço não cadastrado", message: error.message }); return; }
    setServices((current) => [service, ...current]);
    logEvent(org.id, currentPerson.name, "Serviço cadastrado", `${service.id} — ${service.name} (${money(service.price)})`, "info");
    setModal("");
    notify({ tone: "success", message: `${service.name} disponível no catálogo de serviços.`, title: "Serviço criado" });
  };

  const toggleService = (service) => {
    setServices((items) => items.map((item) => item.id === service.id ? { ...item, active: item.active === false } : item));
    logEvent(org.id, currentPerson.name, service.active === false ? "Serviço ativado" : "Serviço desativado", `${service.id} — ${service.name}`, "info");
  };

  const removeService = (service) => {
    setServices((items) => items.map((item) => item.id === service.id ? { ...item, active: false } : item));
    logEvent(org.id, currentPerson.name, "Serviço removido do catálogo", `${service.id} — ${service.name}`, "warning");
    notify({ message: `${service.name} foi desativado; vínculos e valores históricos foram preservados.` });
  };

  const linkServiceToTicket = async (ticketId, serviceId) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    const service = services.find((item) => item.id === serviceId);
    if (!ticket || !service) return;
    if ((ticket.serviceIds || []).includes(serviceId)) {
      notify({ tone: "info", message: `${service.name} já está aplicado em ${ticket.id}.` });
      return;
    }
    if (ticket.status === "Resolvido") {
      notify({ tone: "info", message: "Chamados resolvidos não recebem novos serviços.", title: ticket.id });
      return;
    }
    if (session.backend === "supabase") {
      try {
        const details = await restRpc("update_ticket_link", { p_company_id: org.id, p_ticket_id: ticketId, p_kind: "service", p_entity_id: serviceId, p_add: true });
        setTickets((items) => items.map((item) => item.id === ticketId ? { ...item, serviceIds: details.serviceIds || [], servicePrices: details.servicePrices || {}, history: details.history || [] } : item));
        notify({ tone: "success", title: "Serviço vinculado", message: `${service.name} aplicado ao chamado ${ticketId}.` });
      } catch (error) { notify({ tone: "info", title: "Serviço não vinculado", message: error.message }); }
      return;
    }
    const stamp = currentDateTime();
    setTickets((items) => items.map((item) => (item.id === ticketId ? {
      ...item,
      serviceIds: [...(item.serviceIds || []), serviceId],
      servicePrices: { ...(item.servicePrices || {}), [serviceId]: Number(service.price || 0) },
      history: [...(item.history || []), { status: item.status, person: currentPerson.name, date: stamp, note: `Serviço aplicado: ${service.name} (${money(service.price)}).` }],
    } : item)));
    logEvent(org.id, currentPerson.name, "Serviço vinculado", `${serviceId} — ${service.name} → ${ticketId} (${money(service.price)})`, "info");
    notify({ tone: "success", message: `${service.name} (${money(service.price)}) aplicado ao chamado ${ticketId}.`, title: "Serviço vinculado" });
  };

  const unlinkServiceFromTicket = async (ticket, serviceId) => {
    const service = services.find((item) => item.id === serviceId);
    if (!ticket || !service) return;
    if (session.backend === "supabase") {
      try {
        const details = await restRpc("update_ticket_link", { p_company_id: org.id, p_ticket_id: ticket.id, p_kind: "service", p_entity_id: serviceId, p_add: false });
        setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, serviceIds: details.serviceIds || [], servicePrices: details.servicePrices || {}, history: details.history || [] } : item));
        notify({ title: "Serviço removido", message: `${service.name} removido do chamado ${ticket.id}.` });
      } catch (error) { notify({ tone: "info", title: "Serviço não removido", message: error.message }); }
      return;
    }
    const stamp = currentDateTime();
    setTickets((items) => items.map((item) => (item.id === ticket.id ? {
      ...item,
      serviceIds: (item.serviceIds || []).filter((id) => id !== serviceId),
      history: [...(item.history || []), { status: item.status, person: currentPerson.name, date: stamp, note: `Serviço removido: ${service.name}.` }],
    } : item)));
    logEvent(org.id, currentPerson.name, "Serviço desvinculado", `${serviceId} — ${service.name} ✕ ${ticket.id}`, "warning");
    notify({ message: `${service.name} removido do chamado ${ticket.id}.` });
  };

  const openRegistroInvoice = (invoiceId) => {
    setInvoiceFocus(invoiceId);
    navigate("Notas fiscais");
  };

  const addTicketComment = async (ticketId, text, file) => {
    const clean = String(text || "").trim();
    if (!clean && !file) return;
    const stamp = currentDateTime();
    const attachment = file ? { name: file.name, type: file.type, size: file.size, data: file.data } : null;
    if (session.backend === "supabase") {
      try {
        const details = await restRpc("append_ticket_comment", { p_company_id: org.id, p_ticket_id: ticketId, p_text: clean, p_attachment: attachment });
        setTickets((items) => items.map((item) => item.id === ticketId ? { ...item, comments: details.comments || [], attachments: details.attachments || [], history: details.history || [] } : item));
      } catch (error) { notify({ tone: "info", title: "Atualização não enviada", message: error.message }); }
      return;
    }
    setTickets((items) => items.map((item) => item.id === ticketId ? {
      ...item,
      comments: [...(item.comments || []), ...(clean ? [{ id: `COM-${Date.now()}`, text: clean, person: currentPerson.name, date: stamp }] : [])],
      attachments: attachment ? [...(item.attachments || []), { ...attachment, id: `ATT-${Date.now()}`, person: currentPerson.name, date: stamp }] : (item.attachments || []),
      history: [...(item.history || []), { status: item.status, person: currentPerson.name, date: stamp, note: attachment ? `Anexo adicionado: ${attachment.name}${clean ? ` · ${clean}` : ""}` : `Comentário: ${clean}` }],
    } : item));
    logEvent(org.id, currentPerson.name, file ? "Anexo no chamado" : "Comentário no chamado", `${ticketId}${file ? ` — ${file.name}` : ` — ${clean.slice(0, 100)}`}`, "info");
  };

  const exportBackup = () => {
    const payload = { format: "tigest-backup", version: 1, exportedAt: currentDateTime(), org, logs: readLogs().filter((entry) => entry.orgId === org.id) };
    downloadJson(payload, `gesti-backup-${org.id}`);
  };
  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    try {
      const payload = JSON.parse(await file.text());
      const imported = payload?.format === "tigest-backup" ? payload.org : null;
      if (!imported || payload.version !== 1 || imported.id !== org.id || !imported.company || !["people", "clients", "tickets", "inventory", "services", "expenses", "invoices"].every((key) => Array.isArray(imported[key]))) throw new Error("O arquivo não é um backup válido desta empresa.");
      if (!window.confirm(`Restaurar o backup de ${imported.company?.name || "esta empresa"}? Os dados atuais serão substituídos. Uma cópia de segurança atual será baixada primeiro.`)) return;
      exportBackup();
      setData(imported);
      const importedLogs = Array.isArray(payload.logs) ? payload.logs.filter((entry) => entry && typeof entry === "object" && entry.orgId === org.id) : [];
      writeLogs([...readLogs().filter((entry) => entry.orgId !== org.id), ...importedLogs]);
      logEvent(org.id, currentPerson.name, "Backup restaurado", `Arquivo ${file.name}`, "warning");
      notify({ tone: "success", title: "Backup restaurado", message: "Dados restaurados. A página será atualizada." });
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      notify({ tone: "info", title: "Não foi possível restaurar", message: error.message || "Verifique o arquivo e tente novamente." });
    } finally { setBackupBusy(false); }
  };

  const linkTicketInvoice = (ticketId, invoice) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket) return;
    const stamp = currentDateTime();
    setTickets((items) => items.map((item) => item.id === ticketId ? {
      ...item,
      invoiceIds: Array.from(new Set([...(item.invoiceIds || []), invoice.id])),
      history: [...(item.history || []), { status: item.status, person: currentPerson.name, date: stamp, note: `Documento ${invoice.number}/${invoice.series} vinculado.` }],
    } : item));
    logEvent(org.id, currentPerson.name, "Nota vinculada ao chamado", `${invoice.number}/${invoice.series} → ${ticketId}`, "info");
  };

  const clearLogs = () => {
    writeLogs(readLogs().filter((entry) => entry.orgId !== org.id));
    logEvent(org.id, currentPerson.name, "Logs limpos", "Histórico de auditoria apagado", "warning");
    notify({ message: "O histórico local desta empresa foi limpo neste navegador." });
  };

  const adjustStock = (item, amount) => registerMovement(item, amount);

  const issueInvoice = async (invoice) => {
    if (session.backend === "supabase") {
      const result = await restRpc("save_demo_document", { p_company_id: org.id, p_document: invoice });
      if (remoteRecordsRef.current.companyId === org.id) {
        for (const item of result.inventory || []) remoteRecordsRef.current.records.set(`inventory:${item.id}`, JSON.stringify(item));
        for (const item of result.movements || []) remoteRecordsRef.current.records.set(`movements:${item.id}`, JSON.stringify(item));
      }
      const changed = new Map((result.inventory || []).map((item) => [item.id, item]));
      if (changed.size) setInventory((items) => items.map((item) => changed.get(item.id) || item));
      if (result.movements?.length) setData((candidate) => ({ ...candidate, movementLog: [...result.movements, ...(candidate.movementLog || [])] }));
      return;
    }
    const outboundItems = invoice.status === "Emitida" ? invoice.items.filter((item) => item.inventoryId && item.quantity > 0) : [];
    for (const item of outboundItems) {
      const stockEntry = inventory.find((candidate) => candidate.id === item.inventoryId);
      if (!stockEntry) continue;
      registerMovement(stockEntry, -Math.abs(Number(item.quantity) || 0));
    }
  };

  const registerMovement = (item, amount) => {
    if (amount < 0 && item.quantity < Math.abs(amount)) {
      notify({ tone: "info", title: "Estoque insuficiente", message: `${item.name} tem apenas ${item.quantity} unidade(s).` });
      return;
    }
    const movement = {
      id: `MOV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      item: item.name, quantity: amount, person: currentPerson.name, date: currentDateTime(),
    };
    setInventory((items) => items.map((current) => (current.id === item.id ? { ...current, quantity: Math.max(0, current.quantity + amount) } : current)));
    setData((candidate) => ({ ...candidate, movementLog: [movement, ...(candidate.movementLog || movements)] }));
    logEvent(org.id, currentPerson.name, "Estoque", `${item.name}: ${amount > 0 ? `+${amount}` : amount} un.`, amount < 0 ? "warning" : "info");
  };

  const addExpense = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = String(data.get("kind") || "Despesa");
    const supplierQuotes = [1, 2, 3].flatMap((index) => {
      const supplier = String(data.get(`quoteSupplier${index}`) || "").trim();
      const amount = Number(data.get(`quoteAmount${index}`));
      return supplier && amount > 0 ? [{ supplier, amount }] : [];
    });
    setExpenses((items) => [{
      id: nextId("PC", expenses), title: data.get("title"), category: data.get("category"),
      amount: Number(data.get("amount")), requester: currentPerson.name, date: today(), status: "Pendente", notes: data.get("notes"),
      kind, supplier: String(data.get("supplier") || "").trim(), costCenter: String(data.get("costCenter") || "").trim(),
      dueDate: data.get("dueDate") || "", paymentMethod: String(data.get("paymentMethod") || ""),
      paymentStatus: "Aguardando aprovação", ...(kind === "Compra" ? { purchaseStage: "Solicitada", supplierQuotes, purchaseOrder: String(data.get("purchaseOrder") || "").trim() } : {}),
    }, ...items]);
    setModal("");
    notify({ message: kind === "Compra" ? "A compra entrou na fila de aprovação." : "A despesa entrou na fila de aprovação.", title: kind === "Compra" ? "Compra solicitada" : "Despesa enviada" });
  };

  const setExpenseStatus = (id, status) => {
    setExpenses((items) => items.map((expense) => (expense.id === id ? { ...expense, status } : expense)));
    const expense = expenses.find((item) => item.id === id);
    logEvent(org.id, currentPerson.name, `Despesa ${status.toLowerCase()}`, expense ? `${expense.id} — ${expense.title} (${money(expense.amount)})` : id, status === "Aprovada" ? "success" : "warning");
  };

  const setExpensePaymentStatus = (id, paymentStatus) => {
    if (!can("approve")) return;
    const paidAt = paymentStatus === "Paga" ? today() : "";
    setExpenses((items) => items.map((expense) => expense.id === id ? { ...expense, paymentStatus, paidAt } : expense));
    const expense = expenses.find((item) => item.id === id);
    logEvent(org.id, currentPerson.name, paymentStatus === "Paga" ? "Conta paga" : "Pagamento reaberto", expense ? `${expense.id} — ${expense.title} (${money(expense.amount)})` : id, paymentStatus === "Paga" ? "success" : "info");
    void writeAuditEvent(org.id, session.userId, paymentStatus === "Paga" ? "expense.payment_paid" : "expense.payment_reopened", "expense", id, { paymentStatus, paidAt });
  };

  const updatePurchaseStage = (id, changes) => {
    if (!can("approve")) return;
    setExpenses((items) => items.map((expense) => expense.id === id ? { ...expense, ...changes, stageUpdatedAt: currentDateTime(), stageUpdatedBy: currentPerson.name } : expense));
    const expense = expenses.find((item) => item.id === id);
    if (expense && changes.purchaseStage) {
      logEvent(org.id, currentPerson.name, "Etapa da compra", `${expense.id} — ${expense.title}: ${changes.purchaseStage}`, "info");
      void writeAuditEvent(org.id, session.userId, "purchase.stage_updated", "expense", id, { stage: changes.purchaseStage });
    }
  };

  const setInvoicePaymentStatus = async (invoice, paymentStatus) => {
    if (!can("approve")) return;
    const updated = { ...invoice, paymentStatus, paidAt: paymentStatus === "Recebida" ? today() : "" };
    try { await persistWorkspaceRow("invoices", updated); }
    catch (error) { notify({ tone: "info", title: "Recebimento não atualizado", message: error.message || "Tente novamente." }); return; }
    setInvoices((items) => items.map((item) => item.id === invoice.id ? updated : item));
    logEvent(org.id, currentPerson.name, paymentStatus === "Recebida" ? "Recebimento registrado" : "Recebimento reaberto", `${invoice.number}/${invoice.series} · ${money(invoice.total)}`, paymentStatus === "Recebida" ? "success" : "info");
    void writeAuditEvent(org.id, session.userId, paymentStatus === "Recebida" ? "invoice.payment_received" : "invoice.payment_reopened", "invoice", invoice.id, { paymentStatus, paidAt: updated.paidAt });
  };

  const addPerson = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const roleName = String(data.get("role") || "");
    const passwordMode = String(data.get("password_mode") || "admin-assigned");
    const password = String(data.get("password") || "");
    if (passwordMode !== "first-login" && (password.length < 8 || password !== String(data.get("confirm_password") || ""))) {
        notify({ tone: "info", title: "Confira a senha", message: "A senha deve ter pelo menos 8 caracteres e os dois campos precisam ser iguais." });
      return false;
    }
    if (people.some((person) => String(person.email || "").toLowerCase() === String(email).toLowerCase())) {
      notify({ tone: "info", message: "Este e-mail já possui acesso ao workspace." });
      return false;
    }
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) {
      try {
        if (passwordMode === "first-login") {
          const accessCode = createEmployeeAccessCode();
          const claimCodeHash = await hashAccessCode(accessCode);
          await restRpc("register_employee_first_login", { p_company_id: org.id, p_email: email, p_display_name: name, p_role: roleName, p_claim_code_hash: claimCodeHash });
          logEvent(org.id, currentPerson.name, "Funcionário preparado para primeiro acesso", `${name} · ${email}`, "info");
          notify({ tone: "success", title: "Cadastro realizado", message: `Passe o código de primeiro acesso diretamente a ${name}.` });
          return { accessCode };
        }
        const created = await supabaseRegisterEmployee({ companyId: org.id, email, displayName: name, role: roleName, password });
        setData((current) => ({ ...current, people: [...current.people.filter((member) => member.id !== created.userId), { id: created.userId, name, email, role: roleName, capabilities: {}, available: false }] }));
        logEvent(org.id, currentPerson.name, "Funcionário cadastrado", `${name} · ${email} · senha inicial definida`, "info");
        notify({ tone: "success", title: "Funcionário cadastrado", message: `${name} já pode entrar com o e-mail e a senha inicial que você definiu.` });
          return true;
      } catch (error) {
        void captureAppError(error, org.id);
        notify({ tone: "info", title: "Não foi possível cadastrar", message: error.message || "Confira suas permissões e tente novamente." });
        return false;
      }
    }
    await addPersonWithAccess({ id: nextId("U", people), name, email, role: roleName, password });
    notify({ tone: "success", message: `${name} agora faz parte da equipe e já pode fazer login.`, title: "Funcionário cadastrado" });
    return true;
  };

  /* Redefinição de senha: "own" troca a própria; id numérico reseta a de
     outra pessoa (Admin/Dono/Gerência). */
  const handleResetPassword = (targetId, currentPassword, newPassword) => {
    if (targetId === "own") return store.changeOwnPassword(currentPassword, newPassword);
    if (!can("managePeople")) return { ok: false, error: "Sem permissão para redefinir senhas." };
    return resetPersonPassword(targetId, newPassword);
  };

  const addSupplier = (event) => {
    event.preventDefault();
    if (!can("manageStock")) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if ((org.suppliers || []).some((supplier) => supplier.name.toLowerCase() === name.toLowerCase())) return notify({ tone: "info", title: "Fornecedor existente", message: `${name} já está cadastrado.` });
    const supplier = { id: nextId("FOR", org.suppliers || []), name, email: String(form.get("email") || "").trim(), phone: String(form.get("phone") || "").trim(), active: true, createdAt: currentDateTime() };
    setData((current) => ({ ...current, suppliers: [supplier, ...(current.suppliers || [])] }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) void restInsert("suppliers", { company_id: org.id, name, email: supplier.email || null, phone: supplier.phone || null }).then((rows) => { if (rows?.[0]?.id) setData((current) => ({ ...current, suppliers: (current.suppliers || []).map((item) => item.id === supplier.id ? { ...item, remoteId: rows[0].id } : item) })); }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Fornecedor cadastrado", name, "info");
    void writeAuditEvent(org.id, session.userId, "supplier.created", "supplier", supplier.id);
    event.currentTarget.reset();
  };

  const removeSupplier = (supplier) => {
    if (!can("manageStock")) return;
    setData((current) => ({ ...current, suppliers: (current.suppliers || []).filter((item) => item.id !== supplier.id) }));
    if (hasSupabaseSession() && supplier.remoteId) void restDelete("suppliers", `id=eq.${supplier.remoteId}`).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Fornecedor removido", supplier.name, "warning");
  };

  const saveBudget = (event) => {
    event.preventDefault();
    if (!can("viewCosts")) return;
    const form = new FormData(event.currentTarget);
    const category = String(form.get("category") || "").trim();
    const month = `${form.get("month")}-01`;
    const amount = Number(form.get("amount"));
    if (!category || !month || !(amount > 0)) return;
    const existing = (org.budgets || []).find((item) => item.category.toLowerCase() === category.toLowerCase() && String(item.month).slice(0, 7) === month.slice(0, 7));
    const budget = { id: existing?.id || nextId("ORC", org.budgets || []), category, month, amount };
    setData((current) => ({ ...current, budgets: [budget, ...(current.budgets || []).filter((item) => item.id !== budget.id)] }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) void restInsert("category_budgets", { company_id: org.id, category, month, limit_amount: amount }, { upsert: true, onConflict: "company_id,category,month" }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Orçamento atualizado", `${category} · ${month.slice(0, 7)} · ${money(amount)}`, "info");
    void writeAuditEvent(org.id, session.userId, "budget.saved", "category_budget", budget.id, { category, month, amount });
    event.currentTarget.reset();
  };

  const saveReplyTemplate = (event) => {
    event.preventDefault();
    if (!can("manageTickets")) return;
    const form = new FormData(event.currentTarget);
    const template = { id: nextId("TPL", org.replyTemplates || []), title: String(form.get("title") || "").trim(), body: String(form.get("body") || "").trim(), active: true };
    setData((current) => ({ ...current, replyTemplates: [template, ...(current.replyTemplates || [])] }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) void restInsert("reply_templates", { company_id: org.id, title: template.title, body: template.body }).then((rows) => { if (rows?.[0]?.id) setData((current) => ({ ...current, replyTemplates: (current.replyTemplates || []).map((item) => item.id === template.id ? { ...item, remoteId: rows[0].id } : item) })); }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Modelo de resposta criado", template.title, "info");
    void writeAuditEvent(org.id, session.userId, "reply_template.created", "reply_template", template.id);
    event.currentTarget.reset();
  };

  const deleteReplyTemplate = (template) => {
    if (!can("manageTickets")) return;
    setData((current) => ({ ...current, replyTemplates: (current.replyTemplates || []).filter((item) => item.id !== template.id) }));
    if (hasSupabaseSession() && template.remoteId) void restDelete("reply_templates", `id=eq.${template.remoteId}`).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Modelo de resposta removido", template.title, "warning");
  };

  const toggleAvailability = (person) => {
    if (person.role !== "TI" || (person.email !== currentPerson.email && !can("managePeople"))) return;
    const available = person.available !== true;
    setData((current) => ({ ...current, people: current.people.map((item) => item.id === person.id ? { ...item, available } : item) }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id) && /^[0-9a-f-]{36}$/i.test(person.id)) void restInsert("technician_presence", { company_id: org.id, user_id: person.id, available, max_active_tickets: person.maxActiveTickets || 3 }, { upsert: true, onConflict: "company_id,user_id" }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Disponibilidade TI", `${person.name}: ${available ? "disponível" : "indisponível"}`, "info");
  };

  const saveRole = async (roleValue) => {
    if (!can("manageCompany")) return false;
    if (roleValue.existing || roleValue.remove || roleValue.renameTo) return false;
    // `is_default` é definido pelo padrão do banco e não faz parte do GRANT INSERT.
    const payload = { company_id: org.id, name: roleValue.name, capabilities: roleValue.capabilities };
    try {
      if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) {
        const inserted = await restInsert("company_roles", payload);
        if (!inserted?.some((item) => item.name === roleValue.name)) throw new Error("O banco não confirmou a criação do cargo.");
        const roleRows = await restSelect("company_roles", `company_id=eq.${org.id}`);
        if (!roleRows.some((item) => item.name === roleValue.name)) throw new Error("O cargo foi enviado, mas não apareceu na lista da empresa.");
        const visibleRoles = roleRows.filter((item) => ROLES.includes(item.name) || !item.is_default || people.some((member) => member.role === item.name));
        setData((current) => ({ ...current, roleCatalog: visibleRoles.map((item) => ({ name: item.name, isDefault: item.is_default })), rolePermissions: Object.fromEntries(visibleRoles.map((item) => [item.name, Object.keys(item.capabilities || {}).filter((key) => item.capabilities[key] === true)])) }));
      } else {
        setData((current) => {
          const names = current.roleCatalog || ROLES.map((name) => ({ name, isDefault: true }));
          const nextNames = [...names, { name: roleValue.name, isDefault: false }];
          const nextPermissions = { ...(current.rolePermissions || {}), [roleValue.name]: Object.keys(roleValue.capabilities).filter((key) => roleValue.capabilities[key]) };
          return { ...current, roleCatalog: nextNames, rolePermissions: nextPermissions };
        });
      }
      notify({ tone: "success", title: "Novo cargo criado", message: `${roleValue.name} está pronto para ser atribuído à equipe.` });
      return true;
    } catch (error) { notify({ tone: "info", title: "Cargo não salvo", message: error.message || "Confira seu acesso e tente novamente." }); return false; }
  };

  const setMemberRole = async (personId, nextRole) => {
    if (!can("manageCompany")) return;
    try {
      if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) {
        await restRpc("set_member_role", { p_company_id: org.id, p_user_id: personId, p_role: nextRole });
        const [savedMember] = await restSelect("memberships", `company_id=eq.${org.id}&user_id=eq.${personId}`);
        if (savedMember?.role !== nextRole) throw new Error("O banco não confirmou a alteração do cargo.");
      }
      setData((current) => ({ ...current, people: current.people.map((item) => item.id === personId ? { ...item, role: nextRole, capabilities: {} } : item) }));
    } catch (error) { notify({ tone: "info", title: "Cargo não alterado", message: error.message || "Confira as permissões do cargo." }); }
  };

  const removeCompanyMember = (personId) => {
    const person = people.find((item) => item.id === personId);
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id) && /^[0-9a-f-]{36}$/i.test(personId)) {
      void restRpc("remove_company_member", { p_company_id: org.id, p_user_id: personId }).then(() => {
        removePerson(personId);
        logEvent(org.id, currentPerson.name, "Membro removido", person?.name || personId, "warning");
        notify({ tone: "success", title: "Acesso revogado", message: `${person?.name || "A pessoa"} foi removida da empresa.` });
      }).catch((error) => {
        void captureAppError(error, org.id);
        notify({ tone: "info", title: "Não foi possível remover", message: error.message || "Confira suas permissões e tente novamente." });
      });
      return;
    }
    removePerson(personId);
  };

  const saveCompany = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setCompanyData((current) => ({
      ...current,
      name: data.get("name"), document: data.get("document"), email: data.get("email"),
      phone: data.get("phone"), address: data.get("address"), department: data.get("department"),
    }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id) && can("manageCompany")) void restUpdate("companies", `id=eq.${org.id}`, { name: String(data.get("name") || "").trim(), profile_data: { document: data.get("document"), email: data.get("email"), phone: data.get("phone"), address: data.get("address"), department: data.get("department") } }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Dados da empresa atualizados", company.name, "info");
    notify({ tone: "success", message: "Dados da organização atualizados.", title: "Empresa" });
  };

  const saveBranding = (event) => {
    event.preventDefault();
    if (!can("manageCompany")) return;
    const form = new FormData(event.currentTarget);
    const primaryColor = String(form.get("primaryColor") || "#2c666e");
    const backgroundColor = String(form.get("backgroundColor") || "#f4f7f4");
    const surfaceColor = String(form.get("surfaceColor") || "#ffffff");
    const textColor = String(form.get("textColor") || "#1f363d");
    const logoUrl = String(form.get("logoUrl") || "").trim();
    if (![primaryColor, backgroundColor, surfaceColor, textColor].every((color) => /^#[0-9a-f]{6}$/i.test(color))) return notify({ tone: "info", title: "Cor inválida", message: "Escolha cores hexadecimais válidas." });
    if (logoUrl && !/^https:\/\//i.test(logoUrl)) return notify({ tone: "info", title: "URL de logo inválida", message: "Use um endereço HTTPS para a imagem." });
    setCompanyData((current) => ({ ...current, primaryColor, backgroundColor, surfaceColor, textColor, logoUrl }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) void restUpdate("companies", `id=eq.${org.id}`, { branding: { primaryColor, backgroundColor, surfaceColor, textColor, logoUrl } }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Identidade visual atualizada", company.name, "info");
    notify({ tone: "success", title: "Identidade visual salva", message: "A cor principal da empresa foi atualizada." });
  };

  const resetBranding = () => {
    if (!can("manageCompany")) return;
    const branding = { primaryColor: "#2c666e", backgroundColor: "#f4f7f4", surfaceColor: "#ffffff", textColor: "#1f363d", logoUrl: "" };
    setCompanyData((current) => ({ ...current, ...branding }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) void restUpdate("companies", `id=eq.${org.id}`, { branding }).catch((error) => void captureAppError(error, org.id));
    logEvent(org.id, currentPerson.name, "Identidade visual redefinida", company.name, "info");
    notify({ tone: "success", title: "Identidade visual restaurada", message: "As cores e o logo voltaram ao padrão GesTI." });
  };

  const exportAccountingCsv = () => {
    const rows = [
      ...invoices.filter((invoice) => invoice.status === "Emitida").map((invoice) => ({ sourceId: invoice.id, date: invoice.createdAt, type: "Receita", category: "Serviços", description: `Documento demonstrativo ${invoice.number}/${invoice.series}`, counterparty: invoice.customer?.name || "", amount: Number(invoice.total || 0), status: invoice.status })),
      ...expenses.filter((expense) => expense.status !== "Rejeitada").map((expense) => ({ sourceId: expense.id, date: expense.date, type: "Despesa", category: expense.category, description: expense.title, counterparty: expense.requester, amount: -Math.abs(Number(expense.amount || 0)), status: expense.status })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    downloadCsv(rows, `gesti-contabilidade-${today()}`, ["Data", "Tipo", "Categoria", "Descrição", "Contraparte", "Valor", "Status"], (row) => [row.date, row.type, row.category, row.description, row.counterparty, row.amount.toFixed(2), row.status]);
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)) {
      const payload = rows.map((row) => ({ company_id: org.id, source_type: row.type === "Receita" ? "invoice" : "expense", source_id: String(row.sourceId), document_date: row.date, category: row.category, description: row.description, counterparty: row.counterparty, amount: row.amount, status: row.status }));
      if (payload.length) void restInsert("accounting_entries", payload, { upsert: true, onConflict: "company_id,source_type,source_id" }).catch((error) => void captureAppError(error, org.id));
    }
    void writeAuditEvent(org.id, session.userId, "accounting.csv_exported", "accounting_report", null, { rows: rows.length });
  };

  const finishTour = () => {
    setData((current) => ({ ...current, onboardingComplete: true }));
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id) && session.userId) void restInsert("onboarding_progress", { company_id: org.id, user_id: session.userId, completed_at: currentDateTime(), current_step: 4 }, { upsert: true, onConflict: "company_id,user_id" }).catch((error) => void captureAppError(error, org.id));
    setTourStep(null);
    void writeAuditEvent(org.id, session.userId, "onboarding.completed", "onboarding", session.userId);
  };

  const pageIntro = {
    "Visão geral": ["Central de operações", "Acompanhe o que está acontecendo no setor de TI."],
    Chamados: ["Central de chamados", "Urgência classificada automaticamente, fila crítica e catálogo de serviços com valores aplicados aos chamados."],
    Equipe: ["Intra-equipe", "Chat privado e calendário compartilhado da empresa."],
    Funcionários: ["Cadastro de funcionários", "Convide pessoas para fazerem parte da equipe da empresa."],
    Clientes: ["Cadastro de clientes", "Contatos e histórico de chamados e documentos em um só lugar."],
    Estoque: ["Estoque de TI", "Componentes, níveis mínimos e valores para documentos demonstrativos."],
    Registro: ["Registro geral", "Linha do tempo de documentos e chamados, com seus vínculos."],
    Custos: ["Financeiro e compras", "Acompanhe fluxo financeiro, fornecedores, vencimentos, compras e orçamento em um só lugar."],
    "Notas fiscais": ["Documentos de demonstração", "Registros sem valor fiscal, com itens e valores do estoque."],
    Logs: ["Eventos do sistema", "Histórico local das ações realizadas neste navegador."],
    Empresa: ["Empresa e equipe", "Mantenha os dados da organização e a hierarquia de acesso."],
    Sobre: ["Sobre o GesTI", "Gestão de tecnologia da informação com clareza e responsabilidade."],
  }[page];

  if (!remoteReady) return <div className="boot-screen"><img alt="" aria-hidden="true" className="brand-symbol brand-symbol-lg" src="/gesti-mark-primary.png" /><span className="boot-hint">{remoteError || "Carregando dados da empresa…"}</span>{remoteError && <Button onClick={() => window.location.reload()}>Tentar novamente</Button>}</div>;
  return (
    <div className={`app-shell ${sideOpen ? "shell-expanded" : "shell-collapsed"}`} style={{ "--accent": company.primaryColor || "#2c666e", "--accent-bright": company.primaryColor || "#2c666e", "--accent-strong": theme === "dark" ? "#90ddf0" : "#07393c", "--focus-ring": company.primaryColor || "#2c666e", "--paper": company.backgroundColor || undefined, "--card": company.surfaceColor || undefined, "--ink": company.textColor || undefined }}>
      <SideBar aberta={sideOpen} aoFechar={() => setSideOpen(false)} aoEntrar={enterSidebar} aoSair={leaveSidebar} aoNavegar={navigate} contagens={badgeCounts} onNotificacoes={() => setNotifyOpen((current) => !current)} onLogout={logout} empresaNome={company.name} paginaAtiva={page} paginas={pagesForRole} backend={session.backend} />
      <AnimatePresence>
        {notifyOpen && (
          <motion.div animate={{ opacity: 1, x: 0, scale: 1 }} className="notif-panel" exit={{ opacity: 0, x: 24, scale: 0.97, transition: { duration: 0.16 } }} initial={{ opacity: 0, x: 24, scale: 0.97 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}>
            <div className="notif-head"><strong>Notificações</strong>{unreadCount > 0 && <span className="notif-count">{unreadCount} nova(s)</span>}</div>
            {alerts.length ? <ul className="notif-list">{alerts.map((alert) => <li key={alert.id}><button className="notif-item" onClick={() => { navigate(alert.target || "Estoque"); setNotifyOpen(false); }} type="button"><span className={`notif-icon tone-${alert.tone}`}><Icon name={alert.icon} size={15} /></span><span className="notif-copy"><strong>{alert.title}</strong><small>{alert.message}</small></span></button></li>)}</ul> : <p className="notif-empty">Tudo em dia por aqui. ✨</p>}
            <button className="notif-dismiss" onClick={() => { setReadAlerts((current) => Array.from(new Set([...current, ...alerts.map((alert) => alert.id)]))); setNotifyOpen(false); }} type="button">Marcar como lidas e fechar</button>
          </motion.div>
        )}
      </AnimatePresence>
      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {!sideOpen && <button aria-controls="navegacao-principal" aria-expanded={sideOpen} aria-label="Abrir menu" className="menu-trigger" onClick={() => setSideOpen(true)} type="button"><Icon name="menu" size={21} /></button>}
            <div className="breadcrumbs"><span>{company.logoUrl && <img alt="" className="company-logo" src={company.logoUrl} />}{company.name}</span><Icon name="chevron" size={14} /><strong>{page}</strong></div>
            <span className="topbar-clock" title="Horário local"><Icon name="clock" size={13} /> {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div className="topbar-right">
            <div className="topbar-actions">
              <div className="notif-wrap">
                <button aria-label="Notificações" className="theme-toggle" onClick={() => setNotifyOpen((current) => !current)} type="button"><Icon name="bell" size={18} /></button>
                {unreadCount > 0 && <motion.span animate={{ scale: [0, 1.25, 1] }} className="notif-pip" transition={{ duration: 0.35, ease: "backOut" }}>{unreadCount}</motion.span>}
              </div>
              <button aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} className="theme-toggle" onClick={toggleTheme} title={theme === "dark" ? "Tema claro" : "Tema escuro"} type="button"><Icon name={theme === "dark" ? "sun" : "moon"} size={18} /></button>
              <button className="logout-button" onClick={logout} type="button"><Icon name="logout" size={15} /> Sair</button>
            </div>
            <div className="avatar" title={`${currentPerson.name} · ${role}`}>{currentPerson.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
          </div>
        </header>

        <div className="page-content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div animate={{ opacity: 1, y: 0 }} className="page-transition" exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }} initial={reduceMotion ? false : { opacity: 0, y: 14 }} key={page} transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <Reveal><div className="page-heading"><div><span className="eyebrow">{company.name} <span className="eyebrow-dot">/</span> {company.department || role}</span><h1>{pageIntro[0]}</h1><p>{pageIntro[1]}</p></div>
                {page === "Chamados" && <Button onClick={() => setModal("ticket")}><Icon name="plus" size={17} /> Novo chamado</Button>}
                {page === "Estoque" && can("manageStock") && <Button onClick={() => setModal("inventory")}><Icon name="plus" size={17} /> Adicionar item</Button>}
                {page === "Custos" && <Button onClick={() => setModal("expense")}><Icon name="plus" size={17} /> Novo lançamento</Button>}
                {page === "Notas fiscais" && can("approve") && <Button onClick={() => setInvoiceSignal((signal) => signal + 1)}><Icon name="file" size={17} /> Criar documento de demonstração</Button>}
                {page === "Visão geral" && can("viewCosts") && <Button onClick={() => setModal("report")} variant="secondary"><Icon name="file" size={16} /> Relatório mensal / PDF</Button>}
              </div></Reveal>

              {page === "Visão geral" && <Suspense fallback={<LoadingPanel />}><LazyOverview approvedTotal={approvedTotal} backupBusy={backupBusy} canBackup={can("backup")} canSeeFinances={can("viewCosts")} company={company} dashboardMetrics={dashboardMetrics} onDashboardMetricsChange={changeDashboardMetrics} inventory={role === "Funcionário" ? [] : inventory} invoices={role === "Funcionário" ? [] : invoices} lowStock={lowStock} now={now} onBackupExport={exportBackup} onBackupImport={importBackup} onNavigate={navigate} overdueTickets={overdueTickets} pendingExpenses={pendingExpenses} pendingTickets={pendingTickets} personName={currentPerson.name} remoteAuth={session.backend === "supabase"} role={role} tickets={visibleTickets} /></Suspense>}
              {page === "Visão geral" && role !== "Funcionário" && <details className="overview-team"><summary>Desempenho da equipe e cumprimento de prazos</summary><Suspense fallback={<LoadingPanel />}><LazyTeamMetrics tickets={visibleTickets} /></Suspense></details>}
              {page === "Chamados" && <Suspense fallback={<LoadingPanel />}><LazyTicketsPage canClaim={can("claimTickets")} canManage={can("manageTickets")} canManageReplies={can("manageTickets")} canManageServices={can("manageServices")} canSetCategory={can("claimTickets")} canSetPriority={can("claimTickets")} currentPersonName={currentPerson.name} detail={ticketDetail} invoices={invoices} now={now} onAddComment={addTicketComment} onChangePriority={changeTicketPriority} onChangeStatus={changeTicketStatus} onClaim={claimTicket} onDeclineAssignment={declineAssignment} onDeleteReply={deleteReplyTemplate} onLinkService={linkServiceToTicket} onSaveReply={saveReplyTemplate} onSurvey={submitSatisfaction} onUnlinkService={unlinkServiceFromTicket} query={query} replyTemplates={org.replyTemplates || []} role={role} services={filteredServices} setDetail={setTicketDetail} setQuery={setQuery} tickets={filteredTickets} /></Suspense>}
              {page === "Chamados" && role !== "Funcionário" && <Suspense fallback={<LoadingPanel />}><LazyTeamMetrics tickets={visibleTickets} /></Suspense>}
              {page === "Equipe" && <Suspense fallback={<LoadingPanel />}><LazyTeamHub canCreateTeamChats={can("createTeamChats")} canManageCalendar={can("manageCalendar")} companyId={org.id} people={people} person={currentPerson} /></Suspense>}
              {page === "Funcionários" && <Suspense fallback={<LoadingPanel />}><EmployeeRegistration companyName={company.name} onSubmit={addPerson} people={people} remoteAuth={session.backend === "supabase"} roles={(org.roleCatalog?.length ? org.roleCatalog.map((item) => item.name) : ROLES).filter((item) => !["Dono", "Dono da empresa", "Admin"].includes(item))} /></Suspense>}
              {page === "Clientes" && <Suspense fallback={<LoadingPanel />}><LazyCustomersPage canManage={can("manageClients")} clients={clients} remoteAuth={session.backend === "supabase"} onAdd={() => { setClientEditing(null); setModal("client"); }} onEdit={(client) => { setClientEditing(client); setModal("client"); }} onOpenTickets={(name) => { setQuery(name); navigate("Chamados"); }} onToggle={toggleClient} query={query} setQuery={setQuery} /></Suspense>}
              {page === "Estoque" && <Suspense fallback={<LoadingPanel />}><LazyInventoryPage canManage={can("manageStock")} inventory={role === "Funcionário" ? [] : filteredInventory} allInventory={role === "Funcionário" ? [] : inventory} movements={movements} onAdjust={adjustStock} onAddSupplier={addSupplier} onDownload={() => downloadCsv(filteredInventory, "gesti-relatorio-estoque", ["Código", "Componente", "Categoria", "SKU", "Quantidade", "Mínimo", "Custo unitário", "Garantia até"], (item) => [item.id, item.name, item.category, item.sku, item.quantity, item.minimum, item.unitCost, item.warrantyUntil || ""])} onRemoveSupplier={removeSupplier} query={query} setQuery={setQuery} suppliers={org.suppliers || []} /></Suspense>}
              {page === "Custos" && <Suspense fallback={<LoadingPanel />}><LazyExpensesPage budgets={org.budgets || []} canApprove={can("approve")} expenses={expenses} invoices={invoices} onInvoicePaymentStatus={setInvoicePaymentStatus} onPaymentStatus={setExpensePaymentStatus} onPurchaseStage={updatePurchaseStage} onSaveBudget={saveBudget} onStatus={setExpenseStatus} role={role} /></Suspense>}
              {page === "Notas fiscais" && <Suspense fallback={<LoadingPanel />}><InvoicePage canIssue={can("approve")} canManageServices={can("manageServices")} clients={clients} company={{ ...company, id: org.id, invoices }} currentPerson={currentPerson} focusInvoiceId={invoiceFocus} inventory={inventory} invoices={filteredInvoices} onAddService={() => setModal("service")} onIssueComplete={issueInvoice} onLinkTicketInvoice={linkTicketInvoice} onFocusHandled={() => setInvoiceFocus("")} onRemoveService={removeService} onToggleService={toggleService} openSignal={invoiceSignal} services={services} setInvoices={setInvoices} tickets={tickets} /></Suspense>}
              {page === "Registro" && <Suspense fallback={<LoadingPanel />}><LazyRegistryPage invoices={invoices} onOpenInvoice={openRegistroInvoice} tickets={tickets} /></Suspense>}
              {page === "Logs" && <Suspense fallback={<LoadingPanel />}><LazyLogsPage canLog={can("clearLogs")} onClear={() => setModal("logs")} orgId={org.id} remoteAuth={session.backend === "supabase"} /></Suspense>}
              {page === "Empresa" && <Suspense fallback={<LoadingPanel />}><LazyCompanyPage canManageCompany={can("manageCompany")} canManagePeople={can("managePeople")} company={company} companyId={org.id} currentPerson={currentPerson} onSave={saveCompany} onSaveBranding={saveBranding} onResetBranding={resetBranding} onSaveRole={saveRole} onSetRole={setMemberRole} roleCatalog={org.roleCatalog || []} rolePermissions={rolePermissions} onToggleAvailability={toggleAvailability} people={people} removePerson={removeCompanyMember} resetPassword={handleResetPassword} remoteAuth={session.backend === "supabase"} /></Suspense>}
              {page === "Sobre" && <Suspense fallback={<LoadingPanel />}><LazyAboutPage company={company} /></Suspense>}
            </motion.div>
          </AnimatePresence>
        </div>
        <footer className="app-footer"><span>GesTI · Gestão de TI · {company.name}</span><span>{session.name} ({role}) · {session.backend === "supabase" ? "Dados sincronizados com Supabase" : "Dados salvos neste navegador"}</span><button className="app-footer-privacy" onClick={() => window.dispatchEvent(new Event("gesti:open-privacy-center"))} type="button">Privacidade e cookies</button></footer>
      </main>

      {modal === "service" && <Modal onClose={() => setModal("")} title="Novo serviço do catálogo"><form className="form-grid" onSubmit={addService}><Field className="field-full" label="Nome do serviço"><input autoFocus name="name" placeholder="Ex.: Remoção de vírus e otimização" required /></Field><Field label="Categoria"><select name="category"><option>Software</option><option>Hardware</option><option>Rede</option><option>Suporte</option><option>Outro</option></select></Field><Field label="Preço (R$)"><input min="0" name="price" required step="0.01" type="number" /></Field><Field className="field-full" label="Descrição"><textarea maxLength="300" name="description" placeholder="O que está incluído neste serviço..." rows="3" /></Field><div className="form-actions"><Button onClick={() => setModal("")} variant="secondary">Cancelar</Button><Button type="submit">Salvar serviço</Button></div></form></Modal>}
      {modal === "logs" && <Modal onClose={() => setModal("")} title="Limpar logs do sistema"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); clearLogs(); setModal(""); }}><p className="confirm-text">Esta ação apaga permanentemente os <strong>{readLogs().filter((entry) => entry.orgId === org.id).length}</strong> registros de auditoria desta empresa. Não é possível desfazer.</p><div className="form-actions"><Button onClick={() => setModal("")} variant="secondary">Cancelar</Button><Button type="submit"><Icon name="warning" size={16} /> Apagar tudo</Button></div></form></Modal>}
      {modal === "ticket" && <Modal onClose={() => setModal("")} title="Abrir chamado"><form className="form-grid" onSubmit={addTicket}><Field className="field-full" label="Assunto"><input autoFocus maxLength="100" name="title" placeholder="Ex.: Computador não liga" required /></Field><Field className="field-full" label="Cliente relacionado"><select defaultValue={currentPerson.name} name="customerName"><option value={currentPerson.name}>{currentPerson.name} (solicitante)</option>{(role === "Funcionário" ? [] : clients).filter((client) => client.name !== currentPerson.name && client.active !== false).map((client) => <option key={client.id || client.name} value={client.name}>{client.name}{client.company ? ` · ${client.company}` : ""}</option>)}</select></Field>{can("claimTickets") && <Field label="Categoria (TI)"><select name="category"><option>Hardware</option><option>Software</option><option>Rede</option><option>Acesso</option><option>Outro</option></select></Field>}<Field className="field-full" label="Descreva o problema"><textarea maxLength="500" name="description" placeholder="Conte o que aconteceu, desde quando e o que você já tentou." required rows="4" /></Field><div className="field-full auto-priority-note"><Icon name="spark" size={14} /> O sistema estima a prioridade e o prazo. Descreva o impacto e quantas pessoas foram afetadas.</div>{can("claimTickets") && <Field className="field-full" label="Ajuste manual de prioridade (opcional)"><select name="priorityOverride" defaultValue=""><option value="">Manter classificação automática</option>{PRIORITY_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></Field>}<div className="form-actions"><Button onClick={() => setModal("")} variant="secondary">Cancelar</Button><Button type="submit">Registrar chamado</Button></div></form></Modal>}
      {modal === "client" && <Modal onClose={() => { setModal(""); setClientEditing(null); }} title={clientEditing ? "Editar cadastro de cliente" : "Cadastrar cliente"}><form className="form-grid" onSubmit={addClient}><Field className="field-full" label="Nome do cliente ou empresa"><input autoFocus defaultValue={clientEditing?.name || ""} maxLength="120" name="name" readOnly={Boolean(clientEditing)} required /></Field><Field label="Empresa / setor"><input defaultValue={clientEditing?.company || ""} maxLength="100" name="company" /></Field><Field label="CPF / CNPJ"><input defaultValue={clientEditing?.document || ""} maxLength="24" name="document" /></Field><Field label="E-mail"><input defaultValue={clientEditing?.email || ""} maxLength="160" name="email" type="email" /></Field><Field label="Telefone"><input defaultValue={clientEditing?.phone || ""} maxLength="24" name="phone" type="tel" /></Field><Field className="field-full" label="Endereço"><input defaultValue={clientEditing?.address || ""} maxLength="200" name="address" placeholder="Rua, número, bairro, cidade · UF" /></Field><Field className="field-full" label="Observações"><textarea defaultValue={clientEditing?.notes || ""} maxLength="400" name="notes" rows="3" /></Field><div className="form-actions"><Button onClick={() => { setModal(""); setClientEditing(null); }} variant="secondary">Cancelar</Button><Button type="submit">{clientEditing ? "Salvar alterações" : "Salvar cliente"}</Button></div></form></Modal>}
      {modal === "inventory" && <Modal onClose={() => setModal("")} title="Adicionar componente"><form className="form-grid" onSubmit={addInventoryItem}><Field className="field-full" label="Nome do componente"><input autoFocus name="name" placeholder="Ex.: SSD Kingston 1 TB" required /></Field><Field label="Categoria"><select name="category"><option>Armazenamento</option><option>Memória</option><option>Energia</option><option>Rede</option><option>Acessórios</option><option>Periféricos</option><option>Outro</option></select></Field><Field label="SKU / patrimônio"><input name="sku" placeholder="SSD-KNG-1TB" required /></Field><Field label="Quantidade"><input min="0" name="quantity" required type="number" /></Field><Field label="Estoque mínimo"><input min="0" name="minimum" required type="number" /></Field><Field label="Custo unitário (R$)"><input min="0" name="unitCost" required step="0.01" type="number" /></Field><Field label="Garantia até (opcional)"><input name="warrantyUntil" type="date" /></Field><div className="form-actions"><Button onClick={() => setModal("")} variant="secondary">Cancelar</Button><Button type="submit">Salvar componente</Button></div></form></Modal>}
      {modal === "expense" && <Modal onClose={() => setModal("")} title="Novo lançamento financeiro"><form className="form-grid" onSubmit={addExpense}><Field label="Tipo de lançamento"><select name="kind"><option>Despesa</option><option>Compra</option></select></Field><Field label="Categoria"><select name="category"><option>Hardware</option><option>Software / SaaS</option><option>Serviços</option><option>Acessórios e peças</option><option>Infraestrutura</option><option>Telecomunicações</option><option>Pessoal</option><option>Impostos e taxas</option><option>Frete e logística</option><option>Deslocamento</option><option>Escritório</option><option>Outra</option></select></Field><Field className="field-full" label="Descrição"><input autoFocus name="title" placeholder="Ex.: Renovação de licença de suporte" required /></Field><Field label="Valor previsto (R$)"><input min="0.01" name="amount" required step="0.01" type="number" /></Field><Field label="Vencimento"><input name="dueDate" type="date" /></Field><Field label="Fornecedor escolhido"><input list="finance-suppliers" name="supplier" placeholder="Nome do fornecedor"/><datalist id="finance-suppliers">{(org.suppliers || []).filter((item) => item.active !== false).map((supplier) => <option key={supplier.id} value={supplier.name}/>)}</datalist></Field><Field label="Centro de custo"><input name="costCenter" placeholder="Ex.: Operações de TI"/></Field><Field label="Forma prevista de pagamento"><select name="paymentMethod"><option value="">A definir</option><option>Pix</option><option>Boleto</option><option>Transferência</option><option>Cartão corporativo</option><option>Dinheiro</option><option>Outra</option></select></Field><Field label="Referência do pedido (opcional)"><input maxLength="60" name="purchaseOrder" placeholder="Número do pedido / orçamento"/></Field><div className="field-full finance-quote-fields"><strong>Cotações de fornecedores (opcional)</strong><div>{[1,2,3].map((index)=><div className="finance-quote-row" key={index}><input aria-label={`Fornecedor cotado ${index}`} name={`quoteSupplier${index}`} placeholder={`Fornecedor ${index}`} /><input aria-label={`Preço cotado ${index}`} min="0.01" name={`quoteAmount${index}`} placeholder="Valor da cotação" step="0.01" type="number" /></div>)}</div></div><Field className="field-full" label="Justificativa e observações"><textarea maxLength="400" name="notes" placeholder="Motivo, condições, itens e observações relevantes." rows="3"/></Field><p className="field-full finance-form-note">O lançamento será enviado para aprovação. Após aprovado, a situação de pagamento pode ser atualizada em Contas a pagar.</p><div className="form-actions"><Button onClick={() => setModal("")} variant="secondary">Cancelar</Button><Button type="submit">Enviar para aprovação</Button></div></form></Modal>}
      {modal === "report" && <Modal onClose={() => setModal("")} title="Relatório mensal" wide><div className="management-report"><header><div><span className="eyebrow">GesTI · {company.name}</span><h2>Resumo de operações</h2><p>Período: {now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</p></div>{company.logoUrl && <img alt="" className="report-logo" src={company.logoUrl} />}</header><div className="report-metrics"><article><span>Chamados abertos</span><strong>{pendingTickets.length}</strong></article><article><span>Chamados resolvidos</span><strong>{tickets.filter((item) => item.status === "Resolvido").length}</strong></article><article><span>Fora do prazo</span><strong>{overdueTickets.length}</strong></article>{can("viewCosts") && <article><span>Despesas aprovadas</span><strong>{money(approvedTotal)}</strong></article>}</div><h3>Atividade recente</h3><table><thead><tr><th>Chamado</th><th>Assunto</th><th>Status</th><th>Responsável</th></tr></thead><tbody>{tickets.slice(0, 12).map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.title}</td><td>{item.status}</td><td>{item.assignee || "—"}</td></tr>)}</tbody></table><p className="report-footnote">Gerado em {now.toLocaleString("pt-BR")} · GesTI</p></div><div className="form-actions report-actions"><Button onClick={() => setModal("")} variant="secondary">Fechar</Button>{can("viewCosts") && <Button onClick={exportAccountingCsv} variant="secondary">Exportar contabilidade CSV</Button>}<Button onClick={() => window.print()}><Icon name="print" size={15} /> Imprimir / salvar PDF</Button></div></Modal>}
      {tourStep !== null && <Modal onClose={finishTour} title="Bem-vindo ao GesTI"><div className="tour-content"><span className="tour-progress">ETAPA {tourStep + 1} DE 4</span><h3>{["Seu espaço de TI", "Atendimento organizado", "Controle de ativos e gastos", "Pronto para começar"][tourStep]}</h3><p>{["Aqui você acompanha solicitações, equipe e indicadores da empresa.", "Chamados recebem prioridade e são atribuídos a técnicos disponíveis, que podem aceitar o atendimento.", "Cadastre equipamentos, fornecedores e limites mensais por categoria.", "Personalize a identidade visual, revise permissões e consulte relatórios sempre que precisar."][tourStep]}</p><div className="form-actions"><Button onClick={finishTour} variant="secondary">Pular tour</Button>{tourStep > 0 && <Button onClick={() => setTourStep((step) => step - 1)} variant="secondary">Voltar</Button>}<Button onClick={() => tourStep === 3 ? finishTour() : setTourStep((step) => step + 1)}>{tourStep === 3 ? "Começar" : "Próximo"}</Button></div></div></Modal>}
      <AssistantChat companyId={org.id} enabled={session.backend === "supabase" && hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(org.id)} personName={currentPerson.name} />
    </div>
  );
}

function LoadingPanel() {
  return <section className="panel page-panel"><div className="panel-heading"><div><h2>Carregando…</h2><p>Preparando os dados desta seção.</p></div></div></section>;
}

/* ------------------------------- raiz do app ------------------------------- */

export default function App() {
  const store = useStore();
  const [theme, toggleTheme] = useTheme();
  const [booted, setBooted] = useState(false);
  const [loginWelcome, setLoginWelcome] = useState(false);
  const finishLoginWelcome = useCallback(() => setLoginWelcome(false), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooted(true), 250);
    return () => window.clearTimeout(timer);
  }, []);

  if (!store.seeded || !booted) return <div className="boot-screen"><img alt="" aria-hidden="true" className="brand-symbol brand-symbol-lg" src="/gesti-mark-primary.png" /><span className="boot-hint">Carregando Gesti…</span></div>;

  const loginScreen = !store.session || !store.org;
  const content = loginScreen
    ? <AuthScreen onLoginFailed={() => setLoginWelcome(false)} onLoginStart={() => setLoginWelcome(true)} store={store} />
    : store.session.requiresPasswordSetup
      ? <Suspense fallback={<div className="boot-screen"><img alt="" aria-hidden="true" className="brand-symbol brand-symbol-lg" src="/gesti-mark-primary.png" /><span className="boot-hint">Preparando seu primeiro acesso…</span></div>}><FirstLoginPassword onLogout={store.logout} onSubmit={async (password) => { await supabaseUpdateCurrentPassword(password); await store.completeEmployeePasswordSetup(); }} /></Suspense>
      : <><Workspace key={store.session.orgId} store={store} theme={theme} toggleTheme={toggleTheme} />{loginWelcome && <LoginWelcome onComplete={finishLoginWelcome} />}</>;
  return <PrivacyControls loginScreen={loginScreen}>{content}</PrivacyControls>;
}

export { ToastProvider } from "./shared.jsx";
