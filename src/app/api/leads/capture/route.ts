/**
 * Captura pública de lead da VITRINE ADSon (adsonsolucoes.com.br) → contato no CRM.
 *
 * Recebe leads dos formulários da vitrine, encaminhados pelo workflow n8n
 * "ADSon — Vitrine Lead Intake" (server-to-server, NÃO direto do browser).
 * Protegida pelo header secret `x-vitrine-secret`. Cria um contato na account
 * da ADSon Soluções reusando o dedup por telefone (mesmo do webhook/import).
 *
 * Exige telefone: o modelo `contacts` tem `phone` NOT NULL. Leads sem telefone
 * (ex.: só email do "quero ser avisado") não criam contato aqui — o n8n manda
 * só pro app/notificação nesse caso.
 *
 * POST /api/leads/capture
 *   headers: x-vitrine-secret: <VITRINE_LEAD_SECRET>
 *   body: { nome?, telefone, email?, empresa?, origem? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const expected = process.env.VITRINE_LEAD_SECRET
  const accountId = process.env.VITRINE_CRM_ACCOUNT_ID
  if (!expected || !accountId) {
    return NextResponse.json({ error: 'captura não configurada' }, { status: 503 })
  }
  if (req.headers.get('x-vitrine-secret') !== expected) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    nome?: string
    telefone?: string
    email?: string
    empresa?: string
    origem?: string
  }

  const phone = (body.telefone ?? '').trim()
  if (!normalizePhone(phone)) {
    // Sem telefone válido não há contato no CRM (phone NOT NULL). Não é erro do caller.
    return NextResponse.json({ ok: false, skipped: 'sem telefone' }, { status: 200 })
  }

  const db = supabaseAdmin()

  // Resolve o dono da account (user_id é NOT NULL — usado p/ auditoria do contato).
  const { data: account, error: accErr } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .single()
  if (accErr || !account?.owner_user_id) {
    return NextResponse.json({ error: 'account da vitrine não encontrada' }, { status: 500 })
  }

  // Dedup por telefone (mesmo critério do webhook/import).
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) {
    return NextResponse.json({ ok: true, deduped: true, contactId: existing.id }, { status: 200 })
  }

  const insert = {
    account_id: accountId,
    user_id: account.owner_user_id as string,
    phone,
    name: body.nome?.trim() || phone,
    email: body.email?.trim() || null,
    company: body.empresa?.trim() || null,
  }

  const { data: created, error: createErr } = await db
    .from('contacts')
    .insert(insert)
    .select('id')
    .single()

  if (createErr) {
    // Corrida: índice único (account_id, phone_normalized) rejeitou → re-resolve.
    if (isUniqueViolation(createErr)) {
      const raced = await findExistingContact(db, accountId, phone)
      if (raced) return NextResponse.json({ ok: true, deduped: true, contactId: raced.id }, { status: 200 })
    }
    return NextResponse.json({ error: createErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deduped: false, contactId: created.id }, { status: 201 })
}
