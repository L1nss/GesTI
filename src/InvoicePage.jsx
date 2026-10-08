import { useEffect, useMemo, useState } from "react";
import GuestMascot from "./GuestMascot.jsx";
import { logEvent, lookupCep, maskCep, maskDocument, maskPhone, sealInvoice, verifyLedger, validateCellphone, validateCnpj, validateCpf, validateEmail } from "./store.js";
import { Badge, Button, CountUp, EmptyState, Field, Icon, Modal, Reveal } from "./shared.jsx";
import { useToast } from "./toast.js";
import { downloadCsv as exportCsv, longDate, money, nextId, shortDate, today } from "./utils.js";
import PixPayment from "./PixPayment.jsx";

const ISS_OPTIONS = [0, 2, 3, 5];
const defaultDueDate = () => {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() + 30);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/* ------------------------- geração de objeto da nota ------------------------- */

function buildInvoice({ form, items, company, issuer, invoiceNumber, series }) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const issValue = (subtotal * (Number(form.issRate) || 0)) / 100;
  const total = subtotal + (Number(form.shipping) || 0) - (Number(form.discount) || 0) + issValue;
  return {
    id: nextId("NF", company.invoices || []),
    number: invoiceNumber,
    series,
    createdAt: today(),
    dueDate: form.dueDate,
    paymentStatus: form.status === "Emitida" ? "A receber" : "—",
    issuer: issuer.name,
    issuerRole: issuer.role,
    status: form.status,
    customer: {
      name: form.customerName, document: form.customerDocument,
      email: form.customerEmail, address: form.customerAddress, phone: form.customerPhone,
    },
    ...(form.customerId ? { customerId: form.customerId } : {}),
    ticketId: form.ticketId || null,
    description: form.description,
    items,
    subtotal, issRate: Number(form.issRate) || 0, issValue,
    shipping: Number(form.shipping) || 0, discount: Number(form.discount) || 0, total,
  };
}

/* Numeração sequencial por série: usa a última nota da mesma série.
   (Antes era sempre "0001", gerando notas com número repetido.) */
function nextInvoiceNumber(invoices, series) {
  const sameSeries = (invoices || []).filter((invoice) => String(invoice.series || "") === String(series));
  const highest = sameSeries.reduce((current, invoice) => Math.max(current, Number(invoice.number) || 0), 0);
  return String(highest + 1).padStart(4, "0");
}

/* ------------------------------ modal emissor ------------------------------ */

