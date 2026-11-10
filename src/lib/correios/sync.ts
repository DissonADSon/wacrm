import type { SupabaseClient } from "@supabase/supabase-js";
import { consultarRastreios, normalizarCodigo } from "./rastro";

const RECONSULTAR_APOS_MS = 3 * 60 * 60 * 1000;
const PAGINA = 1000;
// `.in("deal_id", [...])` vai na URL: 100 UUIDs ≈ 3,7 KB, longe do 414.
const LOTE_IDS = 100;

interface ValorCampo {
  deal_id: string;
  deal_custom_field_id: string;
  value: string | null;
  deal: { account_id: string } | null;
}

interface StatusSalvo {
  deal_id: string;
  account_id: string;
  codigo: string;
  entregue: boolean;
  consultado_em: string;
}

/** Quais contas esta rodada cobre: só as de `incluir`, ou todas menos `excluir`. */
export interface FiltroContas {
  incluir?: string[];
  excluir?: string[];
}

interface Pagina<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

export interface Leitura<T> {
  linhas: T[];
  /** true só quando leu exatamente o total que o banco informou. */
  completa: boolean;
}

/**
 * Lê todas as linhas paginando pelo total (`count: "exact"`), não pelo
 * tamanho da página: se o max-rows do PostgREST for menor que PAGINA, o
 * critério `data.length < PAGINA` pararia cedo e truncaria em silêncio.
 */
export async function todas<T>(
  consulta: (de: number, ate: number) => PromiseLike<Pagina<T>>,
): Promise<Leitura<T>> {
  const linhas: T[] = [];
  let total: number | null = null;
  for (;;) {
    const de = linhas.length;
    const { data, error, count } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    if (count != null) total = count;
    if (total == null) return { linhas: [...linhas, ...(data ?? [])], completa: false };
    linhas.push(...(data ?? []));
    if (linhas.length >= total || !data?.length) {
      return { linhas, completa: linhas.length === total };
    }
  }
}

