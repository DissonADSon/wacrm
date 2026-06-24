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
import { downloadMediaEvolution, type EvolutionTarget } from '@/lib/whatsapp/evolution-api'
import {
  processMessage,
  handleStatusUpdate,
  type WhatsAppMessage,
} from '@/app/api/whatsapp/webhook/route'

// Mapa de status do Baileys/Evolution → ladder interno (Meta-style) que o
// handleStatusUpdate e o CHECK de messages.status entendem. O Evolution
// entrega como string (SERVER_ACK/DELIVERY_ACK/READ/PLAYED); algumas versões
// mandam o enum numérico do Baileys (2/3/4/5) — cobrimos os dois.
const EVOLUTION_STATUS_MAP: Record<string, string> = {
  PENDING: 'pending',
  ERROR: 'failed',
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  '0': 'failed',
  '1': 'pending',
  '2': 'sent',
  '3': 'delivered',
  '4': 'read',
  '5': 'read',
}

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ============================================================
// Guarda anti-flood por instância (BLINDAGEM da stack compartilhada).
//
// Um número de altíssimo volume (ex.: bot) pode despejar uma enxurrada de
// eventos (status/mensagens) e saturar o app + Supabase, derrubando TODOS os
// clientes da stack. Aqui limitamos quantos eventos de UMA instância são
// processados por janela; o excesso é aceito (200) e DESCARTADO. Janela
// deslizante em memória do processo — sem dependência externa. Tetos por
// env pra ajustar sem redeploy de código.
// ============================================================
const FLOOD_WINDOW_MS = Number(process.env.EVOLUTION_FLOOD_WINDOW_MS) || 10_000
const FLOOD_MAX = Number(process.env.EVOLUTION_FLOOD_MAX) || 120
const floodState = new Map<string, { count: number; resetAt: number }>()

/**
 * True quando a instância excedeu o teto de EVENTOS na janela atual.
 * `n` = quantos eventos este POST traz (payload.data pode ser um array), pra
 * o teto refletir o trabalho real (round-trips ao banco por evento), não o
 * nº de requisições — um lote grande num único POST conta como N.
 */