function InvoiceBuilder({ company, currentPerson, inventory, services, tickets, clients = [], onClose, onCreate, issuing = false }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    customerName: "", customerDocument: "", customerEmail: "", customerAddress: "", customerPhone: "",
    description: "", issRate: 0, shipping: "", discount: "", status: "Emitida", ticketId: "", dueDate: defaultDueDate(),
  });
  const [items, setItems] = useState([{ id: 1, inventoryId: "", serviceId: "", stock: null, name: "", quantity: 1, unit: "un", unitPrice: "" }]);
  const [cep, setCep] = useState("");
  const [addressState, setAddressState] = useState({ loading: false, error: "" });

  const setField = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value, ...(event.target.name.startsWith("customer") ? { customerId: "" } : {}) }));
  const selectCustomer = (event) => {
    const client = clients.find((item) => item.id === event.target.value);
    if (!client) { setForm((current) => ({ ...current, customerId: "" })); return; }
    setForm((current) => ({ ...current, customerId: client.id, customerName: client.name || "", customerDocument: client.document || "", customerEmail: client.email || "", customerPhone: client.phone || "", customerAddress: client.address || client.notes || "" }));
  };
  const selectTicket = (event) => {
    const ticketId = event.target.value;
    const ticket = tickets.find((item) => item.id === ticketId);
    const client = ticket ? clients.find((item) => item.id === ticket.customerId || String(item.name).toLowerCase() === String(ticket.customerName || "").toLowerCase()) : null;
    setForm((current) => ({ ...current, ticketId, ...(ticket ? (client ? { customerId: client.id || "", customerName: client.name || "", customerDocument: client.document || "", customerEmail: client.email || "", customerPhone: client.phone || "", customerAddress: client.address || "" } : { customerId: "", customerName: ticket.customerName || "", customerDocument: "", customerEmail: "", customerPhone: "", customerAddress: "" }) : {}) }));
  };

  const setItem = (id, patch) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const addItem = () => setItems((current) => [...current, { id: Date.now(), inventoryId: "", serviceId: "", name: "", quantity: 1, unit: "un", unitPrice: "" }]);
  const removeItem = (id) => setItems((current) => (current.length > 1 ? current.filter((item) => item.id !== id) : current));

  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const issValue = (subtotal * (Number(form.issRate) || 0)) / 100;
  const total = subtotal + (Number(form.shipping) || 0) - (Number(form.discount) || 0) + issValue;

  /* Valida CPF (11 dígitos) ou CNPJ (14 dígitos) pelos dígitos verificadores. */
  const docState = useMemo(() => {
    const digits = form.customerDocument.replace(/\D/g, "");
    if (digits.length === 11) {
      return validateCpf(digits)
        ? { state: "ok", message: "CPF válido" }
        : { state: "error", message: "CPF inválido — confira os dígitos." };
    }
    if (digits.length === 14) {
      return validateCnpj(digits)
        ? { state: "ok", message: "CNPJ válido" }
        : { state: "error", message: "CNPJ inválido — confira os dígitos." };
    }
    return { state: "", message: "" };
  }, [form.customerDocument]);

  /* Celular obrigatório e no formato brasileiro: (DDD) 9 0000-0000. */
  const phoneState = useMemo(() => {
    if (!form.customerPhone.trim()) return { state: "", message: "" };
    return validateCellphone(form.customerPhone)
      ? { state: "ok", message: "Celular válido" }
      : { state: "error", message: "Celular inválido — use DDD + 9 dígitos começando com 9." };
  }, [form.customerPhone]);

  /* E-mail válido com qualquer domínio — antes exigia @gmail.com, o que
     contradizia o fluxo de "e-mail corporativo". */
  const emailState = useMemo(() => {
    if (!form.customerEmail.trim()) return { state: "", message: "" };
    return validateEmail(form.customerEmail)
      ? { state: "ok", message: "E-mail válido" }
      : { state: "error", message: "Informe um e-mail válido (ex.: nome@empresa.com.br)." };
  }, [form.customerEmail]);

  /* Busca o endereço completo do CEP (BrasilAPI → ViaCEP). */
  const searchCep = async () => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) {
      setAddressState({ loading: false, error: "Digite os 8 dígitos do CEP." });
      return;
    }
    setAddressState({ loading: true, error: "" });
    try {
      const address = await lookupCep(digits);
      setForm((current) => ({ ...current, customerAddress: [address.street, address.neighborhood, `${address.city} · ${address.state}`].filter(Boolean).join(", ") }));
      setAddressState({ loading: false, error: "" });
    } catch (error) {
      setAddressState({ loading: false, error: error.message });
    }
  };

  /* Itens vinculados ao estoque: confere disponibilidade antes de seguir. */
  const stockShortage = useMemo(() => {
    const demand = new Map();
    for (const item of items) {
      if (!item.inventoryId) continue;
      demand.set(item.inventoryId, (demand.get(item.inventoryId) || 0) + (Number(item.quantity) || 0));
    }
    const available = new Map(inventory.map((entry) => [entry.id, Number(entry.quantity) || 0]));
    return items
      .filter((item) => item.inventoryId && (demand.get(item.inventoryId) || 0) > (available.get(item.inventoryId) ?? 0))
      .map((item) => item.stock?.name || "item do estoque");
  }, [items, inventory]);

  const discountExceedsTotal = Number(form.discount) > subtotal + issValue + (Number(form.shipping) || 0);
  const canAdvance = step === 0
    ? Boolean(form.customerName.trim())
      && docState.state === "ok"
      && phoneState.state === "ok"
      && emailState.state === "ok"
    : items.every((item) => item.name.trim() && Number(item.quantity) > 0 && Number(item.unitPrice) >= 0) && !stockShortage.length && !discountExceedsTotal;

  const submit = (event) => {
    event.preventDefault();
    const cleanedItems = items.map((item, index) => ({
      id: index + 1,
      inventoryId: item.inventoryId || null,
      serviceId: item.serviceId || null,
      stockName: item.stock?.name || "",
      name: item.name.trim(),
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPrice: Number(item.unitPrice),
    }));
    const series = "1";
    const invoice = buildInvoice({ form, items: cleanedItems, company, issuer: currentPerson, invoiceNumber: nextInvoiceNumber(company.invoices, series), series });
    void onCreate(invoice);
  };

  const steps = ["Cliente", "Itens e serviços", "Revisão"];

  const handleDocumentChange = (event) => {
    const masked = maskDocument(event.target.value);
    setForm((current) => ({ ...current, customerDocument: masked, customerId: "" }));
  };

  /* Celular com máscara e validação. */
  const handlePhoneChange = (event) => {
    const masked = maskPhone(event.target.value);
    setForm((current) => ({ ...current, customerPhone: masked, customerId: "" }));
  };

  /* Seleção de peça do estoque: puxa nome e VALOR unitário direto do cadastro. */
  const handleItemField = (item, patch) => {
    if (patch.inventoryId !== undefined) {
      const stock = inventory.find((entry) => entry.id === patch.inventoryId) || null;
      setItem(item.id, {
        inventoryId: patch.inventoryId,
        serviceId: "",
        stock,
        name: stock ? stock.name : item.name,
        unitPrice: stock ? String(stock.unitCost) : item.unitPrice,
      });
      return;
    }
    if (patch.serviceId !== undefined) {
      const service = services.find((entry) => entry.id === patch.serviceId) || null;
      setItem(item.id, {
        serviceId: patch.serviceId,
        inventoryId: "",
        stock: null,
        name: service ? service.name : item.name,
        unitPrice: service ? String(service.price) : item.unitPrice,
        unit: service ? "serviço" : item.unit,
      });
      return;
    }
    setItem(item.id, patch);
  };

  return (
    <Modal onClose={onClose} title="Criar documento de demonstração" wide>
      <form className="invoice-form" onSubmit={submit}>
        <p className="quiet-note">Este documento não é uma NFS-e autorizada pela prefeitura e não possui valor fiscal.</p>
        <div className="invoice-steps">
          {steps.map((label, index) => (
            <span className={index === step ? "step-on" : index < step ? "step-done" : ""} key={label}>
              <i>{index < step ? <Icon name="check" size={11} /> : index + 1}</i>{label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="invoice-step-body">
            <Field className="field-full" label="Chamado relacionado (opcional)">
              <select name="ticketId" onChange={selectTicket} value={form.ticketId}>
                <option value="">Não vincular chamado</option>
                {tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.id} · {ticket.title} · {ticket.status}</option>)}
              </select>
            </Field>
            {clients.some((client) => client.id && client.active !== false) && <Field className="field-full" label="Preencher com cadastro salvo"><select onChange={selectCustomer} value={form.customerId || ""}><option value="">Informar cliente manualmente</option>{clients.filter((client) => client.id && client.active !== false).map((client) => <option key={client.id} value={client.id}>{client.name}{client.company ? ` · ${client.company}` : ""}</option>)}</select></Field>}
            <Field className="field-full" label="Razão social / nome do cliente">
              <input autoFocus name="customerName" onChange={setField} placeholder="Nome do cliente ou empresa" required value={form.customerName} />
            </Field>
            <Field
              className={docState.state ? `field-doc-${docState.state}` : ""}
              label="CPF / CNPJ do cliente"
            >
              <input
                inputMode="numeric"
                name="customerDocument"
                onChange={handleDocumentChange}
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                required
                value={form.customerDocument}
              />
              {docState.message && <span className={`doc-feedback doc-${docState.state}`}>{docState.message}</span>}
            </Field>
            <Field className={phoneState.state ? `field-doc-${phoneState.state}` : ""} label="Celular do cliente">
              <input
                inputMode="tel"
                name="customerPhone"
                onChange={handlePhoneChange}
                placeholder="(11) 90000-0000"
                required
                value={form.customerPhone}
              />
              {phoneState.message && <span className={`doc-feedback doc-${phoneState.state}`}>{phoneState.message}</span>}
            </Field>
            <Field className={emailState.state ? `field-doc-${emailState.state}` : ""} label="E-mail do cliente">
              <input
                name="customerEmail"
                onChange={setField}
                placeholder="cliente@empresa.com.br"
                required
                type="email"
                value={form.customerEmail}
              />
              {emailState.message && <span className={`doc-feedback doc-${emailState.state}`}>{emailState.message}</span>}
            </Field>
            <Field className="field-cep" label="CEP do cliente">
              <div className="cep-row">
                <input
                  inputMode="numeric"
                  name="cep"
                  onChange={(event) => setCep(maskCep(event.target.value))}
                  placeholder="00000-000"
                  value={cep}
                />
                <button className="cep-search" disabled={addressState.loading} onClick={searchCep} type="button">
                  <Icon name={addressState.loading ? "spinner" : "search"} size={14} /> Buscar
                </button>
              </div>
              {addressState.error && <span className="doc-feedback doc-error">{addressState.error}</span>}
            </Field>
            <Field className="field-full" label="Endereço do cliente">
              <input name="customerAddress" onChange={setField} placeholder="Rua, número, bairro, cidade · UF" value={form.customerAddress} />
            </Field>
            <Field label="Vencimento do pagamento"><input name="dueDate" onChange={setField} required type="date" value={form.dueDate} /></Field>
          </div>
        )}

        {step === 1 && (
          <div className="invoice-step-body">
            <Field className="field-full" label="Resumo do serviço prestado (opcional)">
              <input name="description" onChange={setField} placeholder="Ex.: Manutenção preventiva dos equipamentos da unidade" value={form.description} />
            </Field>
            {items.map((item) => (
              <div className="invoice-item-row" key={item.id}>
                <Field className="item-stock" label={`Item ${items.indexOf(item) + 1} · serviço ou peça`}>
                  <select onChange={(event) => handleItemField(item, { serviceId: event.target.value })} value={item.serviceId}>
                    <option value="">Selecione um serviço…</option>
                    {services.filter((service) => service.active !== false).map((service) => (
                      <option key={service.id} value={service.id}>{service.name} · {money(service.price)}</option>
                    ))}
                  </select>
                </Field>
                <Field className="item-name" label="Peça do estoque (opcional)">
                  <select onChange={(event) => handleItemField(item, { inventoryId: event.target.value })} value={item.inventoryId}>
                    <option value="">Sem baixa de estoque</option>
                    {inventory.map((stock) => (
                      <option disabled={stock.quantity === 0} key={stock.id} value={stock.id}>
                        {stock.name} · {money(stock.unitCost)} · {stock.quantity} un.
                      </option>
                    ))}
                  </select>
                </Field>
                <Field className="item-desc" label="Descrição na nota">
                  <input onChange={(event) => setItem(item.id, { name: event.target.value })} placeholder="Descrição do item" value={item.name} />
                </Field>
                <Field label="Qtd.">
                  <input
                    max={item.inventoryId ? item.stock?.quantity : undefined}
                    min="0"
                    onChange={(event) => handleItemField(item, { quantity: event.target.value })}
                    step="any"
                    type="number"
                    value={item.quantity}
                  />
                </Field>
                <Field label="Un.">
                  <select onChange={(event) => setItem(item.id, { unit: event.target.value })} value={item.unit}>
                    <option>un</option><option>h</option><option>mês</option><option>serviço</option>
                  </select>
                </Field>
                <Field className={item.inventoryId ? "item-price-from-stock" : ""} label="Valor unit. (R$)">
                  <input min="0" onChange={(event) => setItem(item.id, { unitPrice: event.target.value })} step="0.01" type="number" value={item.unitPrice} />
                  {item.inventoryId && <span className="doc-feedback doc-ok">valor do estoque</span>}
                </Field>
                <button aria-label={`Remover item ${items.indexOf(item) + 1}`} className="item-remove" disabled={items.length === 1} onClick={() => removeItem(item.id)} type="button"><Icon name="close" size={14} /></button>
              </div>
            ))}
            {stockShortage.length > 0 && (
              <p className="stock-warning"><Icon name="warning" size={14} /> Quantidade acima do disponível em: {stockShortage.join(", ")}.</p>
            )}
            <button className="item-add" onClick={addItem} type="button"><Icon name="plus" size={14} /> Adicionar item</button>
            <div className="invoice-taxes">
              <Field label="Alíquota ISS (%)">
                <select name="issRate" onChange={setField} value={form.issRate}>{ISS_OPTIONS.map((option) => <option key={option} value={option}>{option}%</option>)}</select>
              </Field>
              <Field label="Frete / deslocamento (R$)">
                <input min="0" name="shipping" onChange={setField} step="0.01" type="number" value={form.shipping} />
              </Field>
              <Field label="Desconto (R$)">
                <input max={subtotal + issValue + (Number(form.shipping) || 0)} min="0" name="discount" onChange={setField} step="0.01" type="number" value={form.discount} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="invoice-step-body invoice-review">
            <div className="review-block">
              <strong>Cliente</strong>
              <p>{form.customerName} · {form.customerDocument} {docState.state === "ok" && <span className="doc-feedback doc-ok">✓ documento validado</span>}</p>
              {form.customerPhone && <p>{form.customerPhone} {phoneState.state === "ok" && <span className="doc-feedback doc-ok">✓ celular validado</span>}</p>}
              {form.customerEmail && <p>{form.customerEmail} {emailState.state === "ok" && <span className="doc-feedback doc-ok">✓ e-mail validado</span>}</p>}
              {form.customerAddress && <p>{form.customerAddress}</p>}
            </div>
            <div className="review-block">
              <strong>Itens</strong>
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <span>{item.quantity} {item.unit} · {item.name || "—"}</span>
                    <b>{money((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</b>
                  </li>
                ))}
              </ul>
            </div>
            <div className="review-totals">
              <span>Subtotal <b>{money(subtotal)}</b></span>
              <span>ISS ({form.issRate}%) <b>{money(issValue)}</b></span>
              {Number(form.shipping) > 0 && <span>Frete <b>{money(form.shipping)}</b></span>}
              {Number(form.discount) > 0 && <span className="review-discount">Desconto <b>−{money(form.discount)}</b></span>}
              <span className="review-total">Total <b>{money(total)}</b></span>
            </div>
            {discountExceedsTotal && <p className="auth-error" role="alert">O desconto não pode ser maior que o valor do documento.</p>}
            <Field label="Status da emissão">
              <select name="status" onChange={setField} value={form.status}>
                <option>Emitida</option>
                <option>Rascunho</option>
              </select>
            </Field>
          </div>
        )}

        <div className="invoice-actions">
          <Button onClick={() => (step === 0 ? onClose() : setStep(step - 1))} variant="secondary">{step === 0 ? "Cancelar" : "Voltar"}</Button>
          {step < 2
            ? <Button disabled={!canAdvance} onClick={() => setStep(step + 1)} type="button">Continuar <Icon name="chevron" size={15} /></Button>
            : <Button disabled={issuing} type="submit"><Icon name="check" size={16} /> {issuing ? "Salvando…" : "Salvar documento de demonstração"}</Button>}
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------ nota impressa ------------------------------ */

export function InvoicePrintView({ company, invoice }) {
  const seal = invoice.seal;
  return (
    <div className="nf-paper" id="nf-print-area">
      <header className="nf-head">
        <div className="nf-brand">
          <span className="brand-mark">{company.name[0]?.toUpperCase() || "G"}</span>
          <div><strong>{company.name}</strong><small>CNPJ {company.document}</small></div>
        </div>
        <div className="nf-id">
          <span className="nf-badge">DOCUMENTO DE DEMONSTRAÇÃO · SEM VALOR FISCAL</span>
          <strong>Nº {invoice.number} · Série {invoice.series}</strong>
          <small>Emitida em {longDate(invoice.createdAt)}</small>
          {invoice.dueDate && <small>Vencimento em {longDate(invoice.dueDate)}</small>}
          <Badge tone={invoice.status === "Emitida" ? "green" : "amber"}>{invoice.status}</Badge>
        </div>
      </header>
      {seal && (
        <div className="nf-seal"><Icon name="shield" size={14} /> Registro de demonstração · hash {String(seal.hash).slice(0, 12)}… · encadeado a {String(seal.previousHash).slice(0, 12)}…</div>
      )}
      <div className="nf-grid">
        <div className="nf-block"><span>PRESTADOR</span><strong>{company.name}</strong><p>{company.address}</p><p>{company.email}{company.phone ? ` · ${company.phone}` : ""}</p></div>
        <div className="nf-block"><span>CLIENTE</span><strong>{invoice.customer.name}</strong><p>{invoice.customer.document}</p>{invoice.customer.phone && <p>{invoice.customer.phone}</p>}{invoice.customer.address && <p>{invoice.customer.address}</p>}{invoice.customer.email && <p>{invoice.customer.email}</p>}</div>
      </div>
      <table className="nf-table">
        <thead><tr><th>#</th><th>Descrição</th><th>Qtd.</th><th>Un.</th><th>Valor unit.</th><th>Total</th></tr></thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td>{String(item.id).padStart(2, "0")}</td>
              <td>{item.name}{item.stockName ? <em className="stock-tag">peça: {item.stockName}</em> : null}</td>
              <td>{item.quantity}</td>
              <td>{item.unit}</td>
              <td>{money(item.unitPrice)}</td>
              <td>{money(item.quantity * item.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {invoice.description && <p className="nf-description">{invoice.description}</p>}
      <div className="nf-totals">
        <div className="nf-sum"><span>Subtotal</span><b>{money(invoice.subtotal)}</b></div>
        {invoice.issRate > 0 && <div className="nf-sum"><span>ISS ({invoice.issRate}%)</span><b>{money(invoice.issValue)}</b></div>}
        {invoice.shipping > 0 && <div className="nf-sum"><span>Frete</span><b>{money(invoice.shipping)}</b></div>}
        {invoice.discount > 0 && <div className="nf-sum nf-discount"><span>Desconto</span><b>−{money(invoice.discount)}</b></div>}
        <div className="nf-sum nf-total"><span>TOTAL</span><b>{money(invoice.total)}</b></div>
      </div>
      {invoice.status === "Emitida" && invoice.paymentStatus === "A receber" && invoice.total > 0 && <PixPayment company={company} invoice={invoice} />}
      {invoice.status === "Emitida" && invoice.paymentStatus === "Recebida" && <p className="nf-payment-received">Pagamento registrado em {invoice.paidAt ? longDate(invoice.paidAt) : "data não informada"}.</p>}
      {invoice.status === "Emitida" && !invoice.paymentStatus && <p className="nf-payment-untracked">Situação do pagamento não registrada. Confirme antes de emitir uma nova cobrança.</p>}
      <footer className="nf-foot">
        <div className="nf-signature"><span />Emitida por {invoice.issuer} ({invoice.issuerRole})</div>
        <small>Documento gerado eletronicamente pelo GesTI em {longDate(invoice.createdAt)} · Sem valor fiscal — ambiente de demonstração.</small>
      </footer>
    </div>
  );
}

/* ------------------------- verificação local de integridade ------------------------- */

function LedgerPanel({ invoices, canAudit, onSeal }) {
  const [busy, setBusy] = useState(false);
  const audit = useMemo(() => verifyLedger(invoices), [invoices]);
  const ordered = useMemo(() => [...invoices].sort((a, b) => `${a.createdAt}#${a.id}`.localeCompare(`${b.createdAt}#${b.id}`)), [invoices]);
  const totalLedger = invoices.reduce((sum, invoice) => sum + (invoice.status === "Emitida" ? invoice.total : 0), 0);
  const lastSeal = ordered.length ? ordered[ordered.length - 1].seal : null;

  const runAudit = () => {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      const gapMessage = audit.sequenceGaps?.length ? `\n\nLacunas de numeração: ${audit.sequenceGaps.join(", ")}.` : "\n\nNenhuma lacuna de numeração detectada.";
      window.alert(audit.valid
        ? `✅ Verificação local: ${audit.count} documento(s) conferido(s), nenhuma divergência detectada.${gapMessage}`
        : `⚠️ Divergência local detectada em ${audit.problems.length} documento(s): ${audit.problems.join(", ")}.${gapMessage}`);
    }, 450);
  };

  return (
    <Reveal>
      <section className="ledger-panel">
        <div className="ledger-head">
          <div>
            <span className="eyebrow">VERIFICAÇÃO LOCAL DE INTEGRIDADE</span>
            <h2>Documentos de demonstração</h2>
            <p>O selo ajuda a detectar alterações acidentais nos registros deste navegador. Ele não substitui uma trilha fiscal ou auditoria independente.</p>
          </div>
          <span className={`ledger-status ${audit.valid ? "ok" : invoices.length ? "broken" : "empty"}`}>
            <Icon name={audit.valid ? "shield" : invoices.length ? "warning" : "info"} size={16} />
            {audit.valid ? "Sem divergências locais" : invoices.length ? "Divergência detectada" : "Nenhum documento"}
          </span>
        </div>
        <div className="ledger-stats">
          <div><span>Documentos registrados</span><strong>{invoices.length}</strong></div>
          <div><span>Total demonstrativo</span><strong>{money(totalLedger)}</strong></div>
          <div><span>Último selo da cadeia</span><strong className="ledger-hash">{lastSeal ? String(lastSeal.hash).slice(0, 16) : "—"}</strong></div>
          <div><span>Divergências</span><strong className={audit.problems.length ? "text-warning" : "text-positive"}>{audit.problems.length}</strong></div>
          <div><span>Lacunas na numeração</span><strong className={(audit.sequenceGaps || []).length ? "text-warning" : "text-positive"}>{(audit.sequenceGaps || []).length}</strong></div>
        </div>          <div className="ledger-actions">
          <Button disabled={busy || !invoices.length} onClick={runAudit} variant="secondary"><Icon name={busy ? "spinner" : "shield"} size={15} /> {busy ? "Conferindo…" : "Conferir integridade"}</Button>
          {canAudit && invoices.some((invoice) => !invoice.seal) && <Button disabled={busy} onClick={onSeal}><Icon name="shield" size={15} /> Verificar registros antigos</Button>}
        </div>
      </section>
    </Reveal>
  );
}

function ServiceCatalogPanel({ services, canManage, onAdd, onToggle, onRemove }) {
  const rows = canManage ? services : services.filter((service) => service.active !== false);
  return <Reveal delay={0.03}><section className="panel page-panel service-catalog-panel">
    <div className="panel-heading"><div><h2>Catálogo para a nota</h2><p>Preços padrão usados ao adicionar serviços prestados aos documentos.</p><small>{services.filter((service) => service.active !== false).length} ativos · {services.filter((service) => service.active === false).length} inativos</small></div>{canManage && <Button onClick={onAdd}><Icon name="plus" size={15} /> Novo serviço</Button>}</div>
    {rows.length ? <div className="service-grid">{rows.map((service) => <article className={`service-card ${service.active === false ? "service-off" : ""}`} key={service.id}>
      <span className="service-icon"><Icon name="wrench" size={17} /></span><div className="service-copy"><strong>{service.name}</strong><small>{service.category}{service.description ? ` · ${service.description}` : ""}</small></div><div className="service-meta"><strong>{money(service.price)}</strong><small>{service.active === false ? "inativo" : "preço padrão"}</small></div>
      {canManage && <div className="service-actions"><button aria-label={service.active === false ? `Ativar ${service.name}` : `Desativar ${service.name}`} className="approve-button" onClick={() => onToggle(service)} type="button"><Icon name={service.active === false ? "check" : "clock"} size={15} /></button>{service.active !== false && <button aria-label={`Desativar ${service.name}`} className="reject-button" onClick={() => onRemove(service)} type="button"><Icon name="close" size={15} /></button>}</div>}
    </article>)}</div> : <EmptyState note={canManage ? "Cadastre o serviço prestado aqui ou inclua um item manualmente na nota." : "Ainda não há serviços ativos no catálogo."} title="Catálogo vazio" />}
  </section></Reveal>;
}

export default function InvoicePage({ company, currentPerson, inventory = [], invoices, services = [], tickets = [], clients = [], setInvoices, onIssueComplete, onLinkTicketInvoice, onAddService, onToggleService, onRemoveService, openSignal = 0, focusInvoiceId = "", onFocusHandled, canIssue = false, canManageServices = false }) {
  const notify = useToast();
  const canAudit = ["Admin", "Dono da empresa", "Gerência"].includes(currentPerson?.role);
  const [modal, setModal] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [query, setQuery] = useState("");
  const [lastSignal, setLastSignal] = useState(openSignal);
  const [ejectingInvoiceId, setEjectingInvoiceId] = useState("");

  /* Sinal de abertura consumido durante o render (padrão recomendado pelo
     React): substitui o setState-dentro-de-effect apontado pelo lint. */
  if (openSignal !== lastSignal) {
    setLastSignal(openSignal);
    if (openSignal > 0) setModal(true);
  }

  useEffect(() => {
    if (!ejectingInvoiceId) return undefined;
    const timer = window.setTimeout(() => setEjectingInvoiceId(""), 2400);
    return () => window.clearTimeout(timer);
  }, [ejectingInvoiceId]);

  useEffect(() => {
    if (!focusInvoiceId) return;
    document.getElementById(`invoice-${focusInvoiceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    onFocusHandled?.();
  }, [focusInvoiceId, onFocusHandled]);

  const filtered = useMemo(() => invoices.filter((invoice) => `${invoice.number} ${invoice.customer.name}`.toLowerCase().includes(query.toLowerCase())), [invoices, query]);

  const issued = invoices.filter((invoice) => invoice.status === "Emitida");
  const totalIssued = issued.reduce((sum, invoice) => sum + invoice.total, 0);
  const totalAll = invoices.reduce((sum, invoice) => sum + invoice.total, 0);

  const openPreview = (invoice) => {
    setPreview(invoice);
    setEjectingInvoiceId(invoice.id);
  };

  const create = async (invoice) => {
    if (!canIssue || issuing) return;
    setIssuing(true);
    const outbound = invoice.status === "Emitida" ? invoice.items.filter((item) => item.inventoryId && item.quantity > 0) : [];
    const ordered = [...invoices].sort((a, b) => `${a.createdAt}#${a.id}`.localeCompare(`${b.createdAt}#${b.id}`));
    const previousSealed = ordered.length ? ordered[ordered.length - 1] : null;
    const sealed = { ...invoice, seal: sealInvoice(invoice, previousSealed) };
    try { await onIssueComplete?.(sealed); }
    catch (error) { notify({ tone: "info", title: "Documento não registrado", message: error.message || "Tente novamente." }); setIssuing(false); return; }
    setInvoices((current) => [sealed, ...current]);
    if (sealed.ticketId) onLinkTicketInvoice?.(sealed.ticketId, sealed);
    setModal(false);
    openPreview(sealed);
    notify({
      tone: "success",
      message: outbound.length
        ? `Documento ${invoice.number}/${invoice.series} registrado · ${money(invoice.total)}. Estoque atualizado.`
        : `Documento ${invoice.number}/${invoice.series} registrado · ${money(invoice.total)}.`,
      title: "Documento registrado",
    });
    logEvent(company.id, currentPerson.name, "Documento demonstrativo", `Documento ${invoice.number}/${invoice.series} registrado (${money(invoice.total)})`, "success");
    setIssuing(false);
  };

  /* Sela notas antigas que ficaram sem selo (ex.: criadas antes do livro). */
  const sealLegacy = () => {
    setInvoices((current) => {
      const ordered = [...current].sort((a, b) => `${a.createdAt}#${a.id}`.localeCompare(`${b.createdAt}#${b.id}`));
      let previousSealed = null;
      const sealedById = new Map();
      for (const invoice of ordered) {
        const seal = invoice.seal || sealInvoice(invoice, previousSealed);
        sealedById.set(invoice.id, { ...invoice, seal });
        previousSealed = { seal };
      }
      return current.map((invoice) => sealedById.get(invoice.id) || invoice);
    });
    notify({ tone: "info", message: "Registros antigos vinculados à verificação local de integridade." });
  };

  const downloadCsv = () => {
    exportCsv(invoices, "gesti-notas-fiscais", ["Número", "Série", "Data", "Cliente", "CPF/CNPJ", "Celular", "E-mail", "Status", "Subtotal", "ISS", "Total", "Selo do livro"],
      (invoice) => [invoice.number, invoice.series, invoice.createdAt, invoice.customer.name, invoice.customer.document, invoice.customer.phone || "", invoice.customer.email || "", invoice.status, invoice.subtotal, invoice.issValue, invoice.total, invoice.seal?.hash || "sem selo"]);
  };

  return (
    <>
      <ServiceCatalogPanel canManage={canManageServices} onAdd={onAddService} onRemove={onRemoveService} onToggle={onToggleService} services={services} />
      <LedgerPanel canAudit={canAudit} invoices={invoices} onSeal={sealLegacy} />
      <Reveal>
        <section className="mini-metrics">
          <div><span>Notas emitidas</span><strong><CountUp value={issued.length} /></strong></div>
          <div><span>Total emitido</span><strong><CountUp format={money} value={totalIssued} /></strong></div>
          <div><span>Volume total (com rascunhos)</span><strong><CountUp format={money} value={totalAll} /></strong></div>
          <div><span>Rascunhos</span><strong><CountUp value={invoices.length - issued.length} /></strong></div>
        </section>
      </Reveal>

      <Reveal delay={0.06}>
        <section className="panel page-panel">
          <div className="toolbar">
            <label className="search-box">
              <Icon name="search" size={18} />
              <input aria-label="Buscar documento" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por número ou cliente" value={query} />
            </label>
            <Button className="button-secondary" onClick={downloadCsv} variant="secondary"><Icon name="download" size={16} /> Exportar CSV</Button>
          </div>
          {filtered.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Nota</th><th>Cliente</th><th>Contato</th><th>Emissão</th><th>Status</th><th>Total</th><th>Livro</th><th>Ações</th></tr></thead>
                <tbody>
                  {filtered.map((invoice) => (
                    <tr className={focusInvoiceId === invoice.id ? "invoice-focus-row" : ""} id={`invoice-${invoice.id}`} key={invoice.id}>
                      <td><span className="cell-title">Nº {invoice.number}</span><span className="cell-subtitle">Série {invoice.series} · {invoice.id}</span></td>
                      <td><span className="cell-title">{invoice.customer.name}</span><span className="cell-subtitle">{invoice.customer.document}</span></td>
                      <td><span className="cell-title">{invoice.customer.phone || "—"}</span><span className="cell-subtitle">{invoice.customer.email || "—"}</span></td>
                      <td>{shortDate(invoice.createdAt)}</td>
                      <td><Badge tone={invoice.status === "Emitida" ? "green" : "amber"}>{invoice.status}</Badge></td>
                      <td className="amount-cell">{money(invoice.total)}</td>
                      <td>{invoice.seal
                        ? <span className="seal-cell" title={`Hash ${invoice.seal.hash}`}><Icon name="shield" size={13} /> {String(invoice.seal.hash).slice(0, 8)}</span>
                        : <span className="seal-cell seal-missing" title="Sem selo do livro fiscal"><Icon name="warning" size={13} /> sem selo</span>}</td>
                      <td><div className="row-actions">
                        <button className="text-link" onClick={() => openPreview(invoice)} type="button"><Icon name="eye" size={14} /> Ver</button>
                        <button className="text-link" onClick={() => openPreview(invoice)} type="button"><Icon name="print" size={14} /> Imprimir</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState note={canIssue ? "Clique em “Criar documento” para registrar o primeiro." : "Nenhum documento disponível."} title="Nenhum documento" />}
        </section>
      </Reveal>

      {modal && <InvoiceBuilder clients={clients} company={company} currentPerson={currentPerson} inventory={inventory} issuing={issuing} onClose={() => setModal(false)} onCreate={create} services={services} tickets={tickets} />}

      {preview && (
        <Modal onClose={() => setPreview(null)} title={`Nota ${preview.number} · ${preview.customer.name}`} wide>
          {ejectingInvoiceId === preview.id && <div aria-live="polite" className="invoice-guest-celebration" role="status"><GuestMascot className="invoice-guest" mode="print" paperLabel="NF" /><span>Guest está imprimindo a nota {preview.number}.</span></div>}
          <div className="nf-actions">
            <Button onClick={() => window.print()} variant="secondary"><Icon name="print" size={15} /> Imprimir / PDF</Button>
            <Button onClick={() => setPreview(null)} variant="secondary">Fechar</Button>
          </div>
          <div className={ejectingInvoiceId === preview.id ? "invoice-preview-body invoice-preview-body-printing" : "invoice-preview-body"}><InvoicePrintView company={company} invoice={preview} /></div>
        </Modal>
      )}
    </>
  );
}
