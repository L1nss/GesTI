import { useState } from "react";
import { Badge, Field, Icon, Modal, PageErrorBoundary, Reveal } from "../shared.jsx";
import { useToast } from "../toast.js";
import { ROLES, ROLE_PERMISSIONS } from "../utils.js";

const roleDescriptions = {
  Admin: "Configurações gerais e administração do sistema",
  "Dono da empresa": "Visão administrativa e aprovação de despesas",
  TI: "Atendimento técnico, inventário e suporte",
  "Gerência": "Acompanhamento de equipe e aprovações",
  Supervisor: "Supervisão de chamados e operação",
  "Funcionário": "Abertura e acompanhamento de solicitações",
};

/* Empresa e equipe: dados da organização, hierarquia e gestão de pessoas.
   Agora inclui troca da própria senha e reset de senha pela administração. */
export function CompanyPage({ company, people, canManageCompany, canManagePeople, onSave, onSaveBranding, onUpdateCapabilities, onToggleAvailability, removePerson, resetPassword, currentPerson }) {
  const notify = useToast();
  const [passwordModal, setPasswordModal] = useState(null); // null | "own" | personId
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [accessPerson, setAccessPerson] = useState(null);
  const capabilities = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];

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
    if (newPassword.length < 6) return setPasswordError("A senha deve ter pelo menos 6 caracteres.");
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
            <Field label="Telefone"><input disabled={!canManageCompany} inputMode="tel" name="phone" defaultValue={company.phone} onChange={(event) => { event.target.value = event.target.value; }} /></Field>
            <Field className="field-full" label="Endereço"><input disabled={!canManageCompany} name="address" defaultValue={company.address} /></Field>
            <Field className="field-full" label="Departamento responsável"><input disabled={!canManageCompany} name="department" defaultValue={company.department} /></Field>
            {canManageCompany && <div className="form-actions field-full"><button className="button button-primary" type="submit">Salvar dados</button></div>}
          </form>
          <p className="autosave-note"><span className="live-dot" /> {canManageCompany ? "Salve para atualizar notas fiscais e registros." : "Peça ao Admin ou ao Dono da empresa para alterar esses dados."}</p>
        </section>
        <section className="panel company-panel"><div className="panel-heading"><div><h2>Identidade visual</h2><p>Personalize a cor de destaque e o logo deste workspace.</p></div></div><form className="company-fields" onSubmit={onSaveBranding}><Field label="Cor principal"><input disabled={!canManageCompany} name="primaryColor" type="color" defaultValue={company.primaryColor || "#1b3b6f"} /></Field><Field className="field-full" label="URL do logo (opcional)"><input disabled={!canManageCompany} maxLength="500" name="logoUrl" placeholder="https://..." defaultValue={company.logoUrl || ""} /></Field>{canManageCompany && <div className="form-actions field-full"><button className="button button-primary" type="submit">Salvar identidade visual</button></div>}</form></section>
        <section className="panel hierarchy-panel"><div className="panel-heading"><div><h2>Hierarquia de acesso</h2><p>Responsabilidades organizacionais</p></div></div><ol className="hierarchy-list">{ROLES.map((item, index) => <li key={item}><span className="hierarchy-level">0{index + 1}</span><span className="hierarchy-role"><strong>{item}</strong><small>{roleDescriptions[item]}</small></span><span className="hierarchy-count">{people.filter((person) => person.role === item).length}</span></li>)}</ol><p className="hierarchy-footnote">Ordem: Admin → Dono da empresa → TI → Gerência → Supervisor → Funcionário.</p></section>
        <section className="panel team-panel"><div className="panel-heading"><div><h2>Pessoas e acessos</h2><p>{people.length} pessoas · login pelo e-mail corporativo</p></div>{canManagePeople && <Badge tone="blue">Gestão de equipe disponível</Badge>}</div><div className="table-scroll"><table><thead><tr><th>Nome</th><th>E-mail de login</th><th>Perfil</th><th>Disponibilidade</th><th>Capacidades</th><th>Senha</th>{canManagePeople && <th>Ações</th>}</tr></thead><tbody>{people.map((person) => <tr key={person.id}><td><span className="person-cell"><span className="avatar small-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="cell-title">{person.name}</span></span></td><td>{person.email}</td><td><Badge tone={person.role === "Admin" || person.role === "Dono da empresa" ? "violet" : "neutral"}>{person.role}</Badge></td><td>{person.role === "TI" ? <button className={`button ${person.available ? "button-primary" : "button-secondary"}`} onClick={() => onToggleAvailability(person)} type="button">{person.available ? "Disponível" : "Indisponível"}</button> : "—"}</td><td>{canManagePeople ? <button className="text-link" onClick={() => setAccessPerson(person)} type="button">Configurar</button> : Object.values(person.capabilities || {}).filter(Boolean).length ? "Personalizadas" : "Padrão do perfil"}</td><td><button className="text-link" onClick={() => setPasswordModal(isSelf(person.id) ? "own" : person.id)} type="button">{isSelf(person.id) ? "Trocar minha senha" : canManagePeople ? "Redefinir" : "—"}</button></td>{canManagePeople && <td>{isSelf(person.id) ? <span className="quiet-note">—</span> : <button className="text-link remove-link" onClick={() => { if (!window.confirm(`Remover o acesso de ${person.name}? Esta pessoa não conseguirá mais entrar.`)) return; removePerson(person.id); notify({ message: `${person.name} perdeu o acesso ao workspace.` }); }} type="button"><Icon name="close" size={14} /> Remover acesso</button>}</td>}</tr>)}</tbody></table></div>{!canManagePeople && <p className="permission-note">Somente Admin, Dono da empresa e Gerência podem gerenciar acessos.</p>}</section>
      </div></Reveal>
      {accessPerson && <Modal onClose={() => setAccessPerson(null)} title={`Capacidades · ${accessPerson.name}`}><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const changes = Object.fromEntries(capabilities.map((capability) => { const canGrant = canManageCompany || (ROLE_PERMISSIONS[role] || []).includes(capability) || currentPerson?.capabilities?.[capability] === true; const existing = accessPerson.capabilities?.[capability] ?? (ROLE_PERMISSIONS[accessPerson.role] || []).includes(capability); return [capability, canGrant ? data.get(capability) === "on" : existing]; })); const saved = await onUpdateCapabilities(accessPerson.id, changes); if (saved !== false) setAccessPerson(null); }}><p className="permission-note">Marque as capacidades efetivas. Só é possível conceder capacidades que você já possui.</p>{capabilities.map((capability) => { const canGrant = canManageCompany || (ROLE_PERMISSIONS[role] || []).includes(capability) || currentPerson?.capabilities?.[capability] === true; return <label className="checkbox-field" key={capability}><input defaultChecked={accessPerson.capabilities?.[capability] ?? (ROLE_PERMISSIONS[accessPerson.role] || []).includes(capability)} disabled={!canGrant} name={capability} type="checkbox" /><span>{capability}</span></label>; })}<div className="form-actions"><button className="button button-secondary" onClick={() => setAccessPerson(null)} type="button">Cancelar</button><button className="button button-primary" type="submit">Salvar capacidades</button></div></form></Modal>}
      {passwordModal && (
        <Modal onClose={closePasswordModal} title={passwordModal === "own" ? "Trocar minha senha" : "Redefinir senha de acesso"}>
          <form className="form-grid" onSubmit={submitPassword}>
            {passwordModal === "own" && <Field className="field-full" label="Senha atual"><input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></Field>}
            <Field className="field-full" label="Nova senha (mínimo 6 caracteres)"><input autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></Field>
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
