import { useState } from "react";
import { Icon } from "../shared.jsx";
import { ROLE_PERMISSIONS } from "../utils.js";

const labels = {
  viewCosts: "Ver custos e finanças",
  manageStock: "Gerenciar estoque",
  manageTickets: "Gerenciar chamados",
  claimTickets: "Assumir chamados",
  approve: "Aprovar despesas",
  manageCompany: "Alterar dados e identidade da empresa",
  managePeople: "Gerenciar pessoas",
  manageServices: "Gerenciar catálogo de serviços",
  clearLogs: "Limpar registros",
  backup: "Exportar dados",
  manageClients: "Gerenciar clientes",
  manageCalendar: "Criar e editar eventos",
  createTeamChats: "Criar conversas em grupo",
};

export default function RoleManager({
  roles,
  rolePermissions,
  onSave,
  disabled,
}) {
  const [name, setName] = useState("");
  const [sourceRole, setSourceRole] = useState("");
  const [checked, setChecked] = useState({});
  const duplicate = roles.some(
    (role) => role.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const chooseSource = (roleName) => {
    setSourceRole(roleName);
    setChecked(
      Object.fromEntries(
        (roleName
          ? rolePermissions[roleName] || ROLE_PERMISSIONS[roleName] || []
          : []
        ).map((capability) => [capability, true]),
      ),
    );
  };
  const create = async (event) => {
    event.preventDefault();
    const roleName = name.trim();
    if (roleName.length < 2 || roleName.length > 40 || duplicate) return;
    const saved = await onSave({
      name: roleName,
      capabilities: checked,
      existing: false,
    });
    if (saved) {
      setName("");
      setSourceRole("");
      setChecked({});
    }
  };

  return (
    <section className="panel role-manager">
      <div className="panel-heading">
        <div>
          <h2>Cargos e permissões</h2>
          <p>
            Crie um cargo novo do zero ou use outro cargo como modelo. Os cargos
            existentes não serão alterados.
          </p>
        </div>
        <span className="panel-icon">
          <Icon name="lock" />
        </span>
      </div>
      <form className="role-create-form" onSubmit={create}>
        <div className="role-create-fields">
          <label className="field">
            <span>Nome do novo cargo</span>
            <input
              autoComplete="off"
              maxLength="40"
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Financeiro"
              required
              value={name}
            />
          </label>
          <label className="field">
            <span>Começar com</span>
            <select
              onChange={(event) => chooseSource(event.target.value)}
              value={sourceRole}
            >
              <option value="">Sem permissões</option>
              {roles.map((role) => (
                <option key={role.name} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="role-capabilities">
          {Object.entries(labels).map(([key, label]) => (
            <label className="checkbox-field" key={key}>
              <input
                checked={checked[key] === true}
                disabled={disabled}
                onChange={(event) =>
                  setChecked((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {duplicate && name.trim() && (
          <p className="permission-note" role="status">
            Já existe um cargo com esse nome.
          </p>
        )}
        <div className="form-actions role-save-actions">
          <button
            className="button button-primary"
            disabled={disabled || name.trim().length < 2 || duplicate}
            type="submit"
          >
            <Icon name="plus" size={15} />
            Criar novo cargo
          </button>
        </div>
      </form>
    </section>
  );
}
