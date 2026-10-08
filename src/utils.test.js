import { describe, expect, it } from "vitest";
import { classifyTicketPriority, maskCep, maskDocument, maskPhone, sealInvoice, validateCellphone, validateCnpj, validateCpf, validateEmail, verifyLedger } from "../src/store.js";
import { csvCell, formatDateTime, isFirstAccessRoute, money, nextId, PAGES, ROLE_PERMISSIONS, shortDate, slugify, SLA_BY_PRIORITY, today } from "../src/utils.js";

describe("rota de primeiro acesso", () => {
  it("reconhece o link dedicado e não confunde as rotas internas", () => {
    expect(isFirstAccessRoute("#/primeiro-acesso")).toBe(true);
    expect(isFirstAccessRoute("#primeiro-acesso?origem=login")).toBe(true);
    expect(isFirstAccessRoute("#/visao-geral")).toBe(false);
    expect(isFirstAccessRoute("")).toBe(false);
  });
});

describe("exportação CSV", () => {
  it("impede fórmulas vindas de campos de texto e preserva valores numéricos", () => {
    expect(csvCell("=HYPERLINK(\"https://example.invalid\")")).toBe("\"'=HYPERLINK(\"\"https://example.invalid\"\")\"");
    expect(csvCell("  -SUM(A1:A2)")).toBe("\"'  -SUM(A1:A2)\"");
    expect(csvCell(-125.5)).toBe("\"-125.5\"");
  });
});

/* --------------------------- classificação de prioridade --------------------------- */

describe("classifyTicketPriority", () => {
  it("classifica como Urgente quando há indisponibilidade crítica", () => {
    expect(classifyTicketPriority("", "Servidor fora do ar desde ontem")).toBe("Urgente");
  });

  it("classifica como Alta em falhas comuns de equipamento", () => {
    expect(classifyTicketPriority("", "Monitor sem imagem na recepção")).toBe("Alta");
  });

  it("classifica como Baixa em solicitações agendáveis", () => {
    expect(classifyTicketPriority("", "Sugestão de melhoria: agendar limpeza geral")).toBe("Baixa");
  });

  it("assume Alta quando não há palavras-chave conhecidas", () => {
    expect(classifyTicketPriority("", "Mensagem genérica qualquer")).toBe("Alta");
  });

  it("reconhece variações sem acento", () => {
    expect(classifyTicketPriority("", "servidor indisponivel agora")).toBe("Urgente");
  });
});

/* ------------------------------- validações ------------------------------- */

describe("validateCnpj", () => {
  it("aceita um CNPJ válido", () => {
    expect(validateCnpj("11.444.777/0001-61")).toBe(true);
  });
  it("rejeita dígitos repetidos e tamanho errado", () => {
    expect(validateCnpj("11.111.111/1111-11")).toBe(false);
    expect(validateCnpj("1234567800019")).toBe(false);
  });
});

describe("validateCpf", () => {
  it("aceita um CPF válido", () => {
    expect(validateCpf("529.982.247-25")).toBe(true);
  });
  it("rejeita um CPF inválido", () => {
    expect(validateCpf("529.982.247-26")).toBe(false);
    expect(validateCpf("111.111.111-11")).toBe(false);
  });
});

describe("validateCellphone", () => {
  it("exige DDD válido e nono dígito", () => {
    expect(validateCellphone("(11) 91234-5678")).toBe(true);
    expect(validateCellphone("(11) 31234-5678")).toBe(false);
    expect(validateCellphone("(08) 91234-5678")).toBe(false);
  });
});

describe("validateEmail", () => {
  it("aceita e-mails de qualquer domínio", () => {
    expect(validateEmail("nome@empresa.com.br")).toBe(true);
    expect(validateEmail("pessoa@gmail.com")).toBe(true);
  });
  it("rejeita formatos inválidos", () => {
    expect(validateEmail("sem-arroba")).toBe(false);
    expect(validateEmail("dois..pontos@empresa.com")).toBe(false);
  });
});

/* -------------------------------- máscaras -------------------------------- */

