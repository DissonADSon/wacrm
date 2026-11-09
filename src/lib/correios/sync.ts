import type { SupabaseClient } from "@supabase/supabase-js";
import { consultarRastreios, normalizarCodigo } from "./rastro";

const RECONSULTAR_APOS_MS = 3 * 60 * 60 * 1000;
const PAGINA = 1000;

interface ValorCampo {
  deal_id: string;
  value: string | null;
  deal: { account_id: string } | null;
}

interface StatusSalvo {
  deal_id: string;
  codigo: string;
  entregue: boolean;
  consultado_em: string;
}

async function todas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return linhas;
  }
}

/**
 * Lê o campo personalizado de rastreio de todos os cards, consulta nos
 * Correios só o que ainda não foi entregue e não foi consultado nas
 * últimas 3h, e grava o último evento em deal_tracking_status.
 */
export async function sincronizarRastreios(admin: SupabaseClient, chave: string) {
  const { data: campos, error: errCampos } = await admin
    .from("deal_custom_fields")
    .select("id")
    .ilike("field_name", "%rastre%");
  if (errCampos) throw new Error(errCampos.message);
  if (!campos?.length) return { consultados: 0, gravados: 0, removidos: 0 };

  const ids = campos.map((c) => c.id as string);
  const valores = await todas<ValorCampo>((de, ate) =>
    admin
      .from("deal_custom_values")
      .select("deal_id, value, deal:deals(account_id)")
      .in("deal_custom_field_id", ids)
      .range(de, ate)
      .returns<ValorCampo[]>(),
  );
  const salvos = await todas<StatusSalvo>((de, ate) =>
    admin
      .from("deal_tracking_status")
      .select("deal_id, codigo, entregue, consultado_em")
      .range(de, ate)
      .returns<StatusSalvo[]>(),
  );
  const salvoPorDeal = new Map(salvos.map((s) => [s.deal_id, s]));

  const atual = new Map<string, { codigo: string; account_id: string }>();
  for (const v of valores) {
    const codigo = normalizarCodigo(v.value);
    if (codigo && v.deal) atual.set(v.deal_id, { codigo, account_id: v.deal.account_id });
  }

  const removidos = salvos.filter((s) => atual.get(s.deal_id)?.codigo !== s.codigo).map((s) => s.deal_id);
  if (removidos.length) {
    const { error } = await admin.from("deal_tracking_status").delete().in("deal_id", removidos);
    if (error) throw new Error(error.message);
    for (const id of removidos) salvoPorDeal.delete(id);
  }

  const agora = Date.now();
  const pendentes = [...atual.entries()].filter(([dealId]) => {
    const s = salvoPorDeal.get(dealId);
    if (!s) return true;
    return !s.entregue && agora - new Date(s.consultado_em).getTime() > RECONSULTAR_APOS_MS;
  });
  if (!pendentes.length) return { consultados: 0, gravados: 0, removidos: removidos.length };

  const codigos = [...new Set(pendentes.map(([, p]) => p.codigo))];
  const status = await consultarRastreios(codigos, chave);
  const consultadoEm = new Date().toISOString();

  const linhas = pendentes.map(([dealId, p]) => {
    const s = status.get(p.codigo);
    return {
      deal_id: dealId,
      account_id: p.account_id,
      consultado_em: consultadoEm,
      ...(s ?? {
        codigo: p.codigo,
        descricao: null,
        evento_codigo: null,
        evento_tipo: null,
        cidade: null,
        uf: null,
        evento_em: null,
        previsao_em: null,
        entregue: false,
        erro: "Não retornado pelos Correios",
      }),
    };
  });
  const { error } = await admin.from("deal_tracking_status").upsert(linhas, { onConflict: "deal_id" });
  if (error) throw new Error(error.message);

  return { consultados: codigos.length, gravados: linhas.length, removidos: removidos.length };
}