export async function emLotes(ids: string[], fn: (lote: string[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { error } = await fn(ids.slice(i, i + LOTE_IDS));
    if (error) throw new Error(error.message);
  }
}

/**
 * Lê o campo personalizado de rastreio dos cards das contas do filtro,
 * consulta nos Correios só o que ainda não foi entregue e não foi
 * consultado nas últimas 3h, e grava o último evento em deal_tracking_status.
 */
export async function sincronizarRastreios(
  admin: SupabaseClient,
  chave: string,
  filtro: FiltroContas = {},
) {
  const vazio = { consultados: 0, gravados: 0, soErro: 0, removidos: 0, falhas: [] as string[] };
  if (filtro.incluir && !filtro.incluir.length) return vazio;

  const camposLidos = await todas<{ id: string; account_id: string }>((de, ate) => {
    let q = admin
      .from("deal_custom_fields")
      .select("id, account_id", { count: "exact" })
      .ilike("field_name", "%rastre%");
    if (filtro.incluir) q = q.in("account_id", filtro.incluir);
    return q.order("created_at").order("id").range(de, ate).returns<{ id: string; account_id: string }[]>();
  });
  // `excluir` pode ter muitas contas: filtra em memória para não estourar a URL.
  const excluidas = new Set(filtro.excluir ?? []);
  const campos = camposLidos.linhas.filter((c) => !excluidas.has(c.account_id));
  if (!campos?.length) return vazio;

  const ids = campos.map((c) => c.id as string);
  const valores = await todas<ValorCampo>((de, ate) =>
    admin
      .from("deal_custom_values")
      .select("deal_id, deal_custom_field_id, value, deal:deals(account_id)", { count: "exact" })
      .in("deal_custom_field_id", ids)
      .order("id")
      .range(de, ate)
      .returns<ValorCampo[]>(),
  );
  const salvos = await todas<StatusSalvo>((de, ate) => {
    let q = admin
      .from("deal_tracking_status")
      .select("deal_id, account_id, codigo, entregue, consultado_em", { count: "exact" });
    if (filtro.incluir) q = q.in("account_id", filtro.incluir);
    return q.order("deal_id").range(de, ate).returns<StatusSalvo[]>();
  });
  salvos.linhas = salvos.linhas.filter((s) => !excluidas.has(s.account_id));
  const salvoPorDeal = new Map(salvos.linhas.map((s) => [s.deal_id, s]));

  const atual = new Map<string, { codigo: string; account_id: string }>();
  const ordemCampo = new Map(ids.map((id, i) => [id, i]));
  const ordenados = [...valores.linhas].sort(
    (a, b) => (ordemCampo.get(a.deal_custom_field_id) ?? 0) - (ordemCampo.get(b.deal_custom_field_id) ?? 0),
  );
  for (const v of ordenados) {
    const codigo = normalizarCodigo(v.value);
    if (codigo && v.deal && !atual.has(v.deal_id)) {
      atual.set(v.deal_id, { codigo, account_id: v.deal.account_id });
    }
  }

  // Leitura parcial = não dá pra saber o que sumiu. Apagar aí removeria
  // status de cards que só ficaram fora da página.
  const falhas: string[] = [];
  let removidos: string[] = [];
  if (camposLidos.completa && valores.completa && salvos.completa) {
    removidos = salvos.linhas.filter((s) => atual.get(s.deal_id)?.codigo !== s.codigo).map((s) => s.deal_id);
    if (removidos.length) {
      await emLotes(removidos, (lote) => admin.from("deal_tracking_status").delete().in("deal_id", lote));
      for (const id of removidos) salvoPorDeal.delete(id);
    }
  } else {
    falhas.push(
      `leitura incompleta (valores ${valores.linhas.length}${valores.completa ? "" : "?"}, salvos ${salvos.linhas.length}${salvos.completa ? "" : "?"}): limpeza pulada`,
    );
  }

  const agora = Date.now();
  const pendentes = [...atual.entries()].filter(([dealId, p]) => {
    const s = salvoPorDeal.get(dealId);
    if (!s) return true;
    if (s.codigo !== p.codigo) return true;
    return !s.entregue && agora - new Date(s.consultado_em).getTime() > RECONSULTAR_APOS_MS;
  });
  if (!pendentes.length) return { ...vazio, removidos: removidos.length, falhas };

  const codigos = [...new Set(pendentes.map(([, p]) => p.codigo))];
  const consulta = await consultarRastreios(codigos, chave);
  falhas.push(...consulta.falhas);
  const consultadoEm = new Date().toISOString();

  const linhas = [];
  const soErro = new Map<string, string[]>();
  for (const [dealId, p] of pendentes) {
    const s = consulta.status.get(p.codigo);
    if (!s) continue; // lote falhou: tenta de novo na próxima rodada
    if (!s.descricao && salvoPorDeal.get(dealId)?.codigo === p.codigo) {
      // Sem evento novo (ex.: SRO-009): mantém o último evento bom, só anota o erro.
      const msg = s.erro ?? "Sem eventos";
      soErro.set(msg, [...(soErro.get(msg) ?? []), dealId]);
      continue;
    }
    // `codigo` é o do campo (normalizado), não o eco da API: é ele que a
    // comparação de `removidos` usa na próxima rodada.
    linhas.push({ deal_id: dealId, account_id: p.account_id, consultado_em: consultadoEm, ...s, codigo: p.codigo });
  }
  if (linhas.length) {
    const { error } = await admin.from("deal_tracking_status").upsert(linhas, { onConflict: "deal_id" });
    if (error) throw new Error(error.message);
  }
  for (const [erro, dealIds] of soErro) {
    await emLotes(dealIds, (lote) =>
      admin.from("deal_tracking_status").update({ erro, consultado_em: consultadoEm }).in("deal_id", lote),
    );
  }

  return {
    consultados: codigos.length,
    gravados: linhas.length,
    soErro: [...soErro.values()].flat().length,
    removidos: removidos.length,
    falhas,
  };
}
