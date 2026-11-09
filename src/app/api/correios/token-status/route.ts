import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canEditSettings } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { DIAS_AVISO, statusDaChave } from "@/lib/correios/chave";

/**
 * GET /api/correios/token-status
 *
 * Validade da chave de rastreio da conta do usuário. Qualquer membro
 * consulta (o aviso aparece para quem pode renovar: `pode_editar`).
 * Nunca devolve a chave — só os 4 últimos caracteres.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const status = await statusDaChave(supabaseAdmin(), ctx.accountId);
    return NextResponse.json(
      { ...status, dias_aviso: DIAS_AVISO, pode_editar: canEditSettings(ctx.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
