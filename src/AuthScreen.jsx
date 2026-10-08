import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Icon } from "./shared.jsx";
import GuestMascot from "./GuestMascot.jsx";
import { useToast } from "./toast.js";
import { lookupCep, maskCep, maskDocument, maskPhone, validateEmail } from "./store.js";
import { isFirstAccessRoute } from "./utils.js";
import { supabaseClaimEmployeeRegistration, supabaseCompleteRecovery, supabaseConsumePasswordlessLink, supabaseConsumeRecoveryLink, supabaseEnabled, supabaseGetUser, supabaseSendPasswordReset, supabaseSignIn, supabaseSignOut } from "./supabaseApi.js";

const recoveryFromLink = supabaseConsumeRecoveryLink();
const passwordlessFromLink = supabaseConsumePasswordlessLink();

function BrandPanel({ mascotMode = "idle", emailGaze = 0 }) {
  return (
    <aside aria-label="GesTI" className="auth-brand">
      <svg aria-hidden="true" className="auth-brand-divider" preserveAspectRatio="none" viewBox="0 0 100 1000">
        <path d="M100 0C52 160 16 335 16 500s36 340 84 500V0Z" fill="var(--paper)" />
        <path d="M100 0C52 160 16 335 16 500s36 340 84 500" fill="none" stroke="#07393c" strokeWidth="1.4" />
      </svg>
      <div className="auth-brand-inner">
        <div className="auth-brand-lockup"><img alt="" aria-hidden="true" className="brand-symbol brand-symbol-lg" src="/gesti-mark-primary.png" /><strong>Gesti</strong></div>
        <div className="auth-brand-main">
          <div className="auth-brand-copy"><h1>Sua operação<br />de TI.</h1><p>Acompanhe chamados, peças, custos e documentos da equipe.</p></div>
          <GuestMascot className="auth-mascot" gaze={emailGaze} mode={mascotMode} />
        </div>
      </div>
    </aside>
  );
}

