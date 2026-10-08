import { useEffect, useState } from "react";
import { Icon, Modal } from "./shared.jsx";

const NOTICE_COOKIE = "gesti_privacy_notice";
const NOTICE_STORAGE = "gesti-privacy-notice-v1";
const NOTICE_MAX_AGE = 60 * 60 * 24 * 90;
const OPEN_PRIVACY_EVENT = "gesti:open-privacy-center";
const PRIVACY_EMAIL = "gestigestaoempresarial@gmail.com";

function hasAcknowledgedNotice() {
  try { if (document.cookie.split(";").some((part) => part.trim() === NOTICE_COOKIE + "=accepted")) return true; } catch { /* cookies podem estar bloqueados */ }
  try { return ["accepted", "declined"].includes(window.localStorage.getItem(NOTICE_STORAGE)); } catch { return false; }
}

function rememberNotice(choice) {
  try { window.localStorage.setItem(NOTICE_STORAGE, choice); } catch { /* segue sem persistência */ }
  if (choice !== "accepted") return;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = NOTICE_COOKIE + "=accepted; Max-Age=" + NOTICE_MAX_AGE + "; Path=/; SameSite=Lax" + secure;
  } catch { /* o armazenamento alternativo mantém a preferência */ }
}

function forgetNotice() {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = NOTICE_COOKIE + "=; Max-Age=0; Path=/; SameSite=Lax" + secure;
  } catch { /* cookies podem estar bloqueados */ }
  try { window.localStorage.removeItem(NOTICE_STORAGE); } catch { /* segue sem persistência */ }
}

function PrivacySummary({ onOpenPolicy, onOpenCookies }) {
  return <aside aria-label="Resumo de privacidade" className="privacy-summary">
    <div className="privacy-summary-heading"><span className="privacy-summary-icon"><Icon name="lock" size={14}/></span><strong>Privacidade e dados</strong></div>
    <p>Nome, e-mail e informações da equipe são usados para manter o GesTI. Contas conectadas usam o Supabase; no modo local, os dados ficam neste navegador.</p>
    <div className="privacy-summary-actions">
      <button onClick={onOpenPolicy} type="button">Como usamos seus dados</button>
      <button onClick={onOpenCookies} type="button">Cookies</button>
    </div>
  </aside>;
}

function PolicyContent() {
  return <div className="privacy-modal-content">
    <p className="privacy-updated">Política de privacidade do GesTI · Atualizada em 7 de outubro de 2026.</p>

    <section>
      <h3>Quem trata os dados</h3>
      <p>A empresa responsável pelo GesTI controla os dados operacionais. Para exercer seus direitos ou tirar dúvidas sobre privacidade, fale com Ryan Dalcin Antunes pelo e-mail <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.</p>
    </section>

    <section>
      <h3>Quais dados e para quê</h3>
      <p>O GesTI pode tratar nome, e-mail profissional e credenciais para criar e proteger contas; dados da empresa e da equipe; e as informações inseridas em chamados, clientes, fornecedores, estoque, despesas, documentos fiscais, agenda e mensagens. Esses dados permitem autenticar usuários, organizar as rotinas de TI, aplicar permissões, manter registros de auditoria e dar suporte ao sistema.</p>
      <p>Erros técnicos podem registrar rota, mensagem e trecho de pilha de execução. O código tenta remover e-mails e valores identificados como senha, token ou segredo antes de enviar esses registros ao Supabase.</p>
    </section>

    <section>
      <h3>Onde ficam e como são protegidos</h3>
      <p>Nas contas conectadas, autenticação e registros da empresa são processados pelo Supabase. O GesTI envia as solicitações por HTTPS, e as permissões do banco limitam o acesso conforme a conta e a empresa.</p>
      <p>O navegador também guarda preferências e estado da interface. No modo local, os registros ficam no armazenamento local do navegador até serem apagados pelo usuário ou removidos ao limpar os dados do site. A sessão conectada usa armazenamento de sessão para os tokens de acesso; não usamos cookies próprios para guardar senha ou token de login.</p>
    </section>

    <section>
      <h3>Serviços externos</h3>
      <ul>
        <li>Supabase: autenticação, banco de dados e funções do GesTI.</li>
        <li>Vercel: hospedagem do site e entrega dos arquivos.</li>
        <li>Google Fonts: entrega das fontes usadas na interface.</li>
        <li>BrasilAPI e ViaCEP: recebem o CEP digitado no cadastro da empresa para preencher o endereço.</li>
        <li>Google Gemini: quando o assistente Guest está habilitado e é usado, recebe as perguntas e o contexto da empresa que o perfil do usuário pode consultar para gerar respostas.</li>
      </ul>
      <p>O GesTI não possui ferramentas próprias de publicidade ou análise de navegação nesta versão.</p>
      <p>Conforme a região escolhida e os contratos de cada fornecedor, pode haver tratamento de dados fora do Brasil. A empresa controladora deve manter as garantias e informações aplicáveis para essas transferências.</p>
    </section>

    <section>
      <h3>Cookies e armazenamento no navegador</h3>
      <p>O GesTI oferece um cookie funcional opcional, <code>{NOTICE_COOKIE}</code>, para lembrar por 90 dias sua escolha de aceitar o cookie de preferência deste aviso. Ele não identifica a pessoa. O cookie só é gravado após sua escolha afirmativa; você também pode continuar sem ele. Não há cookies de publicidade ou análise ativos.</p>
      <p>Além dos cookies, o site usa armazenamento local para preferências e, no modo local, registros do sistema; e armazenamento de sessão para manter o acesso conectado nesta sessão do navegador. O painel “Cookies” permite apagar a escolha sobre o aviso.</p>
    </section>

    <section>
      <h3>Prazo de retenção</h3>
      <p>Registros operacionais e logs com data de criação são mantidos por até três meses. No modo local, o GesTI remove registros vencidos quando o app é aberto; registros sem data reconhecida são preservados para evitar apagar dados sem identificar sua idade. Nas contas conectadas, uma rotina diária do banco remove registros vencidos. Dados necessários para manter uma conta empresarial ativa, como cadastro da empresa e acessos da equipe, permanecem enquanto a conta estiver ativa; após o encerramento, a empresa responsável solicita a exclusão e conclui a remoção em até três meses.</p>
      <p>Cópias de segurança administradas pelo Supabase seguem o ciclo de retenção do plano contratado e podem preservar dados até o vencimento desse ciclo. Exportações e cópias feitas fora do GesTI ficam sob responsabilidade da empresa que as criou.</p>
    </section>

    <section>
      <h3>Seus direitos</h3>
      <p>Você pode solicitar confirmação e acesso aos dados, correção, informação sobre compartilhamento e, quando aplicável, anonimização, bloqueio, eliminação, portabilidade ou revogação de consentimento. Envie seu pedido para <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.</p>
    </section>

    <p className="privacy-legal-reference">Referências: <a href="https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares" rel="noreferrer" target="_blank">direitos dos titulares (ANPD)</a> · <a href="https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais" rel="noreferrer" target="_blank">guia de cookies da ANPD</a> · <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" rel="noreferrer" target="_blank">Lei nº 13.709/2018</a>.</p>
  </div>;
}

