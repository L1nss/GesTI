import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { buildPixPayload, invoicePixReference } from "./pix.js";
import { sealInvoice, verifyLedger } from "./store.js";

function crc16(text) {
  let crc = 0xffff;
  for (const char of text) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("Pix BR Code", () => {
  it("gera payload com chave, valor fixo, recebedor, cidade, referência e CRC válido", () => {
    const payload = buildPixPayload({ key: "55996601385", amount: 125.5, merchantName: "Empresa Árvore", merchantCity: "São Paulo", reference: "NF001-1" });
    expect(payload).toContain("0014BR.GOV.BCB.PIX011155996601385");
    expect(payload).toContain("5406125.50");
    expect(payload).toContain("5802BR");
    expect(payload).toContain("5914EMPRESA ARVORE");
    expect(payload).toContain("6009SAO PAULO");
    expect(payload).toContain("0506NF0011");
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it("recusa chave ausente e cobrança sem valor positivo", () => {
    expect(() => buildPixPayload({ key: "", amount: 20 })).toThrow("chave Pix");
    expect(() => buildPixPayload({ key: "55996601385", amount: 0 })).toThrow("maior que zero");
  });

  it("renderiza o payload Pix como imagem de QR Code", async () => {
    const payload = buildPixPayload({ key: "55996601385", amount: 25, merchantName: "GesTI", merchantCity: "Brasilia", reference: "NF00011" });
    const image = await QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 224 });
    expect(image.startsWith("data:image/png;base64,")).toBe(true);
    expect(image.length).toBeGreaterThan(500);
  });

  it("cria referência curta a partir do número e série da nota", () => {
    expect(invoicePixReference({ number: "0007", series: "A/1" })).toBe("NF0007A1");
  });

  it("permite registrar recebimento sem invalidar o documento selado e protege o vencimento", () => {
    const invoice = { id: "NF-1", number: "0001", series: "1", createdAt: "2026-10-08", dueDate: "2026-11-07", customer: { name: "Cliente" }, items: [], subtotal: 100, issRate: 0, issValue: 0, shipping: 0, discount: 0, total: 100 };
    const sealed = { ...invoice, seal: sealInvoice(invoice, null) };
    expect(verifyLedger([{ ...sealed, paymentStatus: "Recebida", paidAt: "2026-10-10" }]).valid).toBe(true);
    expect(verifyLedger([{ ...sealed, dueDate: "2026-11-08" }]).valid).toBe(false);
  });
});
