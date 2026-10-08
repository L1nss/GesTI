import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const allowedCapabilities = new Set(["viewCosts", "manageStock", "manageTickets", "claimTickets", "approve", "manageCompany", "managePeople", "manageServices", "clearLogs", "backup", "manageClients", "manageCalendar", "createTeamChats"]);

const legacyRoleCapabilities: Record<string, Record<string, boolean>> = {
  Admin: { viewCosts: true, manageStock: true, manageTickets: true, claimTickets: true, approve: true, manageCompany: true, managePeople: true, manageServices: true, clearLogs: true, backup: true, manageClients: true, createTeamChats: true },
  Dono: { viewCosts: true, manageStock: true, manageTickets: true, claimTickets: true, approve: true, manageCompany: true, managePeople: true, manageServices: true, clearLogs: true, backup: true, manageClients: true, manageCalendar: true, createTeamChats: true },
  "Dono da empresa": { viewCosts: true, manageStock: true, manageTickets: true, claimTickets: true, approve: true, manageCompany: true, managePeople: true, manageServices: true, clearLogs: true, backup: true, manageClients: true, manageCalendar: true, createTeamChats: true },
  TI: { manageStock: true, manageTickets: true, claimTickets: true, manageServices: true },
  "Gerência": { viewCosts: true, manageStock: true, manageTickets: true, approve: true, managePeople: true, manageServices: true, clearLogs: true, manageClients: true, manageCalendar: true },
  Supervisor: { manageStock: true, manageTickets: true, manageServices: true },
  "Funcionário": {},
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !url || !apiKey || !serviceKey) return json({ error: "Serviço de cadastro não configurado." }, 503);

  const caller = createClient(url, apiKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerData, error: callerError } = await caller.auth.getUser(token);
  if (callerError || !callerData.user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const companyId = String(body.companyId || "");
  const email = String(body.email || "").trim().toLowerCase();
  const displayName = String(body.displayName || "").trim();
  const role = String(body.role || "").trim();
  const password = String(body.password || "");
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || displayName.length < 2 || displayName.length > 120 || role.length < 2 || role.length > 40 || password.length < 8 || new TextEncoder().encode(password).length > 72) {
    return json({ error: "Informe nome, e-mail, cargo e senha válida (8 a 72 bytes)." }, 400);
  }
  if (email === callerData.user.email?.toLowerCase()) return json({ error: "Use outro e-mail para cadastrar um funcionário." }, 400);
  if (["Dono", "Dono da empresa", "Admin"].includes(role)) return json({ error: "Esse cargo não pode ser atribuído por este cadastro." }, 403);

  const { data: manager, error: managerError } = await admin.from("memberships").select("role,capabilities").eq("company_id", companyId).eq("user_id", callerData.user.id).maybeSingle();
  if (managerError || !manager) return json({ error: "Você não faz parte desta empresa." }, 403);
  const { data: managerRole } = await admin.from("company_roles").select("capabilities").eq("company_id", companyId).eq("name", manager.role).maybeSingle();
  const managerCaps = (managerRole?.capabilities || legacyRoleCapabilities[manager.role] || {}) as Record<string, unknown>;
  const effective = (capability: string) => typeof manager.capabilities?.[capability] === "boolean" ? manager.capabilities[capability] === true : managerCaps[capability] === true;
  if (!effective("managePeople")) return json({ error: "Você não tem permissão para cadastrar funcionários." }, 403);

  const { data: targetRole, error: roleError } = await admin.from("company_roles").select("capabilities").eq("company_id", companyId).eq("name", role).maybeSingle();
  if (roleError || !targetRole) return json({ error: "Selecione um cargo existente nesta empresa." }, 400);
  const targetCaps = (targetRole.capabilities || {}) as Record<string, unknown>;
  if (Object.entries(targetCaps).some(([capability, enabled]) => !allowedCapabilities.has(capability) || typeof enabled !== "boolean" || (enabled && !effective(capability)))) {
    return json({ error: "Você não pode atribuir um cargo com permissões acima das suas." }, 403);
  }
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
  if (createError || !created.user) return json({ error: "Não foi possível criar a conta. O e-mail pode já estar cadastrado no GesTI." }, 409);

  const { error: membershipError } = await admin.from("memberships").insert({ company_id: companyId, user_id: created.user.id, display_name: displayName, role, capabilities: {}, available: false, max_active_tickets: 3 });
  if (membershipError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "A conta não foi vinculada à empresa. Verifique o cargo e tente novamente." }, 400);
  }
  await admin.from("technician_presence").upsert({ company_id: companyId, user_id: created.user.id, available: false, max_active_tickets: 3 }, { onConflict: "company_id,user_id" });
  return json({ ok: true, userId: created.user.id, name: displayName, email, role });
});
