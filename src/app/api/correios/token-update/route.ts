import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { DIAS_AVISO, VALIDADE_MAX_DIAS, dataValida, diasAte, hoje, somarDias, statusDaChave } from "@/lib/correios/chave";
import { testarChave } from "@/lib/correios/rastro";
import { encrypt } from "@/lib/whatsapp/encryption";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Objeto qualquer, só para o teste quando a conta ainda não tem código.
const CODIGO_TESTE_PADRAO = "AA123456785BR";

function erro(mensagem: string, status = 400) {
  return NextResponse.json({ error: mensagem }, { status });
}

/**
 * POST /api/correios/token-update
 * body: { token_novo: string, expira_em?: "AAAA-MM-DD", nome_identificacao?: string }
 *
 * Admin+. Testa a chave nova na API Rastro e, se os Correios aceitarem,
 * grava cifrada em correios_config. O agendador usa a chave nova na
 * próxima rodada (até 30 min), sem redeploy. Nunca devolve a chave.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole("admin");

    const limite = checkRateLimit(`correios-token:${ctx.accountId}`, { limit: 10, windowMs: 10 * 60_000 });
    if (!limite.success) return rateLimitResponse(limite);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return erro("Corpo da requisição inválido.");
    }

    const chave = typeof body.token_novo === "string" ? body.token_novo.trim() : "";
    if (!chave) return erro("Cole a chave de acesso gerada no CWS dos Correios.");
    if (/\s/.test(chave)) return erro("A chave não pode ter espaços ou quebras de linha. Copie de novo, só a chave.");
    if (chave.length < 20 || chave.length > 2000) {
      return erro("Isso não parece uma chave de acesso dos Correios. Copie a chave inteira, do primeiro ao último caractere.");
    }

    const hojeStr = hoje();
    const expiraEm = body.expira_em == null || body.expira_em === "" ? somarDias(hojeStr, VALIDADE_MAX_DIAS) : body.expira_em;
    if (!dataValida(expiraEm)) return erro("Data de expiração inválida.");
    const dias = diasAte(expiraEm);
    if (dias < 1) return erro("A data de expiração precisa ser depois de hoje.");
    if (dias > VALIDADE_MAX_DIAS + 1) {
      return erro(`O CWS só libera chaves de até ${VALIDADE_MAX_DIAS} dias. Confira a data de expiração mostrada no CWS.`);
    }

    const nome = typeof body.nome_identificacao === "string" ? body.nome_identificacao.trim().slice(0, 120) : "";

    const admin = supabaseAdmin();
    const { data: amostra } = await admin
      .from("deal_tracking_status")
      .select("codigo")
      .eq("account_id", ctx.accountId)
      .order("consultado_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ codigo: string }>();

    const teste = await testarChave(chave, amostra?.codigo ?? CODIGO_TESTE_PADRAO);
    if (!teste.ok) return erro(teste.mensagem, 422);

    const { error } = await admin.from("correios_config").upsert(
      {
        account_id: ctx.accountId,
        chave_cifrada: encrypt(chave),
        chave_final: chave.slice(-4),
        nome_identificacao: nome || null,
        expira_em: expiraEm,
        testada_em: new Date().toISOString(),
        atualizado_por: ctx.userId,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (error) {
      console.error("[correios/token-update] falha ao gravar:", error.message);
      return erro("A chave foi aceita pelos Correios, mas não deu para salvar. Tente de novo.", 500);
    }

    console.log(`[correios/token-update] chave renovada na conta ${ctx.accountId} por ${ctx.userId}, expira ${expiraEm} (hoje ${hojeStr})`);
    const status = await statusDaChave(admin, ctx.accountId);
    return NextResponse.json({ ok: true, mensagem: teste.mensagem, ...status, dias_aviso: DIAS_AVISO, pode_editar: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
