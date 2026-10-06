import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Icon } from "./shared.jsx";
import GuestMascot from "./GuestMascot.jsx";
import { useToast } from "./toast.js";
import { lookupCep, maskCep, maskDocument, maskPhone, validateEmail } from "./store.js";
import { supabaseCompleteRecovery, supabaseConsumeRecoveryLink, supabaseEnabled, supabaseSendPasswordReset, supabaseSignUp } from "./supabaseApi.js";

const DEMO_ACCOUNTS = [
  { name: "Mariana Costa", role: "Dono da empresa", email: "mariana@acme.com.br" },
  { name: "Rafael Lima", role: "TI", email: "rafael@acme.com.br" },
  { name: "Pedro Alves", role: "Funcionário", email: "pedro@acme.com.br" },
];
const recoveryFromLink = supabaseConsumeRecoveryLink();

function BrandPanel({ mascotMode = "idle", emailGaze = 0 }) {
  return (
    <aside aria-label="GesTI" className="auth-brand">
      <svg aria-hidden="true" className="auth-brand-divider" preserveAspectRatio="none" viewBox="0 0 100 1000">
        <path d="M100 0C52 160 16 335 16 500s36 340 84 500V0Z" fill="var(--paper)" />
        <path d="M100 0C52 160 16 335 16 500s36 340 84 500" fill="none" stroke="#07393c" strokeWidth="1.4" />
      </svg>
      <div className="auth-brand-inner">
        <div className="auth-brand-lockup"><span className="brand-mark brand-mark-lg">G</span><strong>GesTI</strong></div>
        <div className="auth-brand-main">
          <div className="auth-brand-copy"><h1>Sua operação<br />de TI.</h1><p>Acompanhe chamados, peças, custos e documentos da equipe.</p></div>
          <GuestMascot className="auth-mascot" gaze={emailGaze} mode={mascotMode} />
        </div>
        <div className="auth-brand-bottom"><span>Chamados <i /> Estoque <i /> Custos <i /> Documentos</span><p>Acesso da equipe da sua organização.</p></div>
      </div>
    </aside>
  );
}

function LoginForm({ store, onSwitch, onMascotModeChange, onEmailGazeChange }) {
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
    /* Pequeno atraso visual apenas para o estado "Verificando acesso…" aparecer. */
    try {
      const result = await new Promise((resolve) => window.setTimeout(() => resolve(store.login(email, password)), reduceMotion ? 0 : 350));
      if (result.ok) {
        notify({ tone: "success", message: `Bem-vindo(a) de volta, ${result.person.name}!`, title: result.company });
      } else {
        setError(result.error);
      }
    } catch (cause) {
      setError(cause.message || "Não foi possível validar o acesso neste navegador. Recarregue a página e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div animate={{ opacity: 1 }} className="auth-card" initial={reduceMotion ? false : { opacity: 0 }} transition={{ duration: 0.18 }}>
      <h2>Acesse sua conta</h2>
      <p className="auth-subtitle">Entre com o e-mail e a senha da sua conta.</p>
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
      <div className="auth-switch auth-switch-login"><span>Precisa cadastrar sua empresa?</span><button className="auth-register-button" onClick={onSwitch} type="button">Criar cadastro</button></div>
      <details className="demo-box">
        <summary>Acessar conta de demonstração</summary>
        <div className="demo-details"><small>Senha para os perfis de demonstração: <code>acme123</code></small>
          <div className="demo-accounts">{DEMO_ACCOUNTS.map((account) => <button key={account.email} onClick={() => { setEmail(account.email); setPassword("acme123"); setError(""); }} type="button"><strong>{account.role}</strong><span>{account.email}</span></button>)}</div>
        </div>
      </details>
    </motion.div>
  );
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
    setCepBusy(true);
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
      <p className="auth-subtitle">Crie o workspace da empresa. Você entra como administrador e convida a equipe depois.</p>
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
              <input inputMode="numeric" maxLength="9" name="cep" onChange={(event) => setCep(maskCep(event.target.value))} placeholder="00000-000" value={cep} />
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
            <input autoComplete="new-password" name="password" onChange={setAdminField} placeholder="Mínimo 6 caracteres" required type="password" value={admin.password} />
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
      <div className="auth-switch"><span>Sua empresa já tem cadastro?</span><button onClick={onSwitch} type="button">Fazer login</button></div>
    </motion.div>
  );
}

