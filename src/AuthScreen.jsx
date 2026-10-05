import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Icon } from "./shared.jsx";
import { useToast } from "./toast.js";
import { lookupCep, maskCep, maskDocument, maskPhone, validateEmail } from "./store.js";
import { supabaseSignUp } from "./supabaseApi.js";

const DEMO_ACCOUNTS = [
  { name: "Mariana Costa", role: "Dono da empresa", email: "mariana@acme.com.br" },
  { name: "Rafael Lima", role: "TI", email: "rafael@acme.com.br" },
  { name: "Pedro Alves", role: "Funcionário", email: "pedro@acme.com.br" },
];

function BrandPanel() {
  const points = [
    { icon: "building", title: "Cada empresa com seu espaço", text: "Cadastro próprio, equipe e dados isolados." },
    { icon: "chart", title: "Custos sob controle", text: "Gráficos de gastos por mês e por categoria." },
    { icon: "file", title: "Nota fiscal integrada", text: "Emissão e impressão direto pelo sistema." },
  ];
  return (
    <div className="auth-brand">
      <div aria-hidden="true" className="auth-brand-aurora"><span /><span /><span /></div>
      <div className="auth-brand-inner">
        <span className="brand-mark brand-mark-lg">G</span>
        <h1><strong>GesTI</strong><em>Gestão de TI multiempresa</em></h1>
        <ul>
          {points.map((point) => (
            <li key={point.title}>
              <span className="auth-point-icon"><Icon name={point.icon} size={16} /></span>
              <span className="auth-point-copy"><strong>{point.title}</strong><small>{point.text}</small></span>
            </li>
          ))}
        </ul>
        <p className="auth-brand-note">Sessão isolada por empresa · Armazenamento local ou Supabase</p>
      </div>
    </div>
  );
}

function LoginForm({ store, onSwitch }) {
  const notify = useToast();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    <motion.div animate={{ opacity: 1, y: 0 }} className="auth-card" initial={reduceMotion ? false : { opacity: 0, y: 18 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <h2>Entrar na sua empresa</h2>
      <p className="auth-subtitle">Acesse com o e-mail corporativo cadastrado pela sua organização.</p>
      <form className="auth-form" onSubmit={submit}>
        <Field label="E-mail corporativo">
          <input autoComplete="username" name="email" onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com.br" required type="email" value={email} />
        </Field>
        <Field label="Senha">
          <div className="password-wrap">
            <input autoComplete="current-password" name="password" onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required type={showPassword ? "text" : "password"} value={password} />
            <button aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="password-eye" onClick={() => setShowPassword((current) => !current)} type="button"><Icon name={showPassword ? "eyeOff" : "eye"} size={16} /></button>
          </div>
        </Field>
        {error && <p className="auth-error" role="alert"><Icon name="warning" size={14} /> {error}</p>}
        <Button busy={busy} className="auth-submit" disabled={busy} type="submit">
          {busy ? <><Icon className="spin" name="spinner" size={17} /> Verificando acesso…</> : <><Icon name="arrow" size={16} /> Entrar no workspace</>}
        </Button>
      </form>
      <div className="auth-switch"><span>Ainda não tem conta da sua empresa?</span><button onClick={onSwitch} type="button">Cadastrar empresa</button></div>
      <div className="demo-box">
        <strong>Conta demonstrativa da Acme Tecnologia</strong>
        <small>Senha única para todos os perfis: <code>acme123</code></small>
        <div className="demo-accounts">
          {DEMO_ACCOUNTS.map((account) => (
            <button key={account.email} onClick={() => { setEmail(account.email); setPassword("acme123"); setError(""); }} type="button">
              <span className="avatar small-avatar">{account.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
              <span><strong>{account.role}</strong><small>{account.email}</small></span>
              <Icon name="chevron" size={14} />
            </button>
          ))}
        </div>
      </div>
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
    if (admin.password.length < 6) return setError("A senha deve ter pelo menos 6 caracteres.");
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
    if (!validateEmail(email) || password.length < 6 || name.trim().length < 2) return setError("Informe nome, e-mail válido e senha com pelo menos 6 caracteres.");
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
  return <motion.div animate={{ opacity: 1, y: 0 }} className="auth-card" initial={{ opacity: 0, y: 18 }} transition={{ duration: 0.35 }}>
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
  const [mode, setMode] = useState(() => invitation ? "invite" : "login");
  return (
    <div className="auth-screen">
      <BrandPanel />
      <div className="auth-side">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div animate={{ opacity: 1, x: 0 }} exit={mode === "login" ? { opacity: 0, x: -18 } : { opacity: 0, x: 18 }} initial={{ opacity: 0, x: 18 }} key={mode} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            {mode === "invite" && invitation ? <InviteAcceptForm onBack={() => setMode("login")} store={store} token={invitation} /> : mode === "login"
              ? <LoginForm onSwitch={() => setMode("register")} store={store} />
              : <RegisterForm onSwitch={() => setMode("login")} store={store} />}
          </motion.div>
        </AnimatePresence>
        <p className="auth-foot">GesTI · Contas demonstrativas usam armazenamento local; novas empresas e convites usam Supabase.</p>
      </div>
    </div>
  );
}
