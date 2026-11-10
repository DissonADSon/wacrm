import { describe, expect, it } from "vitest";
import { deveRetomar, escolherPendentes, primeiroNome, respostaIncerta, textoAviso, type AvisoSalvo } from "./aviso";

const AGORA = Date.parse("2026-11-10T18:00:00Z");
const deal = (id: string) => ({
  account_id: "a1",
  user_id: "u1",
  contact_id: `c-${id}`,
  contact: { id: `c-${id}`, name: "Maria Silva", phone: "5531999990000" },
});
const v = (dealId: string, campo: string, value: string | null, updated = "2026-11-10T17:55:00Z") => ({
  deal_id: dealId,
  deal_custom_field_id: campo,
  value,
  updated_at: updated,
  deal: deal(dealId),
});
const avisado = (deal: string, codigo: string, extra: Partial<AvisoSalvo> = {}) =>
  new Map<string, AvisoSalvo>([
    [
      `${deal}|${codigo}`,
      { deal_id: deal, codigo, status: "enviado", tentativas: 1, tentado_em: "2026-11-10T17:00:00Z", chamado_em: null, criado_em: "2026-11-10T17:00:00Z", ...extra },
    ],
  ]);
const ordem = new Map([
  ["f1", 0],
  ["f2", 1],
]);

describe("escolherPendentes", () => {
  it("pega código novo, normalizado", () => {
    const r = escolherPendentes([v("d1", "f1", " ab123456789br ")], ordem, new Map(), AGORA);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dealId: "d1", codigo: "AB123456789BR", accountId: "a1" });
  });

  it("não repete código já avisado ou legado", () => {
    const r = escolherPendentes([v("d1", "f1", "AB123456789BR")], ordem, avisado("d1","AB123456789BR"), AGORA);
    expect(r).toHaveLength(0);
  });

  it("código trocado no mesmo card gera aviso novo", () => {
    const r = escolherPendentes([v("d1", "f1", "AB000000000BR")], ordem, avisado("d1","AB123456789BR"), AGORA);
    expect(r.map((p) => p.codigo)).toEqual(["AB000000000BR"]);
  });

  it("ignora valor inválido, vazio e card sem deal", () => {
    const semDeal = { ...v("d3", "f1", "AB123456789BR"), deal: null };
    const r = escolherPendentes([v("d1", "f1", "123"), v("d2", "f1", null), semDeal], ordem, new Map(), AGORA);
    expect(r).toHaveLength(0);
  });

  it("não dispara para código mexido há mais de 24h", () => {
    const r = escolherPendentes([v("d1", "f1", "AB123456789BR", "2026-11-09T17:00:00Z")], ordem, new Map(), AGORA);
    expect(r).toHaveLength(0);
  });

  it("sem updated_at não dispara", () => {
    const r = escolherPendentes([{ ...v("d1", "f1", "AB123456789BR"), updated_at: null }], ordem, new Map(), AGORA);
    expect(r).toHaveLength(0);
  });

  it("dois campos no mesmo card: vale o primeiro campo, um aviso só", () => {
    const r = escolherPendentes(
      [v("d1", "f2", "ZZ999999999BR"), v("d1", "f1", "AB123456789BR")],
      ordem,
      new Map(),
      AGORA,
    );
    expect(r.map((p) => p.codigo)).toEqual(["AB123456789BR"]);
  });
});

describe("nova tentativa", () => {
  const base = (x: Partial<AvisoSalvo>): AvisoSalvo => ({
    deal_id: "d1", codigo: "AB123456789BR", status: "falhou", tentativas: 1,
    tentado_em: "2026-11-10T17:30:00Z", chamado_em: null, criado_em: "2026-11-10T17:30:00Z", ...x,
  });

  it("falha retenta depois da espera e para no limite", () => {
    expect(deveRetomar(base({}), AGORA)).toBe(true); // 30 min > 15 min
    expect(deveRetomar(base({ tentado_em: "2026-11-10T17:50:00Z" }), AGORA)).toBe(false);
    expect(deveRetomar(base({ tentativas: 2, tentado_em: "2026-11-10T17:40:00Z" }), AGORA)).toBe(false); // precisa 30 min
    expect(deveRetomar(base({ tentativas: 3 }), AGORA)).toBe(false);
  });

  it("falha de código antigo (> 24h) não retenta", () => {
    expect(deveRetomar(base({ criado_em: "2026-11-09T10:00:00Z", tentado_em: "2026-11-09T10:00:00Z" }), AGORA)).toBe(false);
  });

  it("enviando preso há mais de 15 min volta pra fila; recente não", () => {
    expect(deveRetomar(base({ status: "enviando", tentado_em: "2026-11-10T17:40:00Z" }), AGORA)).toBe(true);
    expect(deveRetomar(base({ status: "enviando", tentado_em: "2026-11-10T17:55:00Z" }), AGORA)).toBe(false);
  });

  it("enviando preso no limite ainda volta, para ser encerrado", () => {
    expect(deveRetomar(base({ status: "enviando", tentativas: 3, tentado_em: "2026-11-10T17:00:00Z" }), AGORA)).toBe(true);
  });

  it("resposta perdida (rede/timeout) conta como incerta; recusa HTTP não", () => {
    expect(respostaIncerta(new TypeError("fetch failed"))).toBe(true);
    expect(respostaIncerta(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(respostaIncerta(new Error("read ECONNRESET"))).toBe(true);
    expect(respostaIncerta(new Error("(#131030) Recipient phone number not in allowed list"))).toBe(false);
    expect(respostaIncerta(new Error("Evolution API 400: bad number"))).toBe(false);
    expect(respostaIncerta(new Error("Meta API error: 500"))).toBe(true);
    expect(respostaIncerta(new Error("Meta API error: 429"))).toBe(true);
    expect(respostaIncerta(new Error("Evolution API 503: down"))).toBe(true);
  });

  it("enviado e legado nunca retentam", () => {
    expect(deveRetomar(base({ status: "enviado" }), AGORA)).toBe(false);
    expect(deveRetomar(base({ status: "legado", tentativas: 0, tentado_em: null }), AGORA)).toBe(false);
  });

  it("escolherPendentes leva a retomada junto com o aviso salvo", () => {
    const r = escolherPendentes(
      [v("d1", "f1", "AB123456789BR", "2026-11-01T00:00:00Z")],
      ordem,
      avisado("d1", "AB123456789BR", { status: "falhou" }),
      AGORA,
    );
    expect(r).toHaveLength(1);
    expect(r[0].retomar?.status).toBe("falhou");
  });
});

describe("texto do aviso", () => {
  it("usa o primeiro nome e cai em 'cliente' quando o nome é telefone ou vazio", () => {
    expect(primeiroNome("Maria Silva")).toBe("Maria");
    expect(primeiroNome("+55 31 99999-0000")).toBe("cliente");
    expect(primeiroNome(null)).toBe("cliente");
    expect(primeiroNome("  ")).toBe("cliente");
  });

  it("leva código e aviso de demora dos Correios", () => {
    const t = textoAviso("Maria", "AB123456789BR", "Johari");
    expect(t).toContain("pedido Johari");
    expect(t).toContain("AB123456789BR");
    expect(t).toContain("pode levar algumas horas para atualizar");
    expect(t).toContain("rastreamento.correios.com.br");
  });
});
