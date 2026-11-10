import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { erroHttp, testarChave, consultarRastreios } from "./rastro";
import { sincronizarRastreios, todas } from "./sync";

const CHAVE = "CHAVE-SECRETA-0123456789abcdef";
const URL_SB = "http://sb.test";

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("rastro: erro HTTP não vaza a chave", () => {
  it("guarda só status e msgs, mascarando a chave", async () => {
    const res = json({ msgs: [`Token inválido: Bearer ${CHAVE}`], eco: { authorization: `Bearer ${CHAVE}` } }, 401);
    const m = await erroHttp(res, CHAVE);
    expect(m).toBe("HTTP 401: Token inválido: Bearer ***");
    expect(m).not.toContain(CHAVE);
  });

  it("corpo não-JSON vira só o status", async () => {
    const res = new Response(`<html>Authorization: Bearer ${CHAVE}</html>`, { status: 502 });
    expect(await erroHttp(res, CHAVE)).toBe("HTTP 502");
  });

  it("falhas do lote não contêm a chave", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`echo Bearer ${CHAVE}`, { status: 500 })));
    const r = await consultarRastreios(["AA123456785BR"], CHAVE);
    expect(r.falhas).toEqual(["lote 1: HTTP 500"]);
  });

  it("testarChave: 401 recusa, 200 aceita, nunca devolve a chave", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ msgs: [CHAVE] }, 401)));
    const r = await testarChave(CHAVE, "AA123456785BR");
    expect(r.ok).toBe(false);
    expect(r.mensagem).not.toContain(CHAVE);
    vi.stubGlobal("fetch", vi.fn(async () => json({ codObjeto: "AA123456785BR" })));
    expect((await testarChave(CHAVE, "AA123456785BR")).ok).toBe(true);
  });
});

describe("todas(): pagina pelo total", () => {
  it("não para cedo quando o servidor devolve menos que a página", async () => {
    const total = 2500;
    const pagina = 700; // max-rows menor que PAGINA (1000)
    const r = await todas<number>(async (de) => {
      const fim = Math.min(de + pagina, total);
      return { data: Array.from({ length: fim - de }, (_, i) => de + i), error: null, count: total };
    });
    expect(r.linhas).toHaveLength(total);
    expect(r.completa).toBe(true);
  });

  it("marca incompleta quando a leitura não bate com o total", async () => {
    const r = await todas<number>(async (de) => ({
      data: de === 0 ? [1, 2, 3] : [],
      error: null,
      count: 10,
    }));
    expect(r.completa).toBe(false);
  });
});

/** Supabase falso via fetch: responde por tabela e registra as URLs. */
function supabaseFalso(opts: {
  valores: unknown[];
  salvos: unknown[];
  contagemSalvos?: number;
  campos?: unknown[];
  contagemCampos?: number;
}) {
  const chamadas: { metodo: string; url: string }[] = [];
  const corpos: unknown[] = [];
  const fetchFalso = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const metodo = init?.method ?? "GET";
    chamadas.push({ metodo, url });
    if (metodo === "POST" && typeof init?.body === "string") corpos.push(JSON.parse(init.body));
    const tabela = new URL(url).pathname.split("/").pop();
    // .range(de, ate) do supabase-js vira ?offset=&limit= na URL.
    const qs = new URL(url).searchParams;
    const de = Number(qs.get("offset") ?? 0);
    const limite = Number(qs.get("limit") ?? 1000);
    const fatia = <T,>(linhas: T[], total: number) => {
      const parte = linhas.slice(de, de + limite);
      return json(parte, 200, { "Content-Range": `${de}-${de + parte.length - 1}/${total}` });
    };
    if (tabela === "deal_custom_fields") {
      const campos = opts.campos ?? [{ id: "campo-1", account_id: uuid(99) }];
      return fatia(campos, opts.contagemCampos ?? campos.length);
    }
    if (tabela === "deal_custom_values") return fatia(opts.valores, opts.valores.length);
    if (tabela === "deal_tracking_status") {
      if (metodo === "GET") return fatia(opts.salvos, opts.contagemSalvos ?? opts.salvos.length);
      return new Response(null, { status: 204 });
    }
    return json({ message: `tabela inesperada ${tabela}` }, 404);
  });
  const admin = createClient(URL_SB, "service-key", { global: { fetch: fetchFalso as typeof fetch } });
  return { admin, chamadas, corpos };
}

