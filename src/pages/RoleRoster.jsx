import { useEffect, useMemo, useState } from "react";
import { Icon } from "../shared.jsx";
import { restSelect } from "../supabaseApi.js";

export default function RoleRoster({ companyId, roles = [], people = [], remoteAuth = false }) {
  const [directory, setDirectory] = useState(() => people.map(({ id, name, role }) => ({ id, name, role })));
  useEffect(() => {
    if (!remoteAuth) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const members = await restSelect("company_directory", `company_id=eq.${companyId}&order=display_name.asc`);
        if (active) setDirectory(members.map(({ user_id, display_name, role }) => ({ id: user_id, name: display_name, role })));
      } catch { /* Exibe os nomes que já estão disponíveis nesta sessão. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12000);
    return () => { active = false; window.clearInterval(timer); };
  }, [companyId, remoteAuth, people]);
  const visibleDirectory = remoteAuth ? directory : people;
  const roleNames = useMemo(() => [...new Set([...roles.map((item) => item.name), ...visibleDirectory.map((item) => item.role)])], [roles, visibleDirectory]);
  return <section className="panel role-roster"><div className="panel-heading"><div><h2>Cargos da equipe</h2><p>Cargos cadastrados e pessoas que fazem parte de cada um.</p></div><span className="panel-icon"><Icon name="users"/></span></div>
    <div className="role-roster-list">{roleNames.map((name) => {
      const members = visibleDirectory.filter((person) => person.role === name);
      return <article className="role-roster-item" key={name}><div className="role-roster-heading"><strong>{name}</strong><span>{members.length}</span></div>{members.length ? <ul>{members.map((person) => <li key={person.id}><span className="avatar small-avatar">{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span>{person.name}</span></li>)}</ul> : <p>Ninguém atribuído a este cargo.</p>}</article>;
    })}</div>
  </section>;
}
