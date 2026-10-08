import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Serviço de primeiro acesso não configurado." }, 503);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^[A-Z0-9]{12}$/.test(code) || password.length < 8 || new TextEncoder().encode(password).length > 72) {
    return json({ error: "Confira o e-mail, o código de acesso e a senha (8 a 72 bytes)." }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const codeHash = await sha256Hex(code);
  const { data: claim, error: verifyError } = await admin.rpc("verify_employee_first_login_claim", {
    p_email: email,
    p_claim_code_hash: codeHash,
  });
  if (verifyError) {
    console.error("first-login claim verification failed", {
      code: verifyError.code,
      message: verifyError.message,
      hint: verifyError.hint,
    });
    return json({ error: "Não foi possível validar o código. Tente novamente." }, 503);
  }
  if (!claim?.ok) return json({ error: claim?.locked ? "Muitas tentativas. Peça ao administrador um novo código." : "E-mail ou código inválido, expirado ou já utilizado." }, claim?.locked ? 429 : 400);

  let userId = claim.user_id as string | null;
  let createdNewUser = false;
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { display_name: claim.display_name },
    });
    if (error) return json({ error: "Não foi possível definir a senha dessa conta." }, 409);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: claim.display_name },
    });
    if (error || !data.user) return json({ error: "Não foi possível criar a conta. Peça ao administrador para gerar outro código." }, 409);
    userId = data.user.id;
    createdNewUser = true;
  }

  const { error: finalizeError } = await admin.rpc("complete_employee_first_login_claim", {
    p_email: email,
    p_claim_code_hash: codeHash,
    p_user_id: userId,
  });
  if (finalizeError) {
    if (createdNewUser) await admin.auth.admin.deleteUser(userId);
    return json({ error: "Não foi possível concluir o acesso. Tente novamente ou peça outro código." }, 409);
  }

  return json({ ok: true, userId });
});
