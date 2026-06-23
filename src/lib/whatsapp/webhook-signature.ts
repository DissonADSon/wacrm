import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  // Aceita dois modos de operação, ambos com `x-hub-signature-256`:
  //   - Meta direto: assina o body cru com o META_APP_SECRET (App Secret).
  //   - Via EvoHub (proxy): o Hub reassina o body cru com o
  //     EVOLUTION_HUB_WEBHOOK_SECRET (o `secret` do webhook cadastrado no Hub).
  // Verifica contra qualquer secret configurado — assim o mesmo deploy
  // funciona com Meta direto ou atrás do EvoHub sem mudar código.
  const secrets = [
    process.env.EVOLUTION_HUB_WEBHOOK_SECRET,
    process.env.META_APP_SECRET,
  ].filter((s): s is string => Boolean(s))

  if (secrets.length === 0) {
    console.error(
      '[webhook] nenhum secret configurado — rejeitando. Defina ' +
        'META_APP_SECRET (Meta direto) ou EVOLUTION_HUB_WEBHOOK_SECRET (EvoHub) ' +
        'para habilitar a verificação de assinatura.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const received = Buffer.from(signatureHeader)
  for (const secret of secrets) {
    const expected = Buffer.from(
      'sha256=' +
        crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
    )
    // timingSafeEqual exige mesmo tamanho; pula se diferente.
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) {
      return true
    }
  }
  return false
}
