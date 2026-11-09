import { redirect } from "next/navigation";

// Endereço curto para o aviso e para quem for passar o link:
// a tela de verdade é a seção "Rastreio Correios" das Configurações.
export default function CorreiosTokenPage() {
  redirect("/settings?tab=correios");
}
