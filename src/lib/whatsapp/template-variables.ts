// ============================================================
// Variáveis de template: mapeamento {{N}} -> fonte, e resolução dos
// valores a partir do contato + card (deal) da conversa.
//
// Usado em dois lugares:
//   - template-manager: define/edita o mapeamento (a "legenda").
//   - template-picker: pré-preenche os valores no envio individual.
// ============================================================

export type TemplateVariableSource =
  | 'static' // valor fixo digitado
  | 'contact_field' // campo nativo do contato (name/phone/email/company/city)
  | 'contact_custom' // campo personalizado do contato (value = custom_field_id)
  | 'deal_field' // campo nativo do card (title/value)
  | 'deal_custom' // campo personalizado do card (value = deal_custom_field_id)

export interface TemplateVariableMapping {
  source: TemplateVariableSource
  /** Campo/id/valor-fixo, conforme a fonte. */
  value: string
}

/** mapa por índice de variável (1-based, como string): { "1": {...}, "2": {...} } */
export type TemplateVariableMappings = Record<string, TemplateVariableMapping>

/** Campos nativos do contato oferecidos como fonte. */
export const CONTACT_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'name', label: 'Contato: Nome' },
  { value: 'phone', label: 'Contato: Telefone' },
  { value: 'email', label: 'Contato: E-mail' },
  { value: 'company', label: 'Contato: Empresa' },
  { value: 'city', label: 'Contato: Cidade' },
]

/** Campos nativos do card/oportunidade oferecidos como fonte. */
export const DEAL_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'title', label: 'Card: Título' },
  { value: 'value', label: 'Card: Valor' },
]

export interface ResolveContext {
  contact?: {
    name?: string | null
    phone?: string | null
    email?: string | null
    company?: string | null
    city?: string | null
  } | null
  /** custom_field_id -> valor (campos personalizados do contato). */
  contactCustom?: Record<string, string>
  deal?: { title?: string | null; value?: number | string | null } | null
  /** deal_custom_field_id -> valor (campos personalizados do card). */
  dealCustom?: Record<string, string>
}

/** Resolve o valor de UMA variável a partir do mapeamento + contexto. */
export function resolveTemplateValue(
  mapping: TemplateVariableMapping | undefined,
  ctx: ResolveContext,
): string {
  if (!mapping) return ''
  switch (mapping.source) {
    case 'static':
      return mapping.value ?? ''
    case 'contact_field':
      return (
        ((ctx.contact as Record<string, unknown> | null | undefined)?.[
          mapping.value
        ] as string | undefined) ?? ''
      )
    case 'contact_custom':
      return ctx.contactCustom?.[mapping.value] ?? ''
    case 'deal_field': {
      const v = (ctx.deal as Record<string, unknown> | null | undefined)?.[
        mapping.value
      ]
      return v == null ? '' : String(v)
    }
    case 'deal_custom':
      return ctx.dealCustom?.[mapping.value] ?? ''
    default:
      return ''
  }
}

/**
 * Resolve TODOS os valores de body de um template (índices 1..count),
 * devolvendo um array indexado por posição (0-based) pronto pra `params`.
 */
export function resolveTemplateBodyValues(
  mappings: TemplateVariableMappings | null | undefined,
  count: number,
  ctx: ResolveContext,
): string[] {
  const out: string[] = []
  for (let i = 1; i <= count; i++) {
    out.push(resolveTemplateValue(mappings?.[String(i)], ctx))
  }
  return out
}

/** Rótulo legível de uma fonte mapeada (pra "legenda" na UI). */
export function describeMapping(
  mapping: TemplateVariableMapping | undefined,
  opts?: {
    contactCustomLabels?: Record<string, string>
    dealCustomLabels?: Record<string, string>
  },
): string {
  if (!mapping) return 'Preencher na hora'
  switch (mapping.source) {
    case 'static':
      return mapping.value ? `Fixo: "${mapping.value}"` : 'Fixo'
    case 'contact_field':
      return CONTACT_FIELD_OPTIONS.find((o) => o.value === mapping.value)?.label ?? 'Contato'
    case 'contact_custom':
      return `Contato: ${opts?.contactCustomLabels?.[mapping.value] ?? 'campo personalizado'}`
    case 'deal_field':
      return DEAL_FIELD_OPTIONS.find((o) => o.value === mapping.value)?.label ?? 'Card'
    case 'deal_custom':
      return `Card: ${opts?.dealCustomLabels?.[mapping.value] ?? 'campo personalizado'}`
    default:
      return 'Preencher na hora'
  }
}