function LoginForm({ store, onSwitch, onLoginStart, onLoginFailed, onMascotModeChange, onEmailGazeChange }) {
  const notify = useToast();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [typingField, setTypingField] = useState("");
  const typingTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(typingTimer.current), []);

  const handleTyping = (field, setValue) => (event) => {
    setValue(event.target.value);
    setTypingField(field);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      setTypingField("");
    }, 220);
  };

  const handleEmailTyping = (event) => {
    handleTyping("email", setEmail)(event);
    const value = event.currentTarget.value;
    const cursor = event.currentTarget.selectionStart ?? value.length;
    onEmailGazeChange(value ? ((cursor / Math.max(value.length, 1)) * 2) - 1 : 0);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    onLoginStart();
    /* Pequeno atraso visual apenas para o estado "Verificando acesso…" aparecer. */
    try {
      const result = await new Promise((resolve) => window.setTimeout(() => resolve(store.login(email, password)), reduceMotion ? 0 : 350));
      if (result.ok) {
        notify({ tone: "success", message: `Bem-vindo(a) de volta, ${result.person.name}!`, title: result.company });
      } else {
        onLoginFailed();
        setError(result.error);
      }
    } catch (cause) {
      onLoginFailed();
      setError(cause.message || "Não foi possível validar o acesso neste navegador. Recarregue a página e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div animate={{ opacity: 1 }} className="auth-card" initial={reduceMotion ? false : { opacity: 0 }} transition={{ duration: 0.18 }}>
      <h2>Acesse sua conta</h2>
      <p className="auth-subtitle">Use seu e-mail corporativo e sua senha para entrar.</p>
      <form className="auth-form" onSubmit={submit}>
        <Field className={typingField === "email" ? "is-typing" : ""} label="E-mail corporativo">
          <input autoComplete="username" name="email" onBlur={() => { onMascotModeChange("idle"); onEmailGazeChange(0); }} onChange={handleEmailTyping} onFocus={() => onMascotModeChange("email")} placeholder="voce@empresa.com.br" required type="email" value={email} />
        </Field>
        <Field className={typingField === "password" ? "is-typing" : ""} label="Senha">
          <div className="password-wrap">
            <input autoComplete="current-password" name="password" onBlur={() => onMascotModeChange("idle")} onChange={handleTyping("password", setPassword)} onFocus={() => onMascotModeChange("password")} placeholder="••••••••" required type={showPassword ? "text" : "password"} value={password} />
            <button aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="password-eye" onClick={() => setShowPassword((current) => !current)} type="button"><Icon name={showPassword ? "eyeOff" : "eye"} size={16} /></button>
          </div>
        </Field>
        {error && <p className="auth-error" role="alert"><Icon name="warning" size={14} /> {error}</p>}
        <Button busy={busy} className="auth-submit" disabled={busy} type="submit">
          {busy ? <><Icon className="spin" name="spinner" size={17} /> Verificando acesso…</> : <>Entrar</>}
        </Button>
      </form>
      {supabaseEnabled && <button className="text-link auth-recovery" disabled={resetBusy} onClick={async () => {
        if (!email.trim()) { setError("Informe seu e-mail para receber o link de recuperação."); return; }
        setResetBusy(true);
        try {
          await supabaseSendPasswordReset(email.trim().toLowerCase());
          notify({ tone: "success", title: "Recuperação solicitada", message: "Se a conta existir, o Supabase enviará um link para este e-mail." });
          setError("");
        } catch (cause) { setError(cause.message || "Não foi possível solicitar a recuperação."); }
        finally { setResetBusy(false); }
      }} type="button">{resetBusy ? "Solicitando recuperação…" : "Esqueci minha senha"}</button>}
      <div className="auth-switch auth-switch-login">
        <span>Ainda não cadastrou sua empresa?</span>
        <button className="auth-register-button" onClick={onSwitch} type="button">Cadastrar empresa</button>
        {supabaseEnabled && <button className="auth-first-access-button" onClick={() => { window.location.hash = "/primeiro-acesso"; }} type="button">Já recebeu um código? Ativar acesso</button>}
      </div>
    </motion.div>
  );
}

function FirstAccessForm({ store, onLoginStart, onLoginFailed, onMascotModeChange, onReturn }) {
  const notify = useToast();
  const [claimEmail, setClaimEmail] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [claimPassword, setClaimPassword] = useState("");
  const [claimConfirm, setClaimConfirm] = useState("");
  const [claimError, setClaimError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setClaimError("");
    if (claimPassword.length < 8) return setClaimError("A senha precisa ter pelo menos 8 caracteres.");
    if (new TextEncoder().encode(claimPassword).length > 72) return setClaimError("A senha pode ter no máximo 72 bytes. Remova alguns caracteres e tente novamente.");
    if (claimPassword !== claimConfirm) return setClaimError("As senhas não coincidem.");
    const email = claimEmail.trim().toLowerCase();
    setBusy(true);
    onLoginStart();
    try {
      await supabaseClaimEmployeeRegistration({ email, code: claimCode, password: claimPassword });
      await supabaseSignIn(email, claimPassword);
      const result = await store.loginWithCurrentSession(email);
      if (!result.ok) {
        await supabaseSignOut();
        throw new Error(result.error);
      }
      // Remove a rota de primeiro acesso antes de montar o workspace autenticado.
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      notify({ tone: "success", title: result.company, message: `Bem-vindo(a), ${result.person.name}!` });
    } catch (cause) {
      onLoginFailed();
      setClaimError(cause.message || "Não foi possível concluir o primeiro acesso.");
    } finally {
      setBusy(false);
    }
  };

  return <motion.div animate={{ opacity: 1, y: 0 }} className="auth-card first-access-page" initial={{ opacity: 0, y: 12 }} transition={{ duration: 0.2 }}>
    <span className="panel-icon"><Icon name="lock" size={18}/></span>
    <h2>Ative seu acesso</h2>
    <p className="auth-subtitle">Informe seu e-mail e o código recebido do administrador. Em seguida, crie sua senha.</p>
    <form className="auth-form" onSubmit={submit}>
      <Field label="E-mail cadastrado"><input autoComplete="email" onChange={(event) => setClaimEmail(event.target.value)} required type="email" value={claimEmail}/></Field>
      <Field label="Código de primeiro acesso"><input autoCapitalize="characters" autoComplete="one-time-code" maxLength={14} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} placeholder="12 caracteres" required value={claimCode}/></Field>
      <Field label="Crie sua senha"><input autoComplete="new-password" minLength={8} onBlur={() => onMascotModeChange("idle")} onChange={(event) => setClaimPassword(event.target.value)} onFocus={() => onMascotModeChange("password")} required type="password" value={claimPassword}/></Field>
      <Field label="Confirme sua senha"><input autoComplete="new-password" minLength={8} onBlur={() => onMascotModeChange("idle")} onChange={(event) => setClaimConfirm(event.target.value)} onFocus={() => onMascotModeChange("password")} required type="password" value={claimConfirm}/></Field>
      {claimError && <p className="auth-error" role="alert"><Icon name="warning" size={14}/>{claimError}</p>}
      <Button busy={busy} className="auth-submit" disabled={busy} type="submit">{busy ? "Preparando seu acesso…" : "Criar senha e entrar"}</Button>
    </form>
    <button className="text-link auth-recovery" onClick={onReturn} type="button">Voltar para entrar</button>
  </motion.div>;
}