function InviteAcceptForm({ store, token, onBack }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    if (!validateEmail(email) || password.length < 8 || name.trim().length < 2) return setError("Informe nome, e-mail válido e senha com pelo menos 8 caracteres.");
    setBusy(true);
    const key = `tigest-pending-invite-${email.trim().toLowerCase()}`;
    try {
      window.localStorage.setItem(key, token);
      const signup = await supabaseSignUp(email.trim().toLowerCase(), password, name.trim());
      if (!signup.access_token) {
        setMessage("Conta criada. Confirme o e-mail e depois entre com o mesmo endereço e senha para concluir o convite.");
        return;
      }
      const result = await store.login(email, password);
      if (!result.ok) setError(result.error);
    } catch (cause) {
      setError(cause.message || "Não foi possível criar a conta. Se já tem conta, entre com ela para aceitar o convite.");
    } finally { setBusy(false); }
  };
  return <motion.div animate={{ opacity: 1 }} className="auth-card" initial={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    <h2>Convite para sua equipe</h2>
    <p className="auth-subtitle">Crie seu acesso GesTI com o mesmo e-mail para o qual o convite foi emitido.</p>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Seu nome"><input autoComplete="name" onChange={(event) => setName(event.target.value)} required value={name} /></Field>
      <Field label="E-mail convidado"><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></Field>
      <Field label="Crie uma senha"><input autoComplete="new-password" minLength={6} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></Field>
      {error && <p className="auth-error" role="alert"><Icon name="warning" size={14} /> {error}</p>}
      {message && <p className="auth-success" role="status">{message}</p>}
      <Button className="auth-submit" disabled={busy} type="submit">{busy ? "Criando acesso…" : "Aceitar convite"}</Button>
    </form>
    <div className="auth-switch"><span>Já possui conta?</span><button onClick={onBack} type="button">Fazer login</button></div>
  </motion.div>;
}

export default function AuthScreen({ store }) {
  const invitation = window.location.hash.match(/^#invite=([0-9a-f-]{36})$/i)?.[1] || "";
  const [mode, setMode] = useState(() => recoveryFromLink ? "recovery" : invitation ? "invite" : "login");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [mascotMode, setMascotMode] = useState("idle");
  const [emailGaze, setEmailGaze] = useState(0);
  return (
    <div className="auth-screen">
      <BrandPanel emailGaze={emailGaze} mascotMode={mascotMode} />
      <div className="auth-side">
        <div className="auth-mobile-brand"><span className="brand-mark">G</span><strong>GesTI</strong><GuestMascot className="auth-mobile-guest" gaze={emailGaze} mode={mascotMode} /></div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={mode} transition={{ duration: 0.16 }}>
            {mode === "recovery" ? <div className="auth-card"><h2>Definir nova senha</h2><p className="auth-subtitle">Use pelo menos 8 caracteres.</p><form className="auth-form" onSubmit={async (event) => { event.preventDefault(); setRecoveryBusy(true); setRecoveryError(""); try { await supabaseCompleteRecovery(recoveryPassword); setMode("login"); } catch (error) { setRecoveryError(error.message || "Não foi possível trocar a senha."); } finally { setRecoveryBusy(false); } }}><Field label="Nova senha"><input autoComplete="new-password" minLength={8} onChange={(event) => setRecoveryPassword(event.target.value)} required type="password" value={recoveryPassword} /></Field>{recoveryError && <p className="auth-error" role="alert">{recoveryError}</p>}<Button disabled={recoveryBusy} type="submit">{recoveryBusy ? "Salvando…" : "Salvar nova senha"}</Button></form></div>
              : mode === "invite" && invitation ? <InviteAcceptForm onBack={() => setMode("login")} store={store} token={invitation} /> : mode === "login"
              ? <LoginForm onSwitch={() => { setMascotMode("idle"); setMode("register"); }} onEmailGazeChange={setEmailGaze} onMascotModeChange={setMascotMode} store={store} />
              : <RegisterForm onSwitch={() => setMode("login")} store={store} />}
          </motion.div>
        </AnimatePresence>
        <p className="auth-foot">Acesso reservado à equipe da sua empresa.</p>
      </div>
    </div>
  );
}
