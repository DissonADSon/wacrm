// ============================================================
// Envio via Evolution API (Baileys / WhatsApp NÃO-oficial).
//
// Usado pelos números com provider='evolution' (tipicamente o 2º
// número de um cliente, conectado por QR no Evolution em vez da
// WABA oficial). Formato baseado no Evolution API v2.
//
// Por número: base = config.api_base, instance = config.evolution_instance,
// apikey = config.access_token (decriptado pelo resolver).
//
// ⚠️ O payload exato pode variar por versão do Evolution — validar no
// teste real com a instância do cliente. As respostas trazem a chave
// da mensagem em `key.id`.
// ============================================================
import type { MediaKind, MetaSendResult } from './meta-api'

export interface EvolutionTarget {
  /** Base da instância Evolution, ex.: https://evo.exemplo.com.br */
  base: string
  /** Nome da instância no Evolution. */
  instance: string
  /** apikey da instância (vai no header `apikey`). */
  apikey: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evoPost(t: EvolutionTarget, path: string, body: unknown): Promise<any> {
  const url = `${t.base.replace(/\/+$/, '')}/${path}/${encodeURIComponent(t.instance)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: t.apikey },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Evolution API ${res.status}: ${detail.slice(0, 200)}`)
  }
  return res.json().catch(() => ({}))
}

/** Número no formato que o Evolution espera (só dígitos, E.164 sem '+'). */
function toNumber(to: string): string {
  return to.replace(/\D/g, '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickMessageId(resp: any): string {
  return resp?.key?.id || resp?.message?.key?.id || resp?.messageId || resp?.id || ''
}

export interface SendTextEvolutionArgs {
  to: string
  text: string
  /** id da mensagem citada (reply), se houver. */
  quotedId?: string
}

export async function sendTextEvolution(
  t: EvolutionTarget,
  args: SendTextEvolutionArgs,
): Promise<MetaSendResult> {
  const body: Record<string, unknown> = { number: toNumber(args.to), text: args.text }
  if (args.quotedId) body.quoted = { key: { id: args.quotedId } }
  const r = await evoPost(t, 'message/sendText', body)
  return { messageId: pickMessageId(r) }
}

export interface SendMediaEvolutionArgs {
  to: string
  kind: MediaKind
  /** URL pública (ou base64) da mídia. */
  link: string
  caption?: string
  filename?: string
}

export async function sendMediaEvolution(
  t: EvolutionTarget,
  args: SendMediaEvolutionArgs,
): Promise<MetaSendResult> {
  // Áudio vai como nota de voz (PTT) pelo endpoint dedicado do Evolution.
  if (args.kind === 'audio') {
    const r = await evoPost(t, 'message/sendWhatsAppAudio', {
      number: toNumber(args.to),
      audio: args.link,
    })
    return { messageId: pickMessageId(r) }
  }
  const r = await evoPost(t, 'message/sendMedia', {
    number: toNumber(args.to),
    mediatype: args.kind,
    media: args.link,
    caption: args.caption,
    fileName: args.filename,
  })
  return { messageId: pickMessageId(r) }
}

export interface DownloadMediaEvolutionResult {
  /** Conteúdo da mídia em base64 (sem o prefixo data:). */
  base64: string
  mimetype: string
  fileName?: string
}

/**
 * Baixa a mídia de uma mensagem RECEBIDA via Evolution (Baileys não usa o
 * media_id da Meta — a mídia é resolvida pela `key` da mensagem). Usado no
 * webhook de entrada para persistir a mídia no nosso storage. Retorna `null`
 * em qualquer falha (o caller cai num placeholder textual).
 */
export async function downloadMediaEvolution(
  t: EvolutionTarget,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  key: any,
): Promise<DownloadMediaEvolutionResult | null> {
  try {
    const r = await evoPost(t, 'chat/getBase64FromMediaMessage', { message: { key } })
    if (!r?.base64) return null
    return {
      base64: r.base64,
      mimetype: r.mimetype || 'application/octet-stream',
      fileName: r.fileName,
    }
  } catch (e) {
    console.error('[evolution] download de mídia falhou:', e instanceof Error ? e.message : e)
    return null
  }
}
