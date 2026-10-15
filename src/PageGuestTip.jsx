import { useEffect, useState } from "react";
import GuestSpeech from "./GuestSpeech.jsx";

const pageTips = {
  Chamados: { label: "CHAMADOS", message: "Por aqui você acompanha prioridades, prazos e cada atendimento. Use “Novo chamado” para registrar uma solicitação." },
  Estoque: { label: "ESTOQUE", message: "Aqui você controla componentes e níveis mínimos. Cadastre itens e fornecedores para acompanhar reposições." },
  Custos: { label: "CUSTOS", message: "Neste espaço ficam compras, despesas e aprovações. Confira o que está pendente e mantenha os gastos sob controle." },
};

export default function PageGuestTip({ organizationId, userId, page }) {
  const tip = pageTips[page];
  const storageKey = `gesti-guest-tip-v1-${organizationId}-${userId}-${page}`;
  const [visible, setVisible] = useState(() => {
    if (!tip) return false;
    try { return window.localStorage.getItem(storageKey) !== "seen"; }
    catch { return true; }
  });

  useEffect(() => {
    if (!visible || !tip) return;
    try { window.localStorage.setItem(storageKey, "seen"); }
    catch { /* A dica continua disponível nesta sessão se o armazenamento estiver bloqueado. */ }
  }, [storageKey, tip, visible]);

  if (!visible || !tip) return null;
  return <GuestSpeech message={tip.message} onDismiss={() => setVisible(false)} paperLabel={tip.label} variant="tip" />;
}