function isFlooding(instance: string, n: number): boolean {
  const now = Date.now()
  const s = floodState.get(instance)
  if (!s || now >= s.resetAt) {
    floodState.set(instance, { count: n, resetAt: now + FLOOD_WINDOW_MS })
    return n > FLOOD_MAX
  }
  const before = s.count
  s.count += n
  if (before <= FLOOD_MAX && s.count > FLOOD_MAX) {
    console.warn(`[evolution-webhook] FLOOD: instância ${instance} excedeu ${FLOOD_MAX}/${FLOOD_WINDOW_MS}ms — descartando excesso`)
  }
  return s.count > FLOOD_MAX
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

  // Mídia — emite o tipo correto. O download dos bytes + upload no storage
  // (e o preenchimento do `url`) acontece no handler do POST, que tem o
  // alvo Evolution (base/instância/apikey) e a `key` p/ baixar via Baileys.
  // Áudio (PTT) vem como audioMessage com ptt:true, não como tipo separado.
  if (m.imageMessage) {
    return { ...base, ...ctxField, type: 'image', image: { id: base.id, mime_type: m.imageMessage.mimetype || 'image/jpeg', caption: m.imageMessage.caption } }
  }
  if (m.videoMessage) {
    return { ...base, ...ctxField, type: 'video', video: { id: base.id, mime_type: m.videoMessage.mimetype || 'video/mp4', caption: m.videoMessage.caption } }
  }
  if (m.audioMessage) {
    return { ...base, ...ctxField, type: 'audio', audio: { id: base.id, mime_type: m.audioMessage.mimetype || 'audio/ogg' } }
  }
  if (m.documentMessage) {
    return { ...base, ...ctxField, type: 'document', document: { id: base.id, mime_type: m.documentMessage.mimetype || 'application/octet-stream', filename: m.documentMessage.fileName, caption: m.documentMessage.caption } }
  }
  if (m.stickerMessage) {
    return { ...base, ...ctxField, type: 'sticker', sticker: { id: base.id, mime_type: m.stickerMessage.mimetype || 'image/webp' } }
  }

  // Tipo não suportado (enquete, etc.) — descarta em vez de criar "[mensagem]".
  console.warn('[evolution-webhook] tipo não tratado, descartado:', Object.keys(m).join(','))
  return null
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker'])
const KIND_LABEL: Record<string, string> = {
  image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento', sticker: 'figurinha',
}

/**
 * Baixa a mídia de uma mensagem Evolution e sobe no bucket `chat-media`
 * (service role; path account-scoped igual ao da mídia enviada). Preenche
 * `message.<tipo>.url` com a URL pública. Em qualquer falha, converte a
 * mensagem num placeholder textual ("[imagem] legenda") pra não virar bolha
 * vazia (o parse cairia no proxy Cloud API, que não existe no Baileys).
 */
async function resolveEvolutionMedia(
  message: WhatsAppMessage,
  data: Json,
  target: EvolutionTarget,
  accountId: string,
): Promise<void> {
  const kind = message.type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const media = (message as any)[kind] as { mime_type?: string; caption?: string; filename?: string; url?: string } | undefined
  if (!media) return
  const dl = await downloadMediaEvolution(target, data?.key)
  if (dl?.base64) {
    const mimetype = dl.mimetype || media.mime_type || 'application/octet-stream'
    const ext = (mimetype.split('/')[1] || 'bin').split(';')[0]
    const fileName = dl.fileName || media.filename || `${kind}.${ext}`
    const url = await storeEvolutionMedia(accountId, dl.base64, mimetype, fileName)
    if (url) {
      media.url = url
      media.mime_type = mimetype
      return
    }
  }
  // Fallback: download/upload falhou → vira texto placeholder (não bolha vazia).
  const label = KIND_LABEL[kind] || 'arquivo'
  const body = media.caption ? `[${label}] ${media.caption}` : `[${label}]`
  message.type = 'text'
  message.text = { body }
}

/** Path account-scoped do objeto no storage (mesma convenção de upload-media.ts,
 *  inline aqui p/ não importar módulo client-side num route server). */
function mediaPath(accountId: string, fileName: string, mimetype: string): string {
  const hasExt = /\.[^.]+$/.test(fileName)
  const ext = hasExt
    ? fileName.split('.').pop()!.toLowerCase()
    : (mimetype.split('/')[1] || 'bin').split(';')[0]
  const safeBase =
    fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'file'
  return `account-${accountId}/${Date.now()}-${safeBase}.${ext}`
}

/** Sobe um base64 no bucket chat-media (service role) e devolve a URL pública. */
async function storeEvolutionMedia(
  accountId: string,
  base64: string,
  mimetype: string,
  fileName: string,
): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, 'base64')
    const path = mediaPath(accountId, fileName, mimetype)
    const admin = supabaseAdmin()
    const { error } = await admin.storage
      .from('chat-media')
      .upload(path, buffer, { contentType: mimetype, upsert: false })
    if (error) {
      console.error('[evolution-webhook] upload de mídia falhou:', error.message)
      return null
    }
    const { data } = admin.storage.from('chat-media').getPublicUrl(path)
    return data.publicUrl
  } catch (e) {
    console.error('[evolution-webhook] storeEvolutionMedia erro:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function POST(request: Request) {
  let payload: Json
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // Evolution manda eventos variados. Tratamos: messages.upsert (recebidas) e
  // messages.update (ACK de status: entregue/lido das que ENVIAMOS). Normaliza
  // o nome do evento (MESSAGES_UPDATE → messages.update).
  const event: string = payload?.event ?? ''
  const ev = event.toLowerCase().replace(/_/g, '.')
  if (event && ev !== 'messages.upsert' && ev !== 'messages.update') {
    return NextResponse.json({ ok: true, ignored: event })
  }

  const instance: string = payload?.instance ?? payload?.instanceName ?? ''
  if (!instance) {
    return NextResponse.json({ error: 'instance ausente' }, { status: 400 })
  }

  // BLINDAGEM: descarta o excesso de uma instância em rajada (protege a stack
  // compartilhada de uma enxurrada que derrubaria todos os clientes). 200 pra
  // o Evolution não reenviar. Conta EVENTOS do lote, não requisições.
  const eventCount = Array.isArray(payload?.data) ? Math.max(payload.data.length, 1) : 1
  if (isFlooding(instance, eventCount)) {
    return NextResponse.json({ ok: true, throttled: true })
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

  // ACK de status (entregue/lido) das mensagens que enviamos por este número.
  // Atualiza messages.status + broadcast_recipients via handleStatusUpdate.
  if (ev === 'messages.update') {
    // Coalescing: status só avança (read>delivered>sent), e o que importa é o
    // MAIS avançado por mensagem — colapsa N updates do mesmo id num só.
    // Filtra `fromMe` (status é das mensagens que NÓS enviamos) p/ não gastar
    // query com ACK de mensagens que não são nossas. Reduz drasticamente a
    // carga de um número de alto volume.
    const RANK: Record<string, number> = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 }
    const best = new Map<string, { status: string; ts: string; recipient: string }>()
    for (const data of items) {
      if (!data?.key?.id || !data?.key?.fromMe) continue
      const raw = data?.update?.status ?? data?.status ?? data?.update?.messageStatus
      const mapped = raw != null ? EVOLUTION_STATUS_MAP[String(raw)] : undefined
      if (!mapped) continue
      const tsNum = Number(data?.messageTimestamp)
      const ts = String(Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Math.floor(Date.now() / 1000))
      const cur = best.get(data.key.id)
      if (!cur || (RANK[mapped] ?? -1) > (RANK[cur.status] ?? -1)) {
        best.set(data.key.id, {
          status: mapped,
          ts,
          recipient: phoneFromJid(data?.key?.senderPn || data?.key?.remoteJid || ''),
        })
      }
    }
    let updated = 0
    for (const [id, v] of best) {
      try {
        await handleStatusUpdate({ id, status: v.status, timestamp: v.ts, recipient_id: v.recipient })
        updated++
      } catch (err) {
        console.error('[evolution-webhook] status update falhou:', err)
      }
    }
    return NextResponse.json({ ok: true, statusUpdates: updated })
  }

  for (const data of items) {
    if (!data) continue
    // Ignora mensagens enviadas por nós (eco do fromMe).
    if (data?.key?.fromMe) continue

    const message = normalizeEvolutionMessage(data)
    if (!message) continue

    // Mídia recebida: baixa via Evolution e sobe no nosso storage (preenche
    // message.<tipo>.url). Em falha, vira placeholder textual.
    if (MEDIA_TYPES.has(message.type)) {
      const target: EvolutionTarget = {
        base: config.api_base || '',
        instance: config.evolution_instance,
        apikey: decrypt(config.access_token),
      }
      await resolveEvolutionMedia(message, data, target, config.account_id)
    }

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
