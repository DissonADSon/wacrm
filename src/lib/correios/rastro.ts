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

/**
 * Mensagem de erro segura para log/resposta: só o status HTTP e o campo
 * `msgs` do JSON de erro dos Correios. Nunca o corpo cru — se o servidor
 * ecoar o Authorization, a chave vazaria. Qualquer ocorrência da chave
 * que ainda apareça em `msgs` é mascarada.
 */
export async function erroHttp(res: Response, chave: string): Promise<string> {
  let msgs = "";
  try {
    const corpo = (await res.json()) as { msgs?: unknown };
    if (Array.isArray(corpo.msgs)) {
      msgs = corpo.msgs.filter((m): m is string => typeof m === "string").join(" | ");
    } else if (typeof corpo.msgs === "string") {
      msgs = corpo.msgs;
    }
  } catch {
    // corpo não é JSON: descarta.
  }
  if (chave) msgs = msgs.split(chave).join("***");
  msgs = msgs.slice(0, 200);
  return msgs ? `HTTP ${res.status}: ${msgs}` : `HTTP ${res.status}`;
}

export interface TesteChave {
  ok: boolean;
  /** Mensagem pronta para a tela, em PT-BR. Nunca contém a chave. */
  mensagem: string;
}

/**
 * Testa uma chave de acesso na API Rastro consultando um código real.
 * 401/403 = chave recusada. 200 = chave aceita (mesmo que o objeto não
 * tenha evento). Outros status = Correios com problema, chave não testada.
 */
export async function testarChave(chave: string, codigo: string): Promise<TesteChave> {
  try {
    const res = await fetch(`${RASTRO_URL}/${encodeURIComponent(codigo)}?resultado=U`, {
      headers: {
        Authorization: `Bearer ${chave}`,
        Accept: "application/json",
        "Accept-Language": "pt-BR",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true, mensagem: "Chave aceita pelos Correios." };
    const detalhe = await erroHttp(res, chave);
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        mensagem: `Os Correios recusaram esta chave (${detalhe}). Confira se copiou a chave inteira e se a API SRO-Rastro foi liberada nela.`,
      };
    }
    return {
      ok: false,
      mensagem: `Não foi possível testar agora: os Correios responderam ${detalhe}. Tente de novo em alguns minutos.`,
    };
  } catch (e) {
    const nome = e instanceof Error ? e.name : "erro";
    const causa = e instanceof Error && e.cause && typeof e.cause === "object" && "code" in e.cause ? String(e.cause.code) : "";
    console.warn(`[correios] teste da chave sem resposta: ${nome}${causa ? ` (${causa})` : ""}`);
    const motivo = nome === "TimeoutError" || nome === "AbortError" ? "tempo esgotado" : "falha de rede";
    return { ok: false, mensagem: `Não foi possível falar com os Correios (${motivo}). Tente de novo em alguns minutos.` };
  }
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
      if (!res.ok) throw new Error(await erroHttp(res, chave));
      const data = (await res.json()) as { objetos?: ObjetoApi[] };
      for (const o of data.objetos ?? []) status.set(o.codObjeto, paraStatus(o));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      falhas.push(`lote ${i / LOTE_MAX + 1}: ${chave ? msg.split(chave).join("***") : msg}`);
    }
  }
  return { status, falhas };
}
