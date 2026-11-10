import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";

/**
 * Chave de acesso da API Rastro (CWS dos Correios).
 *
 * Fonte, em ordem: a chave que o admin salvou no painel (tabela
 * correios_config, cifrada) e, se a conta não tiver, a variável de
 * ambiente CORREIOS_CHAVE_ACESSO. A chave do CWS é opaca (não é JWT),
 * então a validade é a data que o admin informa ao salvar — o CWS
 * aceita no máximo 180 dias e revoga sozinho no fim do prazo.
 *
 * Server-only. Nada daqui devolve a chave para o front.
 */

/** Dias antes do vencimento em que o aviso aparece. */
export const DIAS_AVISO = 3;
/** Validade máxima de uma chave no CWS. */
export const VALIDADE_MAX_DIAS = 180;

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function hojeSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function hoje(agora = new Date()): string {
  return hojeSaoPaulo(agora);
}

/** Dias corridos de hoje (horário de Brasília) até `expiraEm`. Negativo = vencida. */
export function diasAte(expiraEm: string, agora = new Date()): number {
  const [a1, m1, d1] = hojeSaoPaulo(agora).split("-").map(Number);
  const [a2, m2, d2] = expiraEm.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

export function dataValida(v: unknown): v is string {
  if (typeof v !== "string" || !DATA_RE.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Validade da chave do ambiente vem de CORREIOS_CHAVE_EXPIRA_EM; sem ela é
// desconhecida (null): o agendador não pula a chave e a tela diz "sem data".
function expiraEmAmbiente(): string | null {
  const v = process.env.CORREIOS_CHAVE_EXPIRA_EM;
  return dataValida(v) ? v : null;
}

interface LinhaConfig {
  account_id: string;
  chave_cifrada: string;
  chave_final: string | null;
  nome_identificacao: string | null;
  expira_em: string;
  testada_em: string | null;
  atualizado_em: string;
}

// 42P01 = tabela não existe (migration 034 ainda não aplicada).
function tabelaAusente(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /correios_config/.test(e.message ?? ""));
}

export interface ChaveConta {
  chave: string;
  expiraEm: string | null;
}

export interface ChavesCarregadas {
  /** Chave salva no painel, por conta. */
  porConta: Map<string, ChaveConta>;
  /** Contas com linha no painel cuja chave não pôde ser decifrada. */
  ilegiveis: string[];
  /** Chave do ambiente (vale para as contas sem linha no painel). */
  ambiente: ChaveConta | null;
}

/** Usado pelo agendador: todas as chaves que dá para usar agora. */
export async function carregarChaves(admin: SupabaseClient): Promise<ChavesCarregadas> {
  const porConta = new Map<string, ChaveConta>();
  const ilegiveis: string[] = [];
  const { data, error } = await admin
    .from("correios_config")
    .select("account_id, chave_cifrada, expira_em")
    .returns<Pick<LinhaConfig, "account_id" | "chave_cifrada" | "expira_em">[]>();
  if (error && !tabelaAusente(error)) throw new Error(`correios_config: ${error.message}`);
  for (const l of data ?? []) {
    try {
      porConta.set(l.account_id, { chave: decrypt(l.chave_cifrada), expiraEm: l.expira_em });
    } catch {
      ilegiveis.push(l.account_id);
    }
  }
  const env = process.env.CORREIOS_CHAVE_ACESSO?.trim();
  return { porConta, ilegiveis, ambiente: env ? { chave: env, expiraEm: expiraEmAmbiente() } : null };
}

export interface StatusChave {
  /** false = nenhuma chave (rastreio desligado para a conta). */
  configurada: boolean;
  origem: "painel" | "ambiente" | "nenhuma";
  expira_em: string | null;
  dias_para_expirar: number | null;
  /** true quando faltam DIAS_AVISO dias ou menos (inclui vencida). */
  precisa_renovacao: boolean;
  expirada: boolean;
  /** Últimos 4 caracteres, só para ela reconhecer qual chave está salva. */
  chave_final: string | null;
  nome_identificacao: string | null;
  atualizado_em: string | null;
  testada_em: string | null;
  /** A chave do painel existe mas não decifra (ENCRYPTION_KEY mudou). */
  ilegivel: boolean;
}

function montar(expiraEm: string | null, resto: Omit<StatusChave, "expira_em" | "dias_para_expirar" | "precisa_renovacao" | "expirada">, agora: Date): StatusChave {
  const dias = expiraEm ? diasAte(expiraEm, agora) : null;
  return {
    ...resto,
    expira_em: expiraEm,
    dias_para_expirar: dias,
    // Conta sem rastreio não recebe aviso: não há o que renovar.
    precisa_renovacao: resto.configurada && (resto.ilegivel || (dias != null && dias <= DIAS_AVISO)),
    expirada: dias != null && dias < 0,
  };
}

/** Status da chave de uma conta, sem nunca expor a chave. */
export async function statusDaChave(admin: SupabaseClient, accountId: string, agora = new Date()): Promise<StatusChave> {
  const { data, error } = await admin
    .from("correios_config")
    .select("account_id, chave_cifrada, chave_final, nome_identificacao, expira_em, testada_em, atualizado_em")
    .eq("account_id", accountId)
    .maybeSingle<LinhaConfig>();
  if (error && !tabelaAusente(error)) throw new Error(`correios_config: ${error.message}`);

  if (data) {
    let ilegivel = false;
    try {
      decrypt(data.chave_cifrada);
    } catch {
      ilegivel = true;
    }
    return montar(
      data.expira_em,
      {
        configurada: true,
        origem: "painel",
        chave_final: data.chave_final,
        nome_identificacao: data.nome_identificacao,
        atualizado_em: data.atualizado_em,
        testada_em: data.testada_em,
        ilegivel,
      },
      agora,
    );
  }

  const env = process.env.CORREIOS_CHAVE_ACESSO?.trim();
  if (env) {
    return montar(
      expiraEmAmbiente(),
      {
        configurada: true,
        origem: "ambiente",
        chave_final: env.slice(-4),
        nome_identificacao: null,
        atualizado_em: null,
        testada_em: null,
        ilegivel: false,
      },
      agora,
    );
  }

  return montar(
    null,
    {
      configurada: false,
      origem: "nenhuma",
      chave_final: null,
      nome_identificacao: null,
      atualizado_em: null,
      testada_em: null,
      ilegivel: false,
    },
    agora,
  );
}
