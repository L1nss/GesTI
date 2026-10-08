const PIX_GUI = "BR.GOV.BCB.PIX";

function field(id, value) {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, "0")}${text}`;
}

function cleanText(value, maxLength) {
  return String(value || "GesTI")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, maxLength) || "GESTI";
}

export function buildPixPayload({ key, amount, merchantName, merchantCity, reference }) {
  const pixKey = String(key || "").trim();
  const numericAmount = Number(amount);
  if (!pixKey || pixKey.length > 77) throw new Error("A chave Pix não é válida para o QR Code.");
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error("O valor da cobrança precisa ser maior que zero.");

  const merchantAccount = field("00", PIX_GUI) + field("01", pixKey);
  const additionalData = field("05", String(reference || "0").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 25) || "0");
  const payload = [
    field("00", "01"),
    field("26", merchantAccount),
    field("52", "0000"),
    field("53", "986"),
    field("54", numericAmount.toFixed(2)),
    field("58", "BR"),
    field("59", cleanText(merchantName, 25)),
    field("60", cleanText(merchantCity, 15)),
    field("62", additionalData),
    "6304",
  ].join("");

  let crc = 0xffff;
  for (const char of payload) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return `${payload}${crc.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function invoicePixReference(invoice) {
  return `NF${invoice.number || ""}${invoice.series || ""}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25) || "0";
}
