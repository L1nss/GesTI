import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useToast } from "./toast.js";
import { money } from "./utils.js";
import { buildPixPayload, invoicePixReference } from "./pix.js";

export default function PixPayment({ company, invoice }) {
  const notify = useToast();
  const [qrState, setQrState] = useState({ payload: "", image: "", error: "" });
  const merchantCity = company.city
    || String(company.address || "").split(",").at(-1)?.split("-")[0]?.trim()
    || "BRASILIA";
  const payload = useMemo(() => buildPixPayload({
    key: "55996601385",
    amount: invoice.total,
    merchantName: company.name,
    merchantCity,
    reference: invoicePixReference({ number: invoice.number, series: invoice.series }),
  }), [company.name, invoice.number, invoice.series, merchantCity, invoice.total]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 224 })
      .then((image) => { if (active) setQrState({ payload, image, error: "" }); })
      .catch(() => { if (active) setQrState({ payload, image: "", error: "Não foi possível gerar o QR Code neste documento." }); });
    return () => { active = false; };
  }, [payload]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      notify({ title: "Pix copia e cola copiado", message: "Cole o código no app do banco para conferir os dados antes de pagar.", tone: "success" });
    } catch {
      notify({ title: "Não foi possível copiar", message: "Selecione e copie o código Pix manualmente.", tone: "info" });
    }
  };

  const qrImage = qrState.payload === payload ? qrState.image : "";
  const error = qrState.payload === payload ? qrState.error : "";

  return (
    <section className="nf-pix" aria-label="Pagamento por Pix">
      <div className="nf-pix-copy">
        <span className="nf-block-label">PAGAMENTO POR PIX</span>
        <strong>Escaneie para pagar {money(invoice.total)}</strong>
        <p>Confira o recebedor e o valor no app do banco antes de confirmar. O GesTI não recebe confirmação automática do pagamento.</p>
        <small>Chave Pix: 55996601385 · Referência: {invoicePixReference(invoice)}</small>
        {error && <small role="status">{error}</small>}
        <button className="nf-pix-copy-button" onClick={copyCode} type="button">Copiar código Pix</button>
      </div>
      {qrImage && <img alt={`QR Code Pix de ${money(invoice.total)}`} className="nf-pix-qr" src={qrImage} />}
    </section>
  );
}