function RegisterForm({ store, onSwitch }) {
  const notify = useToast();
  const reduceMotion = useReducedMotion();
  const [company, setCompany] = useState({ name: "", document: "", email: "", phone: "", address: "", department: "" });
  const [admin, setAdmin] = useState({ name: "", email: "", password: "", confirm: "", role: "Dono da empresa" });
  const [cep, setCep] = useState("");
  const [cepBusy, setCepBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cep.replace(/\D/g, "").length !== 8) return undefined;
    let active = true;
    /* lookupCep única do app (BrasilAPI → ViaCEP). */
    lookupCep(cep)
      .then((data) => {
        if (!active) return;
        setCompany((current) => ({
          ...current,
          address: [data.street, data.neighborhood, `${data.city} · ${data.state}`].filter(Boolean).join(", "),
        }));
        notify({ tone: "success", message: "Endereço preenchido pela BrasilAPI/ViaCEP.", title: "CEP encontrado" });
      })
      .catch((cause) => {
        if (active) notify({ tone: "info", message: cause.message, title: "Consulta de CEP" });
      })
      .finally(() => {
        if (active) setCepBusy(false);
      });
    return () => {
      active = false;
    };
  }, [cep, notify]);

  const strength = Math.min(4, (admin.password.length >= 8) + /[A-Z]/.test(admin.password) + /[0-9]/.test(admin.password) + /[^A-Za-z0-9]/.test(admin.password));
  const strengthLabel = ["Muito fraca", "Fraca", "Razoável", "Forte", "Excelente"][strength];

  const setCompanyField = (event) => setCompany((current) => ({ ...current, [event.target.name]: event.target.value }));
  const setAdminField = (event) => setAdmin((current) => ({ ...current, [event.target.name]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    /* Correção do bug: aqui lia "form.document", que não existia neste
       escopo (o estado é "company") e quebrava o cadastro com ReferenceError. */
    if (!company.document || company.document.replace(/\D/g, "").length !== 14) {
      return setError("Informe um CNPJ com 14 dígitos.");
    }
    if (admin.password !== admin.confirm) return setError("As senhas não coincidem.");
    if (admin.password.length < 8) return setError("A senha deve ter pelo menos 8 caracteres.");
    if (!validateEmail(admin.email)) return setError("Informe um e-mail válido para acesso.");
    setBusy(true);
    const result = await new Promise((resolve) => window.setTimeout(() => resolve(store.registerCompany({ company, adminName: admin.name, adminEmail: admin.email, password: admin.password, adminRole: admin.role })), reduceMotion ? 0 : 450));
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    await store.login(admin.email, admin.password);
    notify({ tone: "success", message: `Workspace criado. Você entrou como ${admin.role}.`, title: `${company.name} cadastrada!` });
    setBusy(false);
  };

  return (
    <motion.div animate={{ opacity: 1, y: 0 }} className="auth-card" initial={reduceMotion ? false : { opacity: 0, y: 18 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <h2>Cadastrar empresa</h2>
      <p className="auth-subtitle">Cadastre sua empresa e crie o acesso do administrador.</p>
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-group-label"><Icon name="building" size={14} /> Dados da empresa</div>
        <Field label="Razão social / nome">
          <input name="name" onChange={setCompanyField} placeholder="Ex.: Acme Tecnologia" required value={company.name} />
        </Field>
        <div className="auth-row">
          <Field label="CNPJ">
            <input inputMode="numeric" name="document" onChange={(event) => setCompanyField({ ...event, target: { ...event.target, name: "document", value: maskDocument(event.target.value) } })} placeholder="00.000.000/0000-00" required value={company.document} />
          </Field>
          <Field label="Telefone">
            <input inputMode="tel" name="phone" onChange={(event) => setCompanyField({ ...event, target: { ...event.target, name: "phone", value: maskPhone(event.target.value) } })} placeholder="(11) 3000-0000" value={company.phone} />
          </Field>
        </div>
        <Field label="E-mail da empresa">
          <input name="email" onChange={setCompanyField} placeholder="contato@empresa.com.br" required type="email" value={company.email} />
        </Field>
        <div className="auth-row">
          <Field label="CEP (busca automática)">
            <div className="cep-wrap">
              <input inputMode="numeric" maxLength="9" name="cep" onChange={(event) => { const value = maskCep(event.target.value); setCep(value); setCepBusy(value.replace(/\D/g, "").length === 8); }} placeholder="00000-000" value={cep} />
              {cepBusy && <Icon className="spin cep-spinner" name="spinner" size={15} />}
            </div>
          </Field>
        </div>
        <Field label="Endereço completo">
          <input name="address" onChange={setCompanyField} placeholder="Rua, número, bairro, cidade · UF" value={company.address} />
        </Field>
        <Field label="Departamento responsável">
          <input name="department" onChange={setCompanyField} placeholder="Ex.: Tecnologia da Informação" value={company.department} />
        </Field>

        <div className="auth-group-label"><Icon name="users" size={14} /> Administrador do workspace</div>
        <Field label="Seu nome completo">
          <input name="name" onChange={setAdminField} placeholder="Nome e sobrenome" required value={admin.name} />
        </Field>
        <div className="auth-row">
          <Field label="E-mail de acesso">
            <input name="email" onChange={setAdminField} placeholder="voce@empresa.com.br" required type="email" value={admin.email} />
          </Field>
          <Field label="Perfil administrativo">
            <select name="role" onChange={setAdminField} value={admin.role}>
              <option>Dono da empresa</option>
              <option>Admin</option>
              <option>Gerência</option>
            </select>
          </Field>
        </div>
        <div className="auth-row">
          <Field label="Senha de acesso">
            <input autoComplete="new-password" minLength={8} name="password" onChange={setAdminField} placeholder="Mínimo 8 caracteres" required type="password" value={admin.password} />
          </Field>
          <Field label="Confirmar senha">
            <input autoComplete="new-password" name="confirm" onChange={setAdminField} placeholder="Repita a senha" required type="password" value={admin.confirm} />
          </Field>
        </div>
        {admin.password && (
          <div className="password-strength" data-strength={strength}>
            <span className="strength-bars">{[0, 1, 2, 3].map((index) => <i key={index} className={index < strength ? "on" : ""} />)}</span>
            <small>Força da senha: {strengthLabel}</small>
          </div>
        )}
        {error && <p className="auth-error" role="alert"><Icon name="warning" size={14} /> {error}</p>}
        <Button className="auth-submit" disabled={busy} type="submit">
          {busy ? <><Icon className="spin" name="spinner" size={17} /> Criando workspace…</> : <><Icon name="building" size={16} /> Criar empresa e entrar</>}
        </Button>
      </form>
      <div className="auth-switch"><span>Sua empresa já tem cadastro?</span><button onClick={onSwitch} type="button">Entrar</button></div>
    </motion.div>
  );
}

function PasswordlessCompletion({ store }) {
  const [message, setMessage] = useState("Confirmando seu e-mail e preparando o primeiro acesso…");
  const loginWithCurrentSession = store.loginWithCurrentSession;
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = await supabaseGetUser();
        const result = await loginWithCurrentSession(user.email);
        if (!result.ok) throw new Error(result.error);
      } catch (error) {
        if (active) setMessage(error.message || "Este acesso expirou ou não corresponde a um funcionário cadastrado. Peça ao administrador um novo código de primeiro acesso.");
      }
    })();
    return () => { active = false; };
  }, [loginWithCurrentSession]);
  return <div className="auth-card"><h2>Primeiro acesso</h2><p className="auth-subtitle" role="status">{message}</p></div>;
}