describe("máscaras", () => {
  it("formata documento CPF e CNPJ", () => {
    expect(maskDocument("52998224725")).toBe("529.982.247-25");
    expect(maskDocument("12345678000190")).toBe("12.345.678/0001-90");
  });
  it("formata telefone e CEP", () => {
    expect(maskPhone("11912345678")).toBe("(11) 91234-5678");
    expect(maskCep("01310100")).toBe("01310-100");
  });
});

/* ------------------------------ livro fiscal ------------------------------ */

describe("livro fiscal (cadeia de selos)", () => {
  it("mantém a cadeia íntegra para notas seladas em ordem", () => {
    const invoices = [];
    let previous = null;
    for (let index = 1; index <= 3; index += 1) {
      const invoice = { id: `NF-00${index}`, number: String(index).padStart(4, "0"), series: "1", createdAt: `2026-01-0${index}`, customer: { name: "Cliente" }, items: [], subtotal: 100, issRate: 0, issValue: 0, shipping: 0, discount: 0, total: 100 };
      const sealed = { ...invoice, seal: sealInvoice(invoice, previous) };
      invoices.push(sealed);
      previous = sealed;
    }
    const audit = verifyLedger(invoices);
    expect(audit.valid).toBe(true);
    expect(audit.problems).toHaveLength(0);
  });

  it("detecta alteração em nota antiga (tentativa de caixa 2)", () => {
    const first = { id: "NF-001", number: "0001", series: "1", createdAt: "2026-01-01", customer: { name: "Cliente" }, items: [], subtotal: 100, issRate: 0, issValue: 0, shipping: 0, discount: 0, total: 100 };
    const second = { id: "NF-002", number: "0002", series: "1", createdAt: "2026-01-02", customer: { name: "Cliente" }, items: [], subtotal: 500, issRate: 0, issValue: 0, shipping: 0, discount: 0, total: 500 };
    const sealedFirst = { ...first, seal: sealInvoice(first, null) };
    const sealedSecond = { ...second, seal: sealInvoice(second, sealedFirst) };
    const tampered = [{ ...sealedFirst, total: 10 }, sealedSecond];
    const audit = verifyLedger(tampered);
    expect(audit.valid).toBe(false);
    expect(audit.problems).toContain("NF-001");
  });

  it("acusa nota sem selo", () => {
    const audit = verifyLedger([{ id: "NF-001", number: "0001", series: "1", createdAt: "2026-01-01", customer: {}, items: [] }]);
    expect(audit.valid).toBe(false);
  });
});

/* ------------------------------ utilitários ------------------------------ */

describe("utilitários", () => {
  it("gera IDs sequenciais a partir do maior existente", () => {
    expect(nextId("CH", [{ id: "CH-001" }, { id: "CH-042" }])).toBe("CH-043");
    expect(nextId("CH", [])).toBe("CH-001");
  });

  it("today() devolve a data LOCAL (não UTC)", () => {
    const value = today();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const local = new Date();
    expect(value).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`);
  });

  it("formata valores monetários em BRL", () => {
    expect(money(1234.5)).toContain("1.234,50");
  });

  it("shortDate aceita datas ISO completas sem quebrar", () => {
    expect(shortDate("2026-03-05T14:33:00.000Z")).not.toBe("—");
    expect(shortDate("")).toBe("—");
  });

  it("formatDateTime devolve data legível para histórico", () => {
    expect(formatDateTime("2026-03-05T14:33:00.000Z")).not.toBe("—");
  });

  it("slugify remove acentos e espaços", () => {
    expect(slugify("Visão geral")).toBe("visao-geral");
    expect(slugify("Notas fiscais")).toBe("notas-fiscais");
  });

  it("SLA centralizado cobre todas as prioridades", () => {
    expect(SLA_BY_PRIORITY).toEqual({ Urgente: 4, Alta: 8, Baixa: 40 });
  });

  it("permissões declarativas cobrem todos os perfis", () => {
    for (const role of ["Admin", "Dono da empresa", "TI", "Gerência", "Supervisor", "Funcionário"]) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
    expect(ROLE_PERMISSIONS["Funcionário"]).toHaveLength(0);
    expect(ROLE_PERMISSIONS.Admin).toContain("backup");
  });

  it("catálogo de páginas é estável", () => {
    expect(PAGES).toHaveLength(12);
    expect(PAGES).not.toContain("Cargos da equipe");
    expect(PAGES).toContain("Funcionários");
  });
});
