const RASTRO_URL = "https://api.correios.com.br/srorastro/v1/objetos";
const LOTE_MAX = 50;

export const CODIGO_RASTREIO_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

export function normalizarCodigo(valor: string | null | undefined): string | null {
  const c = (valor ?? "").replace(/\s+/g, "").toUpperCase();
  return CODIGO_RASTREIO_RE.test(c) ? c : null;
}

export interface StatusRastreio {
  codigo: string;
  descricao: string | null;
  evento_codigo: string | null;
  evento_tipo: string | null;
  cidade: string | null;
  uf: string | null;
  evento_em: string | null;
  previsao_em: string | null;
  entregue: boolean;
  erro: string | null;
}

interface EventoApi {
  codigo?: string;
  tipo?: string;
  descricao?: string;
  dtHrCriado?: string;
  unidade?: { endereco?: { cidade?: string; uf?: string } };
}

interface ObjetoApi {
  codObjeto: string;
  mensagem?: string;
  dtPrevista?: string;
  eventos?: EventoApi[];
}

// BDE/BDI/BDR tipo 01 = "Objeto entregue ao destinatário" (tabela SRO dos Correios).
function foiEntregue(e: EventoApi | undefined): boolean {
  return !!e && ["BDE", "BDI", "BDR"].includes(e.codigo ?? "") && e.tipo === "01";
}

// Os Correios mandam hora de Brasília sem offset; respeita offset/Z se vier.
function horaBrasilia(v: string | undefined): string | null {
  if (!v) return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v}-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

function paraStatus(o: ObjetoApi): StatusRastreio {
  const e = o.eventos?.[0];
  const cidade = e?.unidade?.endereco?.cidade ?? null;
  const uf = e?.unidade?.endereco?.uf ?? null;
  return {
    codigo: o.codObjeto,
    descricao: e?.descricao ?? null,
    evento_codigo: e?.codigo ?? null,
    evento_tipo: e?.tipo ?? null,
    cidade,
    uf: uf === "BR" && !cidade ? null : uf,
    evento_em: horaBrasilia(e?.dtHrCriado),
    previsao_em: horaBrasilia(o.dtPrevista),
    entregue: foiEntregue(e),
    erro: e ? null : (o.mensagem ?? "Sem eventos"),
  };
}

export interface ResultadoConsulta {
  status: Map<string, StatusRastreio>;
  falhas: string[];
}

// Um lote com erro não derruba os outros: devolve o que deu certo e as falhas.
export async function consultarRastreios(
  codigos: string[],
  chave: string,
): Promise<ResultadoConsulta> {
  const status = new Map<string, StatusRastreio>();
  const falhas: string[] = [];
  for (let i = 0; i < codigos.length; i += LOTE_MAX) {
    const lote = codigos.slice(i, i + LOTE_MAX);
    const qs = new URLSearchParams(lote.map((c) => ["codigosObjetos", c]));
    qs.set("resultado", "U");
    try {
      const res = await fetch(`${RASTRO_URL}?${qs}`, {
        headers: {
          Authorization: `Bearer ${chave}`,
          Accept: "application/json",
          "Accept-Language": "pt-BR",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = (await res.json()) as { objetos?: ObjetoApi[] };
      for (const o of data.objetos ?? []) status.set(o.codObjeto, paraStatus(o));
    } catch (e) {
      falhas.push(`lote ${i / LOTE_MAX + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { status, falhas };
}
