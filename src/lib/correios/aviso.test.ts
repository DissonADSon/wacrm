import { describe, expect, it } from "vitest";
import { ERRO_LACUNA, deveRetomar, emLacuna, escolherLegados, escolherPendentes, primeiroNome, rejeicaoExplicita, respostaIncerta, textoAviso, type AvisoSalvo } from "./aviso";

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

  it("dois campos com códigos diferentes: um aviso por código; mesmo código repetido avisa uma vez", () => {
    const r = escolherPendentes(
      [v("d1", "f2", "ZZ999999999BR"), v("d1", "f1", "AB123456789BR"), v("d1", "f2", "AB123456789BR")],
      ordem,
      new Map(),
      AGORA,
    );
    expect(r.map((p) => p.codigo)).toEqual(["AB123456789BR", "ZZ999999999BR"]);
  });

  it("1º campo já legado não bloqueia o código novo do 2º campo", () => {
    const r = escolherPendentes(
      [v("d1", "f1", "AB123456789BR", "2026-11-01T00:00:00Z"), v("d1", "f2", "ZZ999999999BR")],
      ordem,
      avisado("d1", "AB123456789BR", { status: "legado", tentativas: 0, tentado_em: null }),
      AGORA,
    );
    expect(r.map((p) => p.codigo)).toEqual(["ZZ999999999BR"]);
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

  it("só recusa com código conhecido conta como 'não saiu'; erro genérico é incerto", () => {
    expect(rejeicaoExplicita(new Error("(#132000) Number of parameters does not match"))).toBe(true);
    expect(rejeicaoExplicita(new Error("(#131026) Message undeliverable"))).toBe(true);
    expect(rejeicaoExplicita(new Error("(#100) Invalid parameter"))).toBe(true);
    expect(rejeicaoExplicita(new Error("Evolution API 400: bad number"))).toBe(true);
    expect(rejeicaoExplicita(new Error("An unknown error occurred"))).toBe(false);
    expect(rejeicaoExplicita(new Error("(#1) An unexpected error has occurred"))).toBe(false);
    expect(rejeicaoExplicita(new Error("Service temporarily unavailable"))).toBe(false);
    expect(rejeicaoExplicita(new Error("Evolution API 429: slow down"))).toBe(false);
    expect(rejeicaoExplicita(new Error("Meta API error: 500"))).toBe(false);
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

describe("varredura de legado", () => {
  it("código sem registro parado há mais de 24h vira legado; recente não", () => {
    const r = escolherLegados(
      [v("d1", "f1", "AB123456789BR", "2026-11-09T17:00:00Z"), v("d2", "f1", "CD123456789BR")],
      new Map(),
      AGORA,
    );
    expect(r).toEqual([{ deal_id: "d1", codigo: "AB123456789BR", account_id: "a1" }]);
  });

  it("sem updated_at também vira legado", () => {
    const r = escolherLegados([{ ...v("d1", "f1", "AB123456789BR"), updated_at: null }], new Map(), AGORA);
    expect(r.map((l) => l.codigo)).toEqual(["AB123456789BR"]);
  });

  it("não toca código que já tem registro, nem valor inválido ou card sem deal", () => {
    const semDeal = { ...v("d3", "f1", "EF123456789BR", "2026-11-01T00:00:00Z"), deal: null };
    const r = escolherLegados(
      [v("d1", "f1", " ab123456789br ", "2026-11-01T00:00:00Z"), v("d2", "f1", "xyz", "2026-11-01T00:00:00Z"), semDeal],
      avisado("d1", "AB123456789BR"),
      AGORA,
    );
    expect(r).toHaveLength(0);
  });

  it("cobre todos os campos de rastreio do card, sem duplicar o mesmo código", () => {
    const r = escolherLegados(
      [
        v("d1", "f1", "AB123456789BR", "2026-11-01T00:00:00Z"),
        v("d1", "f2", "ZZ999999999BR", "2026-11-01T00:00:00Z"),
        v("d1", "f2", "AB123456789BR", "2026-11-01T00:00:00Z"),
      ],
      new Map(),
      AGORA,
    );
    expect(r.map((l) => l.codigo).sort()).toEqual(["AB123456789BR", "ZZ999999999BR"]);
  });

  it("depois de virar legado, salvar o card de novo não dispara aviso", () => {
    const salvo = avisado("d1", "AB123456789BR", { status: "legado", tentativas: 0, tentado_em: null });
    const r = escolherPendentes([v("d1", "f1", "AB123456789BR")], ordem, salvo, AGORA);
    expect(r).toHaveLength(0);
  });
});

describe("lacuna (ciclo parado mais de 24 h)", () => {
  it("marca ausente, inválida ou com mais de 24 h entra em lacuna; recente não", () => {
    expect(emLacuna(null, AGORA)).toBe(true);
    expect(emLacuna("lixo", AGORA)).toBe(true);
    expect(emLacuna("2026-11-07T18:00:00Z", AGORA)).toBe(true);
    expect(emLacuna("2026-11-10T17:58:00Z", AGORA)).toBe(false);
  });

  it("em lacuna até o código recente sem registro vira legado (pode ser antigo regravado)", () => {
    const r = escolherLegados([v("d1", "f1", "AB123456789BR"), v("d2", "f1", "CD123456789BR", "2026-11-01T00:00:00Z")], new Map(), AGORA, true);
    expect(r.map((l) => l.codigo).sort()).toEqual(["AB123456789BR", "CD123456789BR"]);
  });

  it("em lacuna não toca o que já tem registro", () => {
    const r = escolherLegados([v("d1", "f1", "AB123456789BR")], avisado("d1", "AB123456789BR"), AGORA, true);
    expect(r).toHaveLength(0);
  });
});

describe("legado de lacuna visível no card", () => {
  it("o prefixo que o card procura casa com o erro gravado em lacuna", async () => {
    const fs = await import("node:fs");
    const card = fs.readFileSync(new URL("../../components/pipelines/deal-card.tsx", import.meta.url), "utf8");
    const prefixo = card.match(/startsWith\("([^"]+)"\)/)?.[1];
    expect(prefixo).toBeTruthy();
    expect(ERRO_LACUNA.startsWith(prefixo!)).toBe(true);
  });
});
