import { PageErrorBoundary, Reveal, Icon } from "../shared.jsx";

/* Página institucional com valores e contatos da empresa. */
export function AboutPage({ company }) {
  const values = [
    { number: "01", text: "Cada solicitação tem categoria, prioridade, responsável e histórico de status.", title: "Atendimento com contexto" },
    { number: "02", text: "Componentes e níveis mínimos ajudam a equipe a se antecipar às reposições.", title: "Patrimônio visível" },
    { number: "03", text: "Gráficos de gastos e notas fiscais conectam o custo ao serviço prestado.", title: "Finanças transparentes" },
  ];
  return (
    <PageErrorBoundary>
      <div className="about-layout">
        <Reveal>
          <section className="about-hero">
            <div className="about-copy">
              <span className="eyebrow light-eyebrow">TECNOLOGIA A SERVIÇO DAS PESSOAS</span>
              <h2>Um TI organizado deixa a empresa seguir em frente.</h2>
              <p>O GesTI reúne atendimento, equipamentos, custos e faturamento em um só lugar, com responsabilidades claras em cada etapa.</p>
              <a className="about-cta" href={`mailto:${company.email}`}>Fale com a equipe <Icon name="arrow" size={16} /></a>
            </div>
            <div className="media-cell"><div className="about-orb"><Icon name="chart" size={34} /></div></div>
          </section>
        </Reveal>
        <div className="about-values">
          {values.map((item) => (
            <Reveal delay={Number(item.number) * 0.05} key={item.number}>
              <article>
                <span className="value-number">{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.06}>
          <section className="contact-card">
            <div><span className="eyebrow">FALE CONOSCO</span><h2>Conte com a equipe de TI</h2><p>Para suporte interno, abra um chamado. Para dúvidas institucionais, use os contatos da empresa.</p></div>
            <div className="contact-details">
              <a href={`mailto:${company.email}`}><span>E-mail</span><strong>{company.email}</strong></a>
              <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}><span>Telefone</span><strong>{company.phone}</strong></a>
              <span><span>Endereço</span><strong>{company.address}</strong></span>
            </div>
          </section>
        </Reveal>
      </div>
    </PageErrorBoundary>
  );
}
