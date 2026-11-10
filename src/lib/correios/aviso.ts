import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageTemplate } from "@/types";
import { normalizarCodigo } from "./rastro";
import { todas, type Leitura } from "./sync";
import { resolveWhatsappConfig, type ResolvedWhatsappConfig } from "@/lib/whatsapp/config-resolver";
import { sendText, sendTemplate } from "@/lib/whatsapp/sender";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";

const LOTE_IDS = 100;
const MIN = 60 * 1000;
const JANELA_MS = 24 * 60 * MIN;
// Código mexido há mais tempo que isso não dispara: evita aviso
// retroativo se a carga inicial (migração 035) deixar algum de fora.
export const RECENTE_MS = 24 * 60 * MIN;
// "enviando" parado além disso = processo caiu no meio: volta pra fila.
export const PRESO_MS = 15 * MIN;
export const MAX_TENTATIVAS = 3;
// Espera antes da tentativa N+1: 15 min × N.
export const ESPERA_MS = 15 * MIN;
// Preferência de template fora da janela de 24h: o primeiro aprovado vence.
export const TEMPLATES_AVISO = ["rastreio_postado", "envio_pedido"];
export const LINK_RASTREIO = "https://rastreamento.correios.com.br/app/index.php";

interface Contato {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface ValorAviso {
  deal_id: string;
  deal_custom_field_id: string;
  value: string | null;
  updated_at: string | null;
  deal: {
    account_id: string;
    user_id: string;
    contact_id: string | null;
    contact: Contato | null;
  } | null;
}

export interface AvisoSalvo {
  deal_id: string;
  codigo: string;
  status: "enviando" | "enviado" | "falhou" | "legado";
  tentativas: number;
  tentado_em: string | null;
  criado_em: string;
}

export interface Pendente {
  dealId: string;
  codigo: string;
  accountId: string;
  userId: string;
  contato: Contato | null;
  /** Aviso já existente a retomar (nova tentativa ou envio preso). */
  retomar?: AvisoSalvo;
}

/** Falha que não se resolve tentando de novo (falta dado no card). */
class FalhaDefinitiva extends Error {}

export function primeiroNome(nome: string | null | undefined): string {
  const n = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  // Nome salvo como telefone ou vazio: o template exige texto no {{1}}.
  return n && /\p{L}/u.test(n) ? n : "cliente";
}

export function textoAviso(nome: string, codigo: string, loja: string): string {
  return (
    `Olá, ${nome}! Seu pedido ${loja} foi postado nos Correios. 📦\n\n` +
    `Código de rastreio: ${codigo}\n\n` +
    "O sistema dos Correios pode levar algumas horas para atualizar o rastreio. " +
    "Se o código ainda não aparecer, tente de novo mais tarde.\n\n" +
    `Acompanhe em: ${LINK_RASTREIO}`
  );
}

/** Aviso existente que deve ser tentado de novo agora. */
export function deveRetomar(a: AvisoSalvo, agora: number): boolean {
  const tentado = a.tentado_em ? Date.parse(a.tentado_em) : Date.parse(a.criado_em);
  if (a.status === "enviando") return agora - tentado > PRESO_MS && a.tentativas < MAX_TENTATIVAS;
  if (a.status !== "falhou" || a.tentativas >= MAX_TENTATIVAS) return false;
  if (agora - Date.parse(a.criado_em) > RECENTE_MS) return false;
  return agora - tentado >= ESPERA_MS * Math.max(1, a.tentativas);
}

/**
 * O que fazer nesta rodada. Por card vale um código só (o do primeiro
 * campo de rastreio). Código novo e recente → aviso novo; código com
 * aviso que falhou ou travou → nova tentativa, se ainda couber.
 */
export function escolherPendentes(
  valores: ValorAviso[],
  ordemCampo: Map<string, number>,
  avisos: Map<string, AvisoSalvo>,
  agora: number,
): Pendente[] {
  const ordenados = [...valores].sort(
    (a, b) => (ordemCampo.get(a.deal_custom_field_id) ?? 0) - (ordemCampo.get(b.deal_custom_field_id) ?? 0),
  );
  const vistos = new Set<string>();
  const out: Pendente[] = [];
  for (const v of ordenados) {
    if (vistos.has(v.deal_id) || !v.deal) continue;
    const codigo = normalizarCodigo(v.value);
    if (!codigo) continue;
    vistos.add(v.deal_id);
    const base = {
      dealId: v.deal_id,
      codigo,
      accountId: v.deal.account_id,
      userId: v.deal.user_id,
      contato: v.deal.contact,
    };
    const salvo = avisos.get(`${v.deal_id}|${codigo}`);
    if (salvo) {
      if (deveRetomar(salvo, agora)) out.push({ ...base, retomar: salvo });
      continue;
    }
    const mexido = v.updated_at ? Date.parse(v.updated_at) : NaN;
    if (agora - mexido <= RECENTE_MS) out.push(base);
  }
  return out;
}

function erroCurto(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 200);
}