describe("sincronizarRastreios", () => {
  it("apaga 400 removidos em lotes de 100 (sem URL gigante)", async () => {
    const salvos = Array.from({ length: 400 }, (_, i) => ({
      deal_id: uuid(i),
      codigo: "AA123456785BR",
      entregue: true,
      consultado_em: new Date().toISOString(),
    }));
    const { admin, chamadas } = supabaseFalso({ valores: [], salvos });
    const r = await sincronizarRastreios(admin, CHAVE);
    expect(r.removidos).toBe(400);
    const deletes = chamadas.filter((c) => c.metodo === "DELETE");
    expect(deletes).toHaveLength(4);
    for (const d of deletes) expect(d.url.length).toBeLessThan(5000);
  });

  it("leitura incompleta não apaga nada", async () => {
    const salvos = [{ deal_id: uuid(1), codigo: "AA123456785BR", entregue: true, consultado_em: new Date().toISOString() }];
    const { admin, chamadas } = supabaseFalso({ valores: [], salvos, contagemSalvos: 5000 });
    const r = await sincronizarRastreios(admin, CHAVE);
    expect(r.removidos).toBe(0);
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    expect(r.falhas[0]).toContain("limpeza pulada");
  });

  it("grava o código do campo (normalizado) em `codigo`", async () => {
    const valores = [{ deal_id: uuid(7), deal_custom_field_id: "campo-1", value: " aa123456785br ", deal: { account_id: uuid(99) } }];
    const { admin, chamadas, corpos } = supabaseFalso({ valores, salvos: [] });
    const fetchSb = (admin as unknown as { rest: { fetch: typeof fetch } }).rest.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.correios.com.br")) {
        return json({ objetos: [{ codObjeto: "AA123456785BR", eventos: [{ codigo: "RO", tipo: "01", descricao: "Objeto em transferência" }] }] });
      }
      return fetchSb(input, init);
    });
    const r = await sincronizarRastreios(admin, CHAVE);
    expect(r.gravados).toBe(1);
    expect(chamadas.some((c) => c.metodo === "POST" && c.url.includes("deal_tracking_status"))).toBe(true);
    const gravado = corpos.flat()[0] as { codigo: string; deal_id: string };
    expect(gravado.codigo).toBe("AA123456785BR");
    expect(gravado.deal_id).toBe(uuid(7));
  });

  it("leitura de campos cortada pelo limite não apaga status", async () => {
    const salvos = [{ deal_id: uuid(1), account_id: uuid(99), codigo: "AA123456785BR", entregue: true, consultado_em: new Date().toISOString() }];
    const { admin, chamadas } = supabaseFalso({ valores: [], salvos, contagemCampos: 3000 });
    const r = await sincronizarRastreios(admin, CHAVE);
    expect(r.removidos).toBe(0);
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
  });

  it("contas excluídas ficam fora sem not.in na URL", async () => {
    const contaFora = uuid(500);
    const excluir = Array.from({ length: 300 }, (_, i) => uuid(1000 + i)).concat(contaFora);
    const salvos = [{ deal_id: uuid(2), account_id: contaFora, codigo: "AA123456785BR", entregue: true, consultado_em: new Date().toISOString() }];
    const campos = [{ id: "campo-fora", account_id: contaFora }];
    const { admin, chamadas } = supabaseFalso({ valores: [], salvos, campos });
    const r = await sincronizarRastreios(admin, CHAVE, { excluir });
    expect(r.removidos).toBe(0);
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    for (const c of chamadas) {
      expect(c.url).not.toContain("not.in");
      expect(c.url.length).toBeLessThan(5000);
    }
  });

  it("muitas contas: ids de campo vão em lotes, sem URL gigante", async () => {
    const campos = Array.from({ length: 250 }, (_, i) => ({ id: uuid(5000 + i), account_id: uuid(6000 + i) }));
    const { admin, chamadas } = supabaseFalso({ valores: [], salvos: [], campos });
    await sincronizarRastreios(admin, CHAVE);
    const leituras = chamadas.filter((c) => c.url.includes("deal_custom_values"));
    expect(leituras).toHaveLength(3);
    for (const c of leituras) expect(c.url.length).toBeLessThan(5000);
  });
});

