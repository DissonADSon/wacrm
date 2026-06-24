// ============================================================
// Webhook do EVOLUTION API (números não-oficiais / Baileys).
//
// O Evolution entrega eventos num formato DIFERENTE da Meta Cloud API
// (evento `messages.upsert`). Esta rota normaliza o payload para o
// mesmo formato interno (WhatsAppMessage) e reusa o `processMessage`
// do webhook oficial — assim contato/conversa/flows/automações
// funcionam igual para os dois tipos de número.
//
// Roteamento: o número Evolution é resolvido pela `evolution_instance`
// que vem no payload (campo `instance`), única por número (migration 025).
//
// ⚠️ O formato do payload pode variar por versão do Evolution — os
// extratores abaixo cobrem o Evolution v2 (conversation /
// extendedTextMessage / imageMessage / audioMessage...). VALIDAR no
// primeiro teste com a instância real e ajustar se necessário.
//
// Mídia inbound: o Evolution não usa media_id da Meta. Por ora a mídia
// recebida entra como texto-placeholder (ex.: "[imagem] legenda") —
// o download/armazenamento real da mídia Evolution é um próximo passo.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  processMessage,
  type WhatsAppMessage,
} from '@/app/api/whatsapp/webhook/route'

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** Extrai o telefone (só dígitos) de um remoteJid tipo "5531...@s.whatsapp.net". */
function phoneFromJid(jid: string): string {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

/**
 * Normaliza a mensagem do Evolution (data.message) para o WhatsAppMessage
 * interno. Texto é tratado nativamente; mídia entra como placeholder textual
 * (com legenda) até o download de mídia Evolution ser implementado.
 */
function normalizeEvolutionMessage(data: Json): WhatsAppMessage | null {
  const key = data?.key ?? {}
  const remoteJid: string = key.remoteJid || ''
  // Ignora mensagens de GRUPO. O CRM é atendimento 1:1; o id do grupo
  // (`@g.us`, ~18 dígitos) não é telefone e quebra o envio da resposta
  // com "Invalid phone number format".
  if (remoteJid.endsWith('@g.us')) return null
  const m = data?.message ?? {}
  // O WhatsApp mascara o remetente como `@lid` (LID) em vários casos de
  // privacidade — aí `remoteJid` é um identificador interno, NÃO o telefone.
  // O número real vem em `senderPn` (sender phone number). Preferir senderPn;
  // só cair pro remoteJid quando não houver. Sem isso, o contato é criado com
  // o LID no lugar do número e a RESPOSTA falha ("number exists:false").
  const from = phoneFromJid(key.senderPn || remoteJid)
  if (!from) return null

  const base = {
    id: key.id || `evo_${data?.messageTimestamp ?? ''}`,
    from,
    timestamp: String(data?.messageTimestamp ?? ''),
  }

  // Texto puro / texto estendido (reply, link preview).
  const text = m.conversation ?? m.extendedTextMessage?.text
  if (typeof text === 'string') {
    return { ...base, type: 'text', text: { body: text } }
  }

  // Mídia — placeholder textual por ora (Evolution não dá media_id da Meta).
  const mediaLabel = (() => {
    if (m.imageMessage) return ['imagem', m.imageMessage.caption]
    if (m.videoMessage) return ['vídeo', m.videoMessage.caption]
    if (m.audioMessage || m.pttMessage) return ['áudio', undefined]
    if (m.documentMessage) return ['documento', m.documentMessage.fileName]
    if (m.stickerMessage) return ['figurinha', undefined]
    return null
  })()
  if (mediaLabel) {
    const [kind, caption] = mediaLabel
    const body = caption ? `[${kind}] ${caption}` : `[${kind}]`
    return { ...base, type: 'text', text: { body } }
  }

  // Tipos não tratados (localização, etc.) — registra como texto genérico.
  return { ...base, type: 'text', text: { body: '[mensagem]' } }
}

export async function POST(request: Request) {
  let payload: Json
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Evolution manda eventos variados; só tratamos mensagens recebidas.
  const event: string = payload?.event ?? ''
  if (event && event !== 'messages.upsert') {
    return NextResponse.json({ ok: true, ignored: event })
  }

  const instance: string = payload?.instance ?? payload?.instanceName ?? ''
  if (!instance) {
    return NextResponse.json({ error: 'instance ausente' }, { status: 400 })
  }

  // Resolve a config Evolution pela instância (única — migration 025).
  const { data: config, error: cfgErr } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, user_id, access_token, evolution_instance, api_base')
    .eq('evolution_instance', instance)
    .maybeSingle()
  if (cfgErr || !config) {
    console.warn('[evolution-webhook] sem config para instance:', instance)
    // 200 pra o Evolution não ficar reenviando indefinidamente.
    return NextResponse.json({ ok: true, unmatched: true })
  }

  // O payload pode trazer 1 mensagem (data) ou um array. Normaliza pra lista.
  const items: Json[] = Array.isArray(payload?.data) ? payload.data : [payload?.data]

  for (const data of items) {
    if (!data) continue
    // Ignora mensagens enviadas por nós (eco do fromMe).
    if (data?.key?.fromMe) continue

    const message = normalizeEvolutionMessage(data)
    if (!message) continue

    const contact = {
      profile: { name: data?.pushName || message.from },
      wa_id: message.from,
    }

    try {
      await processMessage(
        message,
        contact,
        config.account_id,
        config.user_id,
        decrypt(config.access_token),
        config.id,
        config.api_base ?? null,
      )
    } catch (err) {
      console.error('[evolution-webhook] processMessage falhou:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
