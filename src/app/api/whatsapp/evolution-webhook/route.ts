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
import { isValidE164 } from '@/lib/whatsapp/phone-utils'
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

/** Extrai só dígitos do remoteJid/senderPn (ex.: "5531...:12@s.whatsapp.net" -> "5531..."). */
function phoneFromJid(jid: string): string {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

/**
 * Desempacota mensagens "embrulhadas" do Baileys — temporárias (ephemeral),
 * visualização única (viewOnce) e documento-com-legenda. O conteúdo real fica
 * um nível abaixo; sem desempacotar, foto/texto temporário some no fallback.
 */
function unwrapMessage(m: Json): Json {
  let cur = m ?? {}
  for (let i = 0; i < 5; i++) {
    const inner =
      cur.ephemeralMessage ||
      cur.viewOnceMessage ||
      cur.viewOnceMessageV2 ||
      cur.viewOnceMessageV2Extension ||
      cur.documentWithCaptionMessage
    if (inner && inner.message) cur = inner.message
    else break
  }
  return cur
}

/**
 * Normaliza um evento do Evolution (Baileys) para o WhatsAppMessage interno.
 * O CRM nasceu para a Meta Cloud API; o Baileys difere bastante, então aqui:
 * filtra JIDs de sistema (grupo/canal/lista/status), resolve o número real
 * (LID via senderPn), desempacota mensagens aninhadas e mapeia os tipos
 * relevantes. Tipos não suportados são DESCARTADOS (return null) em vez de
 * virar lixo "[mensagem]" que polui inbox/contatos e dispara automações à toa.
 */
function normalizeEvolutionMessage(data: Json): WhatsAppMessage | null {
  const key = data?.key ?? {}
  const remoteJid: string = key.remoteJid || ''
  const isUser = remoteJid.endsWith('@s.whatsapp.net')
  const isLid = remoteJid.endsWith('@lid')
  // Allowlist: só conversa 1:1 real. Barra grupo (@g.us), canal (@newsletter),
  // lista de transmissão (@broadcast) e status (status@broadcast) — esses IDs
  // não são telefone; virariam contato/conversa lixo + auto-resposta inválida.
  if (!isUser && !isLid) return null
  // Número real: em @lid o telefone vem em senderPn; sem ele NÃO usamos o LID
  // (não é telefone — a resposta falharia com "number exists:false"). Descarta.
  const senderPn: string = key.senderPn || key.participantPn || ''
  if (isLid && !senderPn) return null
  const from = phoneFromJid(senderPn || remoteJid)
  // Rede de segurança: só segue se o resultado parece um telefone E.164
  // (descarta resíduos de IDs de sistema que escapem da allowlist).
  if (!from || !isValidE164(from)) return null

  // Timestamp robusto: messageTimestamp ausente/zero não pode virar Date(NaN),
  // que estouraria e descartaria a mensagem no insert.
  const tsNum = Number(data?.messageTimestamp)
  const timestamp = String(
    Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Math.floor(Date.now() / 1000),
  )
  const base = { id: key.id || `evo_${timestamp}`, from, timestamp }

  const m = unwrapMessage(data?.message ?? {})

  // Reação do cliente → roteada para message_reactions (não vira mensagem nova).
  if (m.reactionMessage) {
    return {
      ...base,
      type: 'reaction',
      reaction: { message_id: m.reactionMessage.key?.id || '', emoji: m.reactionMessage.text || '' },
    }
  }
  // Edição/revoke/efêmero de protocolo — não é conteúdo. Descarta.
  if (m.protocolMessage) return null

  // Reply citado (swipe-reply): id da mensagem citada vem em contextInfo.
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo
  const ctxField = ctx?.stanzaId ? { context: { id: ctx.stanzaId as string } } : {}

  // Texto puro / estendido (reply, link preview).
  const text = m.conversation ?? m.extendedTextMessage?.text
  if (typeof text === 'string') {
    return { ...base, ...ctxField, type: 'text', text: { body: text } }
  }

  // Localização.
  const loc = m.locationMessage || m.liveLocationMessage
  if (loc && (loc.degreesLatitude != null || loc.degreesLongitude != null)) {
    return {
      ...base,
      ...ctxField,
      type: 'location',
      location: {
        latitude: Number(loc.degreesLatitude) || 0,
        longitude: Number(loc.degreesLongitude) || 0,
        name: loc.name,
        address: loc.address,
      },
    }
  }

  // Resposta de botão / lista (interactive) — alimenta o engine de Flows.
  const btn = m.buttonsResponseMessage || m.templateButtonReplyMessage
  if (btn) {
    return {
      ...base,
      ...ctxField,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: btn.selectedButtonId || btn.selectedId || '', title: btn.selectedDisplayText || '' },
      },
    }
  }
  const list = m.listResponseMessage
  if (list?.singleSelectReply) {
    return {
      ...base,
      ...ctxField,
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: list.singleSelectReply.selectedRowId || '', title: list.title || '' },
      },
    }
  }

  // Contato (vCard) — sem tipo nativo no CRM; entra como texto com o nome.
  if (m.contactMessage) {
    const body = `[contato] ${m.contactMessage.displayName || ''}`.trim()
    return { ...base, ...ctxField, type: 'text', text: { body } }
  }

  // Mídia — placeholder textual por ora (download de mídia Evolution é o
  // próximo passo; o Baileys não usa media_id da Meta). Áudio (PTT) vem como
  // audioMessage com ptt:true, não como tipo separado.
  const mediaLabel: [string, string | undefined] | null = (() => {
    if (m.imageMessage) return ['imagem', m.imageMessage.caption]
    if (m.videoMessage) return ['vídeo', m.videoMessage.caption]
    if (m.audioMessage) return ['áudio', undefined]
    if (m.documentMessage) return ['documento', m.documentMessage.fileName || m.documentMessage.caption]
    if (m.stickerMessage) return ['figurinha', undefined]
    return null
  })()
  if (mediaLabel) {
    const [kind, caption] = mediaLabel
    const body = caption ? `[${kind}] ${caption}` : `[${kind}]`
    return { ...base, ...ctxField, type: 'text', text: { body } }
  }

  // Tipo não suportado (enquete, etc.) — descarta em vez de criar "[mensagem]".
  console.warn('[evolution-webhook] tipo não tratado, descartado:', Object.keys(m).join(','))
  return null
}

export async function POST(request: Request) {
  let payload: Json
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
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
