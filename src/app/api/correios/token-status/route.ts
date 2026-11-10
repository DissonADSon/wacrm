import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canEditSettings } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { DIAS_AVISO, statusDaChave } from "@/lib/correios/chave";

/**
 * GET /api/correios/token-status
 *
 * Validade da chave de rastreio da conta do usuário. Só quem pode
 * renovar (`canEditSettings`) recebe os dados; os outros recebem vazio.
 * Nunca devolve a chave — só os 4 últimos caracteres.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    if (!canEditSettings(ctx.role)) {
      // Quem não pode renovar não vê validade, aviso nem final da chave.
      return NextResponse.json(
        {
          configurada: false,
          origem: "nenhuma",
          expira_em: null,
          dias_para_expirar: null,
          precisa_renovacao: false,
          expirada: false,
          chave_final: null,
          nome_identificacao: null,
          atualizado_em: null,
          testada_em: null,
          ilegivel: false,
          dias_aviso: DIAS_AVISO,
          pode_editar: false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const status = await statusDaChave(supabaseAdmin(), ctx.accountId);
    return NextResponse.json(
      { ...status, dias_aviso: DIAS_AVISO, pode_editar: canEditSettings(ctx.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
