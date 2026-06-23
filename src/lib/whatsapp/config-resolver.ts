// ============================================================
// Resolução de config WhatsApp por número (multi-número por conta).
//
// Antes, cada caller de ENVIO fazia:
//   .from('whatsapp_config').select('*').eq('account_id', X).single()
// que assume 1 número por conta e ESTOURA PGRST116 quando há 2+.
//
// Este helper resolve a config CERTA para um contexto de envio, na
// ordem: configId explícito > conversation.whatsapp_config_id >
// phone_number_id > número default da conta (is_default) > o único.
// Também decripta o token e faz o "GCM upgrade" preguiçoso (igual o
// send route fazia inline).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from './encryption'

export type WhatsappProvider = 'evohub' | 'cloud' | 'evolution'

export interface ResolvedWhatsappConfig {
  id: string
  account_id: string
  phone_number_id: string
  waba_id: string | null
  /** Token já decriptado, pronto pra usar como Bearer. */
  accessToken: string
  provider: WhatsappProvider
  /** Override da base da API por número (NULL = base global do deploy). */
  apiBase: string | null
  /** Instância do Evolution (só quando provider='evolution'). */
  evolutionInstance: string | null
  status: string
}

export interface ResolveConfigOpts {
  /** Escolhe explicitamente uma config pelo id. */
  configId?: string | null
  /** Resolve pelo número que a conversa usa (conversations.whatsapp_config_id). */
  conversationId?: string | null
  /** Resolve por número (phone_number_id). */
  phoneNumberId?: string | null
}

const COLUMNS =
  'id, account_id, phone_number_id, waba_id, access_token, status, provider, api_base, evolution_instance, is_default, created_at'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

function finalize(supabase: SupabaseClient, row: Row): ResolvedWhatsappConfig {
  // GCM upgrade preguiçoso (fire-and-forget) — mesmo comportamento do send route.
  if (isLegacyFormat(row.access_token)) {
    void supabase
      .from('whatsapp_config')
      .update({ access_token: encrypt(decrypt(row.access_token)) })
      .eq('id', row.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn('[wa config-resolver] GCM upgrade falhou:', error.message)
        }
      })
  }
  return {
    id: row.id,
    account_id: row.account_id,
    phone_number_id: row.phone_number_id,
    waba_id: row.waba_id ?? null,
    accessToken: decrypt(row.access_token),
    provider: (row.provider ?? 'evohub') as WhatsappProvider,
    apiBase: row.api_base ?? null,
    evolutionInstance: row.evolution_instance ?? null,
    status: row.status,
  }
}

/**
 * Resolve a config WhatsApp a usar para enviar, dentro de uma conta.
 * Retorna `null` se a conta não tem número configurado.
 */
export async function resolveWhatsappConfig(
  supabase: SupabaseClient,
  accountId: string,
  opts: ResolveConfigOpts = {},
): Promise<ResolvedWhatsappConfig | null> {
  // 1. id explícito
  if (opts.configId) {
    const { data } = await supabase
      .from('whatsapp_config')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .eq('id', opts.configId)
      .maybeSingle()
    if (data) return finalize(supabase, data)
  }

  // 2. pelo número da conversa
  if (opts.conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('id', opts.conversationId)
      .maybeSingle()
    if (conv?.whatsapp_config_id) {
      const { data } = await supabase
        .from('whatsapp_config')
        .select(COLUMNS)
        .eq('account_id', accountId)
        .eq('id', conv.whatsapp_config_id)
        .maybeSingle()
      if (data) return finalize(supabase, data)
    }
  }

  // 3. por phone_number_id
  if (opts.phoneNumberId) {
    const { data } = await supabase
      .from('whatsapp_config')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .eq('phone_number_id', opts.phoneNumberId)
      .maybeSingle()
    if (data) return finalize(supabase, data)
  }

  // 4. número default da conta (is_default), senão o mais antigo.
  //    Cobre a conta com 1 número (comportamento idêntico ao de antes).
  const { data: rows } = await supabase
    .from('whatsapp_config')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
  const row = rows?.[0]
  return row ? finalize(supabase, row) : null
}

/** Lista todos os números de uma conta (pra UI de settings e contagem/cobrança). */
export async function listWhatsappConfigs(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ResolvedWhatsappConfig[]> {
  const { data: rows } = await supabase
    .from('whatsapp_config')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  return (rows ?? []).map((r: Row) => finalize(supabase, r))
}
