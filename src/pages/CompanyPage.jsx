import { useState } from "react";
import { Badge, Field, Icon, Modal, PageErrorBoundary, Reveal } from "../shared.jsx";
import { useToast } from "../toast.js";
import { ROLES } from "../utils.js";
import RoleManager from "./RoleManager.jsx";
import RoleRoster from "./RoleRoster.jsx";

/* Empresa e equipe: dados da organização, identidade visual, cargos e acessos. */
export function CompanyPage({ company, companyId, people, canManageCompany, canManagePeople, onSave, onSaveBranding, onResetBranding, onSaveRole, roleCatalog = [], rolePermissions = {}, onSetRole, onToggleAvailability, removePerson, resetPassword, currentPerson, remoteAuth = false }) {
  const notify = useToast();
  const [passwordModal, setPasswordModal] = useState(null); // null | "own" | personId
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [brandingFormVersion, setBrandingFormVersion] = useState(0);
  const roles = roleCatalog.length ? roleCatalog : ROLES.map((name) => ({ name, isDefault: true }));

  const selfEmail = currentPerson?.email || "";
  const isSelf = (personId) => people.find((person) => person.id === personId)?.email === selfEmail;

  const closePasswordModal = () => {
    setPasswordModal(null);
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordError("");
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) return setPasswordError("As senhas não coincidem.");
    if (newPassword.length < 8) return setPasswordError("A senha deve ter pelo menos 8 caracteres.");
    if (passwordModal === "own") {
      const result = await resetPassword("own", currentPassword, newPassword);
      if (!result.ok) return setPasswordError(result.error);
      notify({ tone: "success", message: "Sua senha foi atualizada.", title: "Senha alterada" });
    } else {
      const target = people.find((person) => person.id === passwordModal);
      const result = await resetPassword(passwordModal, "", newPassword);
      if (!result.ok) return setPasswordError(result.error);
      notify({ tone: "success", message: `Senha de ${target?.name || "pessoa"} redefinida. Compartilhe o valor provisório com segurança.`, title: "Senha redefinida" });
    }
    closePasswordModal();
  };

  return (
    <PageErrorBoundary>
      <Reveal><div className="company-layout">
        <section className="panel company-panel">
          <div className="panel-heading"><div><h2>Dados da organização</h2><p>Usados nas notas fiscais e registros internos</p></div><Badge tone={canManageCompany ? "green" : "neutral"}>{canManageCompany ? "Edição habilitada" : "Somente leitura"}</Badge></div>
          <form className="company-fields" onSubmit={onSave}>
            <Field label="Razão social / nome"><input disabled={!canManageCompany} name="name" defaultValue={company.name} required /></Field>
            <Field label="CNPJ"><input disabled={!canManageCompany} inputMode="numeric" name="document" defaultValue={company.document} required /></Field>
            <Field label="E-mail de contato"><input disabled={!canManageCompany} name="email" defaultValue={company.email} type="email" /></Field>
            <Field label="Telefone"><input disabled={!canManageCompany} inputMode="tel" name="phone" defaultValue={company.phone} /></Field>
            <Field className="field-full" label="Endereço"><input disabled={!canManageCompany} name="address" defaultValue={company.address} /></Field>
            <Field className="field-full" label="Departamento responsável"><input disabled={!canManageCompany} name="department" defaultValue={company.department} /></Field>
            {canManageCompany && <div className="form-actions field-full"><button className="button button-primary" type="submit">Salvar dados</button></div>}
          </form>
          <p className="autosave-note"><span className="live-dot" /> {canManageCompany ? "Salve para atualizar notas fiscais e registros." : "Peça ao Admin ou ao Dono da empresa para alterar esses dados."}</p>
        </section>
        <section className="panel company-panel"><div className="panel-heading"><div><h2>Identidade visual</h2><p>Personalize as cores e o logo deste workspace.</p></div></div><form className="company-fields" key={brandingFormVersion} onSubmit={onSaveBranding}><Field label="Cor principal"><input disabled={!canManageCompany} name="primaryColor" type="color" defaultValue={company.primaryColor || "#2c666e"} /></Field><Field label="Fundo da página"><input disabled={!canManageCompany} name="backgroundColor" type="color" defaultValue={company.backgroundColor || "#f4f7f4"} /></Field><Field label="Fundo dos cartões"><input disabled={!canManageCompany} name="surfaceColor" type="color" defaultValue={company.surfaceColor || "#ffffff"} /></Field><Field label="Cor do texto"><input disabled={!canManageCompany} name="textColor" type="color" defaultValue={company.textColor || "#1f363d"} /></Field><Field className="field-full" label="URL do logo (opcional)"><input disabled={!canManageCompany} maxLength="500" name="logoUrl" placeholder="https://..." defaultValue={company.logoUrl || ""} /></Field>{canManageCompany && <div className="form-actions field-full"><button className="button button-primary" type="submit">Salvar identidade visual</button><button className="button button-secondary" onClick={() => { onResetBranding(); setBrandingFormVersion((version) => version + 1); }} type="button">Redefinir ao padrão</button></div>}</form></section>
        <div className="role-settings-row"><RoleManager disabled={!canManageCompany} onSave={onSaveRole} roles={roles} rolePermissions={rolePermissions}/><RoleRoster companyId={companyId} people={people} remoteAuth={remoteAuth} roles={roles}/></div>
        <section className="panel team-panel"><div className="panel-heading"><div><h2>Pessoas e acessos</h2><p>{people.length} pessoas · login pelo e-mail corporativo</p></div>{canManagePeople && <Badge tone="blue">Gestão de equipe disponível</Badge>}</div><div className="table-scroll"><table><thead><tr><th>Nome</th><th>E-mail de login</th><th>Perfil</th><th>Disponibilidade</th><th>Senha</th>{canManagePeople && <th>Ações</th>}</tr></thead><tbody>{people.map((person) => <tr key={person.id}><td><span className="person-cell"><span className="avatar small-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="cell-title">{person.name}</span></span></td><td>{person.email}</td><td>{canManageCompany && !isSelf(person.id) ? <select aria-label={`Cargo de ${person.name}`} onChange={(event)=>onSetRole(person.id,event.target.value)} value={person.role}><option value={person.role}>{person.role}</option>{roles.filter((item)=>item.name!==person.role).map((item)=><option key={item.name}>{item.name}</option>)}</select> : <Badge tone={person.role === "Admin" || person.role === "Dono" || person.role === "Dono da empresa" ? "violet" : "neutral"}>{person.role}</Badge>}</td><td>{person.role === "TI" ? <button className={`button ${person.available ? "button-primary" : "button-secondary"}`} onClick={() => onToggleAvailability(person)} type="button">{person.available ? "Disponível" : "Indisponível"}</button> : "—"}</td><td>{isSelf(person.id) || (canManagePeople && !remoteAuth) ? <button className="text-link" onClick={() => setPasswordModal(isSelf(person.id) ? "own" : person.id)} type="button">{isSelf(person.id) ? "Trocar minha senha" : "Redefinir"}</button> : "—"}</td>{canManagePeople && <td>{isSelf(person.id) ? <span className="quiet-note">—</span> : <button className="text-link remove-link" onClick={() => { if (!window.confirm(`Remover o acesso de ${person.name}? Esta pessoa não conseguirá mais entrar.`)) return; removePerson(person.id); notify({ message: `${person.name} perdeu o acesso ao workspace.` }); }} type="button"><Icon name="close" size={14} /> Remover acesso</button>}</td>}</tr>)}</tbody></table></div>{!canManagePeople && <p className="permission-note">Somente pessoas com permissão de gestão podem gerenciar acessos.</p>}</section>
      </div></Reveal>
      {passwordModal && (
        <Modal onClose={closePasswordModal} title={passwordModal === "own" ? "Trocar minha senha" : "Redefinir senha de acesso"}>
          <form className="form-grid" onSubmit={submitPassword}>
            {passwordModal === "own" && <Field className="field-full" label="Senha atual"><input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></Field>}
            <Field className="field-full" label="Nova senha (mínimo 8 caracteres)"><input autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></Field>
            <Field className="field-full" label="Confirmar nova senha"><input autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></Field>
            {passwordError && <p className="auth-error" role="alert"><Icon name="warning" size={14} /> {passwordError}</p>}
            <div className="form-actions">
              <button className="button button-secondary" onClick={closePasswordModal} type="button">Cancelar</button>
              <button className="button button-primary" type="submit"><Icon name="lock" size={15} /> Salvar senha</button>
            </div>
          </form>
        </Modal>
      )}
    </PageErrorBoundary>
  );
}
