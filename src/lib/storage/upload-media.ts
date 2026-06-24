import { createClient } from "@/lib/supabase/client";

/**
 * Shared media-upload helper for Supabase Storage buckets that use the
 * account-scoped path convention introduced in migration 020
 * (`flow-media`) and reused by migration 023 (`chat-media`):
 *
 *   <bucket>/account-<account_id>/<timestamp>-<basename>.<ext>
 *
 * The first path segment (`account-<uuid>`) is what the bucket's RLS
 * write policies match on, so every caller MUST go through here rather
 * than hand-rolling a path — a mismatched segment is silently rejected
 * by RLS. Both the Flows builder (`node-config-form`) and the inbox
 * composer call this so the logic lives in exactly one place.
 */

/** Teto do bucket chat-media — subido p/ 100 MB (migration 026) pra acomodar
 *  documentos grandes. Os caps por tipo abaixo respeitam os limites da Meta. */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Tetos por tipo que espelham os limites da WhatsApp Cloud API da Meta, pra
 * rejeitar no cliente ANTES do upload (senão vira objeto órfão no storage e o
 * envio falha com 400). Limites DUROS da Meta: imagem 5 MB, vídeo 16 MB,
 * áudio 16 MB. Documento a Meta permite até 100 MB — deixamos 95 MB de margem.
 * (Via Evolution/Baileys os limites são maiores; estes são os da API oficial.)
 */
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 95 * 1024 * 1024,
} as const;

/**
 * Build the account-scoped object path for an upload. Pure + exported so
 * it can be unit-tested without a Supabase client.
 *
 * - `basename` is stripped of its extension, lower-cased non-safe chars
 *   are collapsed to `_`, and it's capped at 40 chars (falls back to
 *   "file" when empty).
 * - The timestamp + the original name keep collisions between two
 *   concurrent uploads astronomically unlikely.
 */
export function buildMediaPath(
  accountId: string,
  fileName: string,
  now: number = Date.now(),
): string {
  // Only treat the trailing segment as an extension when there's a real
  // one — a bare name like "README" has no extension and falls back to
  // "bin" rather than becoming "readme".
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split(".").pop()!.toLowerCase() : "bin";
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 40) || "file";
  return `account-${accountId}/${now}-${safeBase}.${ext}`;
}

export interface UploadAccountMediaResult {
  /** Public URL Meta can fetch at send time. */
  publicUrl: string;
  /** Storage object path (account-scoped). */
  path: string;
}

/**
 * Upload a file to an account-scoped Storage bucket and return its public
 * URL. Throws with a user-facing message on auth / account-resolution /
 * upload failure — callers surface it via a toast.
 *
 * Size validation is the caller's responsibility (limits can differ per
 * feature); `MEDIA_MAX_BYTES` is exported for the common case.
 */
export async function uploadAccountMedia(
  bucket: string,
  file: File,
): Promise<UploadAccountMediaResult> {
  const supabase = createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new Error("Você não está conectado.");
  }

  // Resolve account_id so the path is account-scoped (matches the
  // bucket's RLS write policy from migration 020/023). User-scoped
  // paths would be rejected.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileErr || !profile?.account_id) {
    throw new Error("Não foi possível identificar sua conta.");
  }

  const path = buildMediaPath(profile.account_id as string, file.name);
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (upErr) {
    // Traduz os erros mais comuns do Storage para PT-BR claro, em vez de
    // jogar a mensagem técnica/inglês no toast (assim o usuário entende o
    // motivo real — bug Johari #4, em que "não consigo anexar" não dizia
    // se era tipo de arquivo, tamanho ou permissão).
    const m = (upErr.message || "").toLowerCase();
    if (m.includes("mime") || m.includes("not supported") || m.includes("content type")) {
      throw new Error(
        `Tipo de arquivo não suportado (${file.type || "desconhecido"}). ` +
          "Use PDF, JPG, PNG, WEBP, MP4, documentos Office, TXT ou áudio. " +
          "Fotos/vídeos de iPhone (HEIC/MOV) precisam ser convertidos.",
      );
    }
    if (m.includes("exceeded") || m.includes("maximum") || m.includes("too large") || m.includes("413")) {
      throw new Error(
        `O arquivo (${(file.size / 1024 / 1024).toFixed(1)} MB) excede o limite de envio. ` +
          "Tente um arquivo menor ou comprima-o.",
      );
    }
    if (m.includes("row-level") || m.includes("policy") || m.includes("permission")) {
      throw new Error("Sem permissão para anexar mídia nesta conta. Fale com o administrador.");
    }
    throw new Error(upErr.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);

  return { publicUrl, path };
}

/**
 * Delete a previously-uploaded object. Used to GC media that was staged
 * (uploaded) but never sent — a cancelled draft or a failed Meta send —
 * so abandoned attachments don't accumulate in the public bucket. The
 * DELETE is gated by the same account-scoped RLS policy as the upload,
 * so a caller can only remove objects under their own account folder.
 *
 * Best-effort: callers fire-and-forget and swallow errors (a missed
 * delete is a storage nit, not something to surface to the user).
 */
export async function deleteAccountMedia(
  bucket: string,
  path: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}
