import { useState } from "react";
import { Field, Icon } from "../shared.jsx";

export default function EmployeeRegistration({ companyName, onSubmit, people, remoteAuth, roles }) {
  const [passwordMode, setPasswordMode] = useState(remoteAuth ? "first-login" : "admin-assigned");
  const [accessCode, setAccessCode] = useState("");
  const [copied, setCopied] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setAccessCode(""); setCopied(false);
    const result = await onSubmit(event);
    if (result?.accessCode) { setAccessCode(result.accessCode); form.reset(); return; }
    if (result === true) form.reset();
  };
  const copyAccessCode = async () => {
    try { await navigator.clipboard.writeText(accessCode); setCopied(true); } catch { setCopied(false); }
  };
  return <div className="employee-registration">
    <section className="panel employee-registration-card">
      <div className="panel-heading"><div><h2>Novo funcionário</h2><p>O acesso ficará vinculado à equipe de {companyName}.</p></div><span className="panel-icon"><Icon name="users"/></span></div>
      <form className="form-grid" onSubmit={submit}>
        <Field className="field-full" label="Nome completo"><input autoComplete="name" maxLength="120" name="name" required /></Field>
        <Field className="field-full" label="E-mail de acesso"><input autoComplete="email" name="email" required type="email" /></Field>
        <Field className="field-full" label="Cargo"><select name="role">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></Field>
        {remoteAuth && <Field className="field-full" label="Como será definida a senha?"><select name="password_mode" onChange={(event) => setPasswordMode(event.target.value)} value={passwordMode}><option value="first-login">Funcionário cria no primeiro acesso com código</option><option value="admin-assigned">Definida pelo administrador</option></select></Field>}
        {passwordMode === "first-login" && remoteAuth ? <div className="employee-access-note field-full"><Icon name="info" size={16}/><span>Nenhum e-mail será enviado. Depois do cadastro, entregue o código de uso único ao funcionário para que ele crie a própria senha.</span></div> : <><Field className="field-full" label="Senha inicial"><input autoComplete="new-password" maxLength="72" minLength="8" name="password" required type="password" /></Field><Field className="field-full" label="Confirmar senha"><input autoComplete="new-password" maxLength="72" minLength="8" name="confirm_password" required type="password" /></Field>{remoteAuth && <div className="employee-access-note field-full"><Icon name="lock" size={16}/><span>O funcionário entrará pela tela normal de login usando este e-mail e a senha inicial definida aqui.</span></div>}</>}
        <button className="button button-primary field-full" type="submit"><Icon name="plus" size={16}/>{passwordMode === "first-login" && remoteAuth ? "Cadastrar e gerar código" : "Cadastrar funcionário"}</button>
      </form>
      {accessCode && <div className="employee-claim-code" role="status"><div><strong>Código de primeiro acesso</strong><p>Entregue este código ao funcionário. Ele vale por 24 horas e só pode ser usado uma vez.</p></div><code>{accessCode.match(/.{1,4}/g)?.join(" ")}</code><button className="button button-secondary" onClick={copyAccessCode} type="button"><Icon name={copied ? "check" : "copy"} size={15}/>{copied ? "Copiado" : "Copiar código"}</button></div>}
    </section>
    <section className="panel employee-team-card">
      <div className="panel-heading"><div><h2>Equipe da empresa</h2><p>{people.length} pessoa(s) com acesso a {companyName}.</p></div><span className="panel-icon"><Icon name="building"/></span></div>
      <div className="employee-team-list">{people.map((person) => <div className="employee-team-row" key={person.id}><span className="avatar small-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{person.name}</strong><small>{person.role}</small></span></div>)}</div>
    </section>
  </div>;
}