function variaveis(corpo: string | null | undefined): number {
  return new Set([...(corpo ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;
}

async function templateAprovado(admin: SupabaseClient, accountId: string): Promise<MessageTemplate | null> {
  const { data, error } = await admin
    .from("message_templates")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "APPROVED")
    .in("name", TEMPLATES_AVISO);
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as MessageTemplate[];
  // Só serve template com exatamente {{1}} nome e {{2}} código.
  for (const nome of TEMPLATES_AVISO) {
    const t = linhas.find((l) => l.name === nome && variaveis(l.body_text) === 2);
    if (t) return t;
  }
  return null;
}

async function conversaDoContato(
  admin: SupabaseClient,
  accountId: string,
  contatoId: string,
): Promise<{ id: string; whatsapp_config_id: string | null } | null> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, whatsapp_config_id")
    .eq("account_id", accountId)
    .eq("contact_id", contatoId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function janelaAberta(admin: SupabaseClient, conversaId: string, agora: number): Promise<boolean> {
  const { data, error } = await admin
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversaId)
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const ultima = data?.[0]?.created_at as string | undefined;
  return !!ultima && agora - Date.parse(ultima) < JANELA_MS;
}

interface Envio {
  messageId: string | null;
  canal: string;
  conteudo: { content_type: "text" | "template"; content_text: string | null; template_name: string | null };
}

async function enviar(
  admin: SupabaseClient,
  cfg: ResolvedWhatsappConfig,
  p: Pendente,
  telefone: string,
  conversaId: string | null,
  loja: string,
  agora: number,
): Promise<Envio> {
  const nome = primeiroNome(p.contato?.name);
  const texto = textoAviso(nome, p.codigo, loja);
  // Número não oficial (Evolution) manda texto livre sempre; oficial só
  // dentro da janela de 24h, fora dela a Meta exige template.
  const livre = cfg.provider === "evolution" || (!!conversaId && (await janelaAberta(admin, conversaId, agora)));
  let template: MessageTemplate | null = null;
  if (!livre) {
    template = await templateAprovado(admin, p.accountId);
    if (!template) throw new Error("Fora da janela de 24h e sem template de rastreio aprovado pela Meta");
  }

  let ultimoErro: unknown = null;
  for (const v of phoneVariants(telefone)) {
    try {
      const r = template
        ? await sendTemplate(cfg, {
            to: v,
            templateName: template.name,
            language: template.language,
            template,
            messageParams: { body: [nome, p.codigo] },
          })
        : await sendText(cfg, { to: v, text: texto });
      return {
        messageId: r.messageId || null,
        canal: template ? `template ${template.name}` : "texto",
        conteudo: template
          ? { content_type: "template", content_text: null, template_name: template.name }
          : { content_type: "text", content_text: texto, template_name: null },
      };
    } catch (e) {
      if (!isRecipientNotAllowedError(e instanceof Error ? e.message : String(e))) throw e;
      ultimoErro = e;
    }
  }
  throw ultimoErro ?? new Error("Nenhuma variação do telefone aceita");
}

async function gravar(admin: SupabaseClient, p: Pendente, campos: Record<string, unknown>) {
  const { error } = await admin.from("deal_tracking_notice").update(campos).eq("deal_id", p.dealId).eq("codigo", p.codigo);
  if (error) throw new Error(error.message);
}

/** Manda um aviso já reservado e grava o resultado. Falha vira status "falhou". */
async function avisar(admin: SupabaseClient, p: Pendente, loja: string, agora: number): Promise<"enviado" | "falhou"> {
  try {
    if (!p.contato?.phone) throw new FalhaDefinitiva("Card sem contato com telefone");
    const telefone = sanitizePhoneForMeta(p.contato.phone);
    if (!isValidE164(telefone)) throw new FalhaDefinitiva(`Telefone inválido: ${p.contato.phone}`);

    const conversa = await conversaDoContato(admin, p.accountId, p.contato.id);
    const cfg = await resolveWhatsappConfig(admin, p.accountId, {
      configId: conversa?.whatsapp_config_id ?? undefined,
    });
    if (!cfg) throw new FalhaDefinitiva("Conta sem número de WhatsApp configurado");

    const envio = await enviar(admin, cfg, p, telefone, conversa?.id ?? null, loja, agora);
    const enviadoEm = new Date().toISOString();
    // Grava o wamid antes da mensagem: a falha que o webhook trouxer já acha o aviso.
    await gravar(admin, p, {
      status: "enviado",
      canal: envio.canal,
      message_id: envio.messageId,
      enviado_em: enviadoEm,
      erro: null,
    });

    let conversaId = conversa?.id ?? null;
    if (!conversaId) {
      const { data, error } = await admin
        .from("conversations")
        .insert({ account_id: p.accountId, user_id: p.userId, contact_id: p.contato.id, whatsapp_config_id: cfg.id })
        .select("id")
        .single();
      if (error) console.error("[aviso-rastreio] conversa não criada", error.message);
      conversaId = data?.id ?? null;
    }
    if (conversaId) {
      // Aparece na conversa do CRM para toda a equipe ver o que foi mandado.
      const { error } = await admin.from("messages").insert({
        conversation_id: conversaId,
        sender_type: "bot",
        ...envio.conteudo,
        message_id: envio.messageId,
        status: "sent",
      });
      if (error) console.error("[aviso-rastreio] mensagem enviada mas não gravada", error.message);
      await admin
        .from("conversations")
        .update({
          last_message_text: envio.conteudo.content_text ?? `[template:${envio.conteudo.template_name}]`,
          last_message_at: enviadoEm,
          updated_at: enviadoEm,
        })
        .eq("id", conversaId);
    }
    return "enviado";
  } catch (e) {
    await gravar(admin, p, {
      status: "falhou",
      erro: erroCurto(e),
      // Falta dado no card: não adianta repetir até alguém corrigir o card.
      ...(e instanceof FalhaDefinitiva ? { tentativas: MAX_TENTATIVAS } : {}),
    });
    return "falhou";
  }
}

/**
 * Reserva o aviso antes do envio. Novo: insert que não sobrescreve.
 * Retomada: update condicionado ao estado lido. Nos dois casos, se
 * outra rodada chegou antes, não volta linha e o card é pulado.
 */
async function reservar(admin: SupabaseClient, p: Pendente, agora: number): Promise<boolean> {
  const agoraIso = new Date(agora).toISOString();
  if (!p.retomar) {
    const { data, error } = await admin
      .from("deal_tracking_notice")
      .upsert(
        { deal_id: p.dealId, codigo: p.codigo, account_id: p.accountId, status: "enviando", tentativas: 1, tentado_em: agoraIso },
        { onConflict: "deal_id,codigo", ignoreDuplicates: true },
      )
      .select("deal_id");
    if (error) throw new Error(error.message);
    return !!data?.length;
  }
  const r = p.retomar;
  let q = admin
    .from("deal_tracking_notice")
    .update({ status: "enviando", tentativas: r.tentativas + 1, tentado_em: agoraIso, erro: null })
    .eq("deal_id", p.dealId)
    .eq("codigo", p.codigo)
    .eq("status", r.status)
    .eq("tentativas", r.tentativas);
  q = r.tentado_em ? q.eq("tentado_em", r.tentado_em) : q.is("tentado_em", null);
  const { data, error } = await q.select("deal_id");
  if (error) throw new Error(error.message);
  return !!data?.length;
}

/**
 * Procura códigos de rastreio novos nos cards e avisa o cliente no
 * WhatsApp. Um card com erro não derruba os outros.
 */
export async function avisarNovosCodigos(admin: SupabaseClient, agora = Date.now()) {
  const campos = await todas<{ id: string }>((de, ate) =>
    admin
      .from("deal_custom_fields")
      .select("id", { count: "exact" })
      .ilike("field_name", "%rastre%")
      .order("created_at")
      .order("id")
      .range(de, ate)
      .returns<{ id: string }[]>(),
  );
  const vazio = { novos: 0, retomados: 0, enviados: 0, falhas: 0, erros: [] as string[] };
  if (!campos.linhas.length) return vazio;
  const ids = campos.linhas.map((c) => c.id);
  const ordemCampo = new Map(ids.map((id, i) => [id, i]));

  const valores: Leitura<ValorAviso> = { linhas: [], completa: true };
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const lote = ids.slice(i, i + LOTE_IDS);
    const parte = await todas<ValorAviso>((de, ate) =>
      admin
        .from("deal_custom_values")
        .select(
          "deal_id, deal_custom_field_id, value, updated_at, deal:deals(account_id, user_id, contact_id, contact:contacts(id, name, phone))",
          { count: "exact" },
        )
        .in("deal_custom_field_id", lote)
        .order("id")
        .range(de, ate)
        .returns<ValorAviso[]>(),
    );
    valores.linhas.push(...parte.linhas);
  }

  const avisos = await todas<AvisoSalvo>((de, ate) =>
    admin
      .from("deal_tracking_notice")
      .select("deal_id, codigo, status, tentativas, tentado_em, criado_em", { count: "exact" })
      .order("deal_id")
      .order("codigo")
      .range(de, ate)
      .returns<AvisoSalvo[]>(),
  );
  // Leitura parcial dos avisos = risco de tratar enviado como novo. Pula a rodada.
  if (!avisos.completa) throw new Error(`leitura incompleta dos avisos (${avisos.linhas.length})`);
  const porChave = new Map(avisos.linhas.map((a) => [`${a.deal_id}|${a.codigo}`, a]));

  const pendentes = escolherPendentes(valores.linhas, ordemCampo, porChave, agora);
  if (!pendentes.length) return vazio;

  const contas = [...new Set(pendentes.map((p) => p.accountId))];
  const { data: nomes } = await admin.from("accounts").select("id, name").in("id", contas);
  const loja = new Map((nomes ?? []).map((a) => [a.id as string, (a.name as string) || "da loja"]));

  const r = { ...vazio, erros: [] as string[] };
  for (const p of pendentes) {
    try {
      if (!(await reservar(admin, p, agora))) continue;
      if (p.retomar) r.retomados++;
      else r.novos++;
      const res = await avisar(admin, p, loja.get(p.accountId) ?? "da loja", agora);
      if (res === "enviado") r.enviados++;
      else r.falhas++;
    } catch (e) {
      r.erros.push(`${p.dealId}: ${erroCurto(e)}`);
    }
  }
  return r;
}
