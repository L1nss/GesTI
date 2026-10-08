import { useEffect, useState } from "react";
import { Icon } from "./shared.jsx";

function NavIcon({ name }) {
  const map = {
    "Visão geral": "grid",
    Chamados: "ticket",
    Equipe: "chat",
    Funcionários: "user",
    "Cargos da equipe": "sliders",
    Clientes: "users",
    Estoque: "box",
    Custos: "receipt",
    "Notas fiscais": "file",
    Registro: "list",
    Logs: "clipboard",
    Empresa: "building",
    Sobre: "info",
  };
  return <Icon className="nav-icon" name={map[name] || "info"} size={18} />;
}

/* Sidebar dirigida por HOVER no desktop: encostar na borda esquerda (ou na
   própria sidebar) abre; retirar o mouse fecha. No mobile o comportamento
   continua por toque, com backdrop e botão de menu no topo. */
export function SideBar({ aberta, aoFechar, aoEntrar, aoSair, paginaAtiva, aoNavegar, paginas, contagens, onNotificacoes, onLogout, empresaNome, backend }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryPages = paginas.filter((page) => ["Visão geral", "Chamados", "Estoque", "Custos"].includes(page));
  const secondaryPages = paginas.filter((page) => !primaryPages.includes(page));
  const secondaryActive = secondaryPages.includes(paginaAtiva);
  const showMore = moreOpen || secondaryActive;

  useEffect(() => {
    if (!aberta) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape" && window.innerWidth < 1024) aoFechar();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [aberta, aoFechar]);

  return (
    <>
      {/* Faixa invisível na borda esquerda (apenas desktop via CSS): dispara
          a abertura quando o mouse encosta na margem com o menu recolhido. */}
      {!aberta && aoEntrar && <div aria-hidden="true" className="sidebar-hover-strip" onMouseEnter={aoEntrar} />}
      {aberta && <button aria-label="Fechar menu" className="sidebar-backdrop" onClick={aoFechar} type="button" />}
      <aside className={`sidebar ${aberta ? "sidebar-open" : "sidebar-collapsed"}`} id="navegacao-principal" onMouseEnter={aoEntrar} onMouseLeave={aoSair}>
        <div className="sidebar-head">
          <a className="brand" href="#" onClick={(event) => { event.preventDefault(); aoNavegar("Visão geral"); }}>
            <img alt="" aria-hidden="true" className="brand-symbol" src="/gesti-mark-primary.png" />
            <span className="brand-name"><strong>Gesti</strong><small>{(empresaNome || "GESTÃO DE TI").toUpperCase().slice(0, 22)}</small></span>
          </a>
        </div>

        <div className="sidebar-label">ESPAÇO DE TRABALHO</div>
        <nav aria-label="Navegação principal">
          <ul className="sidebar-nav">
            {primaryPages.map((page) => (
              <li key={page}>
                <button
                  aria-current={paginaAtiva === page ? "page" : undefined}
                  className={`nav-item ${paginaAtiva === page ? "nav-item-active" : ""}`}
                  onClick={() => aoNavegar(page)}
                  title={page}
                  type="button"
                >
                  <NavIcon name={page} />
                  <span className="nav-text">{page}</span>
                  {contagens[page] > 0 && <span className="nav-badge">{contagens[page]}</span>}
                </button>
              </li>
            ))}
            {secondaryPages.length > 0 && <li>
              <button aria-controls="nav-mais" aria-expanded={showMore} className={`nav-item nav-more-toggle ${secondaryActive ? "nav-more-active" : ""}`} onClick={() => setMoreOpen((open) => !open)} title="Mais" type="button">
                <Icon className="nav-icon" name="list" size={18} />
                <span className="nav-text">Mais</span>
                {secondaryPages.reduce((count, page) => count + (contagens[page] || 0), 0) > 0 && <span className="nav-badge">{secondaryPages.reduce((count, page) => count + (contagens[page] || 0), 0)}</span>}
                <Icon className={`nav-more-chevron ${showMore ? "nav-more-chevron-open" : ""}`} name="chevron" size={14} />
              </button>
              {showMore && <ul className="sidebar-nav nav-sublist" id="nav-mais">
                {secondaryPages.map((page) => <li key={page}><button aria-current={paginaAtiva === page ? "page" : undefined} className={`nav-item ${paginaAtiva === page ? "nav-item-active" : ""}`} onClick={() => { setMoreOpen(false); aoNavegar(page); }} title={page} type="button"><NavIcon name={page} /><span className="nav-text">{page}</span>{contagens[page] > 0 && <span className="nav-badge">{contagens[page]}</span>}</button></li>)}
              </ul>}
            </li>}
          </ul>
        </nav>

        <div className="sidebar-foot">
          <button aria-label="Abrir central de alertas" className="support-card" onClick={onNotificacoes} title="Central de alertas" type="button">
            <span className="support-icon"><Icon name="bell" size={17} /></span>
            <span className="support-copy"><strong>Central de alertas</strong><small>Ver notificações</small></span>
            <span className="support-chevron"><Icon name="chevron" size={14} /></span>
          </button>
          <button className="logout-button sidebar-logout" onClick={onLogout} type="button"><Icon name="logout" size={15} /> Sair da conta</button>
          <span className="sidebar-version">GesTI · {backend === "supabase" ? "Conta conectada" : "Demonstração local"}</span>
        </div>
      </aside>
    </>
  );
}
