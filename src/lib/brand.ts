// Marca exibida na UI.
//
// Padrão da agência = "ADSon CRM". Para personalizar por cliente, defina
// NEXT_PUBLIC_APP_NAME no .env.local da instância (ex.: "Johari CRM").
// Por ser NEXT_PUBLIC_*, vale tanto em Server quanto em Client Components.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "ADSon CRM";

// Descrição curta usada em metadata e textos de boas-vindas.
export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
  `${APP_NAME} — CRM para WhatsApp.`;

// Versão do produto, exibida discretamente na UI (rodapé da marca na sidebar).
// MANTER EM SINCRONIA com o campo "version" do package.json a cada release.
// Como é client-visible, é hardcoded aqui em vez de lido do package.json em runtime.
export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "1.0.0";
