// ============================================================
// Camada de ENVIO unificada por provider.
//
// Recebe uma config já resolvida (resolveWhatsappConfig) e roteia o
// envio para o transporte certo:
//   - provider 'evohub' | 'cloud'  -> meta-api (dialeto Meta Cloud API)
//   - provider 'evolution'         -> evolution-api (Baileys / não-oficial)
//
// Recursos só do Cloud API (template, reaction, interactive) degradam
// ou lançam erro claro quando o número é Evolution.
//
// Todos retornam { messageId } (MetaSendResult).
// ============================================================
import type { ResolvedWhatsappConfig } from './config-resolver'
import type { MessageTemplate } from '@/types'
import type { SendTimeParams } from './template-send-builder'
import type {
  MediaKind,
  MetaSendResult,
  InteractiveButton,
  InteractiveListSection,
} from './meta-api'
import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendReactionMessage,
  sendInteractiveButtons as metaSendInteractiveButtons,
  sendInteractiveList as metaSendInteractiveList,
} from './meta-api'
import { sendTextEvolution, sendMediaEvolution } from './evolution-api'

function isEvolution(cfg: ResolvedWhatsappConfig): boolean {
  return cfg.provider === 'evolution'
}

function evoTarget(cfg: ResolvedWhatsappConfig) {
  if (!cfg.apiBase || !cfg.evolutionInstance) {
    throw new Error(
      'Número Evolution sem api_base/evolution_instance configurados.',
    )
  }
  return { base: cfg.apiBase, instance: cfg.evolutionInstance, apikey: cfg.accessToken }
}

export async function sendText(
  cfg: ResolvedWhatsappConfig,
  opts: { to: string; text: string; contextMessageId?: string },
): Promise<MetaSendResult> {
  if (isEvolution(cfg)) {
    return sendTextEvolution(evoTarget(cfg), {
      to: opts.to,
      text: opts.text,
      quotedId: opts.contextMessageId,
    })
  }
  return sendTextMessage({
    phoneNumberId: cfg.phone_number_id,
    accessToken: cfg.accessToken,
    to: opts.to,
    text: opts.text,
    contextMessageId: opts.contextMessageId,
  })
}

export async function sendMedia(
  cfg: ResolvedWhatsappConfig,
  opts: {
    to: string
    kind: MediaKind
    link: string
    caption?: string
    filename?: string
    contextMessageId?: string
  },
): Promise<MetaSendResult> {
  if (isEvolution(cfg)) {
    return sendMediaEvolution(evoTarget(cfg), {
      to: opts.to,
      kind: opts.kind,
      link: opts.link,
      caption: opts.caption,
      filename: opts.filename,
    })
  }
  return sendMediaMessage({
    phoneNumberId: cfg.phone_number_id,
    accessToken: cfg.accessToken,
    to: opts.to,
    kind: opts.kind,
    link: opts.link,
    caption: opts.caption,
    filename: opts.filename,
    contextMessageId: opts.contextMessageId,
  })
}

export async function sendTemplate(
  cfg: ResolvedWhatsappConfig,
  opts: {
    to: string
    templateName: string
    language?: string
    params?: string[]
    /**
     * Linha do template (message_templates). Quando presente, monta
     * os components completos (header + body + buttons) — única forma
     * de headers de mídia e botões com variável chegarem ao destino.
     */
    template?: MessageTemplate
    /** Valores estruturados por envio (body/header/botões). */
    messageParams?: SendTimeParams
    contextMessageId?: string
  },
): Promise<MetaSendResult> {
  if (isEvolution(cfg)) {
    throw new Error(
      'Templates da Meta não existem em número Evolution (não-oficial). Use texto/mídia.',
    )
  }
  return sendTemplateMessage({
    phoneNumberId: cfg.phone_number_id,
    accessToken: cfg.accessToken,
    to: opts.to,
    templateName: opts.templateName,
    language: opts.language,
    params: opts.params,
    template: opts.template,
    messageParams: opts.messageParams,
    contextMessageId: opts.contextMessageId,
  })
}

export async function sendReaction(
  cfg: ResolvedWhatsappConfig,
  opts: { to: string; targetMessageId: string; emoji: string },
): Promise<MetaSendResult> {
  // Reações em Evolution não são suportadas aqui — degrada silenciosamente
  // (a UI já mostrou a reação localmente; só não propaga ao WhatsApp).
  if (isEvolution(cfg)) return { messageId: '' }
  return sendReactionMessage({
    phoneNumberId: cfg.phone_number_id,
    accessToken: cfg.accessToken,
    to: opts.to,
    targetMessageId: opts.targetMessageId,
    emoji: opts.emoji,
  })
}

export async function sendInteractiveButtons(
  cfg: ResolvedWhatsappConfig,
  opts: {
    to: string
    bodyText: string
    headerText?: string
    footerText?: string
    buttons: InteractiveButton[]
    contextMessageId?: string
  },
): Promise<MetaSendResult> {
  // Evolution/Baileys não tem botões interativos confiáveis — degrada
  // para texto com opções numeradas (o flow runner casa pela resposta).
  if (isEvolution(cfg)) {
    const lines = opts.buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n')
    const text = [opts.headerText, opts.bodyText, lines, opts.footerText]
      .filter(Boolean)
      .join('\n\n')
    return sendText(cfg, { to: opts.to, text, contextMessageId: opts.contextMessageId })
  }
  return metaSendInteractiveButtons({
    phoneNumberId: cfg.phone_number_id,
    accessToken: cfg.accessToken,
    to: opts.to,
    bodyText: opts.bodyText,
    headerText: opts.headerText,
    footerText: opts.footerText,
    buttons: opts.buttons,
    contextMessageId: opts.contextMessageId,
  })
}

export async function sendInteractiveList(
  cfg: ResolvedWhatsappConfig,
  opts: {
    to: string
    bodyText: string
    buttonLabel: string
    headerText?: string
    footerText?: string
    sections: InteractiveListSection[]
    contextMessageId?: string
  },
): Promise<MetaSendResult> {
  if (isEvolution(cfg)) {
    const lines = opts.sections
      .flatMap((s) => s.rows.map((r) => `• ${r.title}`))
      .join('\n')
    const text = [opts.headerText, opts.bodyText, lines, opts.footerText]
      .filter(Boolean)
      .join('\n\n')
    return sendText(cfg, { to: opts.to, text, contextMessageId: opts.contextMessageId })
  }
  return metaSendInteractiveList({
    phoneNumberId: cfg.phone_number_id,
    accessToken: cfg.accessToken,
    to: opts.to,
    bodyText: opts.bodyText,
    buttonLabel: opts.buttonLabel,
    headerText: opts.headerText,
    footerText: opts.footerText,
    sections: opts.sections,
    contextMessageId: opts.contextMessageId,
  })
}
