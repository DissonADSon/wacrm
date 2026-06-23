import { uploadResumableMedia } from '@/lib/whatsapp/meta-api'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE header — a plain public
 * URL is not accepted at creation time. This helper turns the template's
 * `header_media_url` (whether the user uploaded a file or pasted a link)
 * into a handle and writes it onto the payload, so both the upload path
 * and the legacy URL path actually succeed.
 *
 * No-op unless the header is an image that has a URL but no handle yet.
 * Image-only for now (the #230 scope); video/document handles can follow
 * the same shape.
 */

// Meta's image-header sample limits.
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png']

export async function ensureImageHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
): Promise<void> {
  if (payload.header_type !== 'image') return
  if (payload.header_handle) return // already have one
  if (!payload.header_media_url) return // validator already requires url-or-handle

  const appId = process.env.META_APP_ID
  if (!appId) {
    throw new Error(
      'Templates com cabeçalho de imagem precisam de META_APP_ID definido (usado no Resumable Upload da Meta). Adicione-o ao seu ambiente ou remova o cabeçalho de imagem.',
    )
  }

  // Fetch the sample image bytes (works for our uploaded chat-media URL
  // and for a manually-pasted public link).
  let res: Response
  try {
    res = await fetch(payload.header_media_url)
  } catch {
    throw new Error('Não foi possível buscar a URL da imagem do cabeçalho. Verifique se ela está acessível publicamente.')
  }
  if (!res.ok) {
    throw new Error(`A URL da imagem do cabeçalho retornou ${res.status}. Ela precisa estar acessível publicamente.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw new Error(`A imagem do cabeçalho precisa ser JPEG ou PNG (recebido ${contentType}).`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error('A imagem do cabeçalho está vazia.')
  }
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new Error(
      `A imagem do cabeçalho tem ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — o limite da Meta é 5 MB.`,
    )
  }

  const mimeType = ALLOWED_IMAGE_TYPES.includes(contentType) ? contentType : 'image/jpeg'
  const fileName = mimeType === 'image/png' ? 'header.png' : 'header.jpg'

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  })
  payload.header_handle = handle
}