function CookieContent({ onReset }) {
  return <div className="privacy-modal-content cookie-settings-content">
    <p>O armazenamento do app é necessário ao funcionamento do GesTI. O cookie opcional abaixo só é gravado se você aceitar. Não há cookies de publicidade ou análise.</p>
    <div className="cookie-category"><span className="cookie-toggle-on" aria-hidden="true"><i/></span><div><strong>Preferência do aviso</strong><p>O cookie {NOTICE_COOKIE} lembra por até 90 dias que você aceitou este cookie funcional. Se recusar, a escolha fica apenas no armazenamento local do navegador.</p></div><span className="cookie-optional">Opcional</span></div>
    <div className="cookie-category cookie-category-inactive"><span className="cookie-toggle-off" aria-hidden="true"><i/></span><div><strong>Análise e publicidade</strong><p>Não utilizadas pelo GesTI. Nenhum rastreador ou cookie dessas categorias foi configurado.</p></div><span className="cookie-not-used">Inativo</span></div>
    <button className="cookie-reset-button" onClick={onReset} type="button">Apagar minha escolha e mostrar o aviso novamente</button>
  </div>;
}

export default function PrivacyControls({ children, loginScreen = false }) {
  const [noticeVisible, setNoticeVisible] = useState(() => !hasAcknowledgedNotice());
  const [dialog, setDialog] = useState("");

  useEffect(() => {
    const open = () => setDialog("policy");
    window.addEventListener(OPEN_PRIVACY_EVENT, open);
    return () => window.removeEventListener(OPEN_PRIVACY_EVENT, open);
  }, []);

  const acknowledge = (choice) => {
    rememberNotice(choice);
    setNoticeVisible(false);
  };
  const resetChoice = () => {
    forgetNotice();
    setDialog("");
    setNoticeVisible(true);
  };

  return <div className={"privacy-controls" + (loginScreen ? " privacy-controls-auth" : " privacy-controls-app") + (noticeVisible ? " has-cookie-notice" : "")}>
    {children}
    {loginScreen
      ? <PrivacySummary onOpenCookies={() => setDialog("cookies")} onOpenPolicy={() => setDialog("policy")}/>
      : <button aria-label="Abrir privacidade e cookies" className="privacy-app-trigger" onClick={() => setDialog("policy")} type="button"><Icon name="lock" size={14}/> Privacidade</button>}
    {noticeVisible && <aside aria-label="Aviso sobre cookies" className="cookie-notice" role="region">
      <div className="cookie-notice-copy"><strong>Cookies e armazenamento</strong><p>O GesTI usa armazenamento local e de sessão para funcionar. Um cookie funcional opcional só será gravado se você aceitar. Não usamos cookies de publicidade ou análise.</p></div>
      <div className="cookie-notice-actions"><button className="cookie-notice-details" onClick={() => setDialog("cookies")} type="button">Detalhes</button><button className="cookie-notice-decline" onClick={() => acknowledge("declined")} type="button">Continuar sem cookie</button><button className="cookie-notice-ack" onClick={() => acknowledge("accepted")} type="button">Aceitar cookie</button></div>
    </aside>}
    {dialog && <Modal onClose={() => setDialog("")} title={dialog === "cookies" ? "Cookies e armazenamento" : "Privacidade e dados pessoais"} wide={dialog === "policy"}>
      {dialog === "cookies" ? <CookieContent onReset={resetChoice}/> : <PolicyContent/>}
    </Modal>}
  </div>;
}