export default function AuthScreen({ store, onLoginStart, onLoginFailed }) {
  const [mode, setMode] = useState(() => recoveryFromLink ? "recovery" : passwordlessFromLink ? "first-access" : isFirstAccessRoute(window.location.hash) ? "claim" : "login");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [mascotMode, setMascotMode] = useState("idle");
  const [emailGaze, setEmailGaze] = useState(0);
  useEffect(() => {
    const syncFirstAccessRoute = () => setMode((current) => {
      if (isFirstAccessRoute(window.location.hash)) return "claim";
      return current === "claim" ? "login" : current;
    });
    window.addEventListener("hashchange", syncFirstAccessRoute);
    return () => window.removeEventListener("hashchange", syncFirstAccessRoute);
  }, []);
  const returnToLogin = () => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setMode("login");
  };
  return (
    <div className="auth-screen">
      <BrandPanel emailGaze={emailGaze} mascotMode={mascotMode} />
      <div className="auth-side">
        <div className="auth-mobile-brand"><img alt="" aria-hidden="true" className="brand-symbol" src="/gesti-mark-primary.png" /><strong>Gesti</strong><GuestMascot className="auth-mobile-guest" gaze={emailGaze} mode={mascotMode} /></div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={mode} transition={{ duration: 0.16 }}>
            {mode === "recovery" ? <div className="auth-card"><h2>Definir nova senha</h2><p className="auth-subtitle">Use pelo menos 8 caracteres.</p><form className="auth-form" onSubmit={async (event) => { event.preventDefault(); setRecoveryBusy(true); setRecoveryError(""); try { await supabaseCompleteRecovery(recoveryPassword); setMode("login"); } catch (error) { setRecoveryError(error.message || "Não foi possível trocar a senha."); } finally { setRecoveryBusy(false); } }}><Field label="Nova senha"><input autoComplete="new-password" minLength={8} onChange={(event) => setRecoveryPassword(event.target.value)} required type="password" value={recoveryPassword} /></Field>{recoveryError && <p className="auth-error" role="alert">{recoveryError}</p>}<Button disabled={recoveryBusy} type="submit">{recoveryBusy ? "Salvando…" : "Salvar nova senha"}</Button></form></div>
              : mode === "claim" ? <FirstAccessForm onLoginFailed={onLoginFailed} onLoginStart={onLoginStart} onMascotModeChange={setMascotMode} onReturn={returnToLogin} store={store} />
              : mode === "first-access" ? <PasswordlessCompletion store={store} /> : mode === "login"
              ? <LoginForm onLoginFailed={onLoginFailed} onLoginStart={onLoginStart} onSwitch={() => { setMascotMode("idle"); setMode("register"); }} onEmailGazeChange={setEmailGaze} onMascotModeChange={setMascotMode} store={store} />
              : <RegisterForm onSwitch={() => setMode("login")} store={store} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
