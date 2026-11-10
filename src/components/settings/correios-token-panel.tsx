"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  Truck,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  EVENTO_CHAVE_ATUALIZADA,
  formatarData,
  frasePrazo,
  useCorreiosChave,
  type StatusChaveCorreios,
} from "@/hooks/use-correios-chave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

const VALIDADE_MAX_DIAS = 180;

const LINKS = {
  chaves: "https://cws.correios.com.br/chaves-acesso",
  manualChaves:
    "https://www.correios.com.br/atendimento/developers/arquivos/orientacoes-para-subdelegacao-de-acesso-1.pdf",
  manualApi: "https://www.correios.com.br/atendimento/developers/arquivos/manual-para-integracao-correios-api",
  ajudaCws: "https://cws.correios.com.br/ajuda",
};

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function formatarInstante(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function LinkExterno({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

function tom(status: StatusChaveCorreios | null): "ok" | "alerta" | "erro" | "neutro" {
  if (!status || !status.configurada) return "neutro";
  if (status.ilegivel || status.expirada) return "erro";
  if (status.precisa_renovacao) return "alerta";
  return "ok";
}

const CORES_TOM = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  alerta: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  erro: "border-destructive/40 bg-destructive/10 text-destructive",
  neutro: "border-border bg-muted text-muted-foreground",
} as const;

function CartaoStatus({ status, carregando }: { status: StatusChaveCorreios | null; carregando: boolean }) {
  const t = tom(status);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <CalendarClock className="size-4 text-primary" />
          Chave em uso
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          O CRM avisa com um pop-up 3 dias antes do vencimento. Troque a cada 180 dias.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {carregando && !status ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : status && !status.pode_editar ? (
          <p className="text-sm text-muted-foreground">
            A validade da chave só aparece para administradores da conta.
          </p>
        ) : !status?.configurada ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma chave cadastrada. O rastreio dos pedidos está desligado até você salvar uma chave abaixo.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <div>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {status.expirada ? "Venceu em" : "Válida até"}
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatarData(status.expira_em)}
                </div>
              </div>
              <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", CORES_TOM[t])}>
                {status.ilegivel ? "precisa salvar de novo" : frasePrazo(status.dias_para_expirar)}
              </span>
            </div>

            {status.ilegivel ? (
              <Alert variant="destructive">
                <ShieldAlert className="size-4" />
                <AlertTitle>A chave salva não pôde ser lida</AlertTitle>
                <AlertDescription>
                  Gere uma chave nova no CWS e salve abaixo. Enquanto isso, o rastreio não atualiza.
                </AlertDescription>
              </Alert>
            ) : status.expirada ? (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>O rastreio parou de atualizar</AlertTitle>
                <AlertDescription>
                  A chave venceu. Gere uma nova no CWS e salve abaixo: o rastreio volta sozinho em até 30 minutos.
                </AlertDescription>
              </Alert>
            ) : null}

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Final da chave</dt>
                <dd className="font-mono text-foreground">••••{status.chave_final ?? "????"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nome no CWS</dt>
                <dd className="text-foreground">
                  {status.nome_identificacao ?? (status.origem === "ambiente" ? "CRM - Rastro (instalada pela ADSon)" : "—")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Trocada em</dt>
                <dd className="text-foreground">
                  {status.origem === "ambiente" ? "na instalação do rastreio" : formatarInstante(status.atualizado_em)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Testada com os Correios</dt>
                <dd className="text-foreground">{formatarInstante(status.testada_em)}</dd>
              </div>
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PassoAPasso() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Truck className="size-4 text-primary" />
          Como gerar a chave nova nos Correios
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Uns 5 minutos. Faça no computador, com o login do Meu Correios da empresa em mãos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3 text-sm text-foreground">
          {[
            <>
              Abra o <LinkExterno href={LINKS.chaves}>CWS dos Correios, menu Chaves de Acesso</LinkExterno> e entre
              com o usuário e a senha do <strong>Meu Correios</strong> da empresa.
            </>,
            <>
              Clique em <strong>&ldquo;Criar nova Chave&rdquo;</strong>.
            </>,
            <>
              Preencha <strong>Nome de identificação</strong> (ex.: <em>CRM - Rastro</em>), <strong>Descrição</strong>{" "}
              (ex.: <em>Rastreio dos pedidos no CRM</em>) e, em <strong>Expiração</strong>, escolha o prazo máximo:{" "}
              <strong>180 dias</strong>.
            </>,
            <>
              Escolha <strong>&ldquo;APIs restritas por contrato&rdquo;</strong> e digite o número do contrato dos
              Correios. Todas as APIs do contrato aparecem: libere a <strong>SRO-Rastro</strong> (sem ela a chave é recusada).
            </>,
            <>
              Clique em <strong>&ldquo;Criar nova chave&rdquo;</strong>. A chave aparece na tela: copie ela inteira.
            </>,
            <>
              Volte aqui, cole no campo <strong>Chave de acesso</strong> abaixo, confira a data de expiração que o CWS
              mostrou e clique em <strong>Testar e salvar</strong>. O CRM testa a chave com os Correios antes de
              guardar.
            </>,
            <>
              Depois de salvar, se quiser, volte ao CWS e clique em <strong>&ldquo;Revogar Chave&rdquo;</strong> na
              chave <em>antiga</em> do CRM. Ela vence sozinha de qualquer jeito.
            </>,
          ].map((passo, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-0.5 leading-relaxed">{passo}</span>
            </li>
          ))}
        </ol>

        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Não mexa no &ldquo;código de acesso&rdquo;</AlertTitle>
          <AlertDescription>
            Use só o menu <strong>Chaves de Acesso</strong>. Não clique em <strong>Gestão de acesso a APIs</strong>{" "}
            nem gere um novo código de acesso: isso desliga o cálculo de frete da loja.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
          <LinkExterno href={LINKS.manualChaves}>Manual dos Correios: chaves de acesso (PDF)</LinkExterno>
          <LinkExterno href={LINKS.manualApi}>Manual da API dos Correios (PDF)</LinkExterno>
          <LinkExterno href={LINKS.ajudaCws}>Ajuda do CWS</LinkExterno>
        </div>
      </CardContent>
    </Card>
  );
}

function FormularioChave({ onSalvo }: { onSalvo: (s: StatusChaveCorreios) => void }) {
  const padrao = somarDias(hojeSaoPaulo(), VALIDADE_MAX_DIAS);
  const [chave, setChave] = useState("");
  const [expiraEm, setExpiraEm] = useState(padrao);
  const [nome, setNome] = useState("CRM - Rastro");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!chave.trim()) {
      setErro("Cole a chave de acesso gerada no CWS dos Correios.");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/correios/token-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_novo: chave.trim(), expira_em: expiraEm, nome_identificacao: nome }),
      });
      const corpo = (await res.json().catch(() => ({}))) as Partial<StatusChaveCorreios> & {
        error?: string;
        mensagem?: string;
      };
      if (!res.ok) {
        setErro(
          res.status === 403
            ? "Só administradores da conta podem trocar a chave."
            : res.status === 429
              ? "Muitas tentativas seguidas. Espere 10 minutos e tente de novo."
              : (corpo.error ?? "Não deu para salvar a chave. Tente de novo."),
        );
        return;
      }
      setChave("");
      setMostrar(false);
      toast.success("Chave nova salva. O rastreio já usa ela na próxima atualização.");
      onSalvo(corpo as StatusChaveCorreios);
    } catch {
      setErro("Sem conexão com o CRM. Confira a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <KeyRound className="size-4 text-primary" />
          Colar a chave nova
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          A chave fica guardada cifrada. Ninguém consegue ver ela inteira depois de salva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={salvar} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="correios-chave" className="text-foreground">
              Chave de acesso
            </Label>
            <div className="relative">
              <Input
                id="correios-chave"
                type={mostrar ? "text" : "password"}
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                placeholder="Cole aqui a chave copiada do CWS"
                autoComplete="off"
                spellCheck={false}
                className="pr-10 font-mono"
                disabled={salvando}
              />
              <button
                type="button"
                onClick={() => setMostrar((v) => !v)}
                aria-label={mostrar ? "Esconder chave" : "Mostrar chave"}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                {mostrar ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="correios-expira" className="text-foreground">
                Expira em
              </Label>
              <Input
                id="correios-expira"
                type="date"
                value={expiraEm}
                min={somarDias(hojeSaoPaulo(), 1)}
                max={somarDias(hojeSaoPaulo(), VALIDADE_MAX_DIAS + 1)}
                onChange={(e) => setExpiraEm(e.target.value)}
                disabled={salvando}
                required
              />
              <p className="text-xs text-muted-foreground">
                Já vem com hoje + 180 dias. Se escolheu outro prazo no CWS, ajuste.
              </p>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="correios-nome" className="text-foreground">
                Nome dado no CWS <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="correios-nome"
                value={nome}
                maxLength={120}
                onChange={(e) => setNome(e.target.value)}
                disabled={salvando}
              />
            </div>
          </div>

          {erro ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Chave não salva</AlertTitle>
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={salvando} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {salvando ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Testando com os Correios...
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                Testar e salvar
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Configurações > Rastreio Correios: validade da chave da API Rastro,
 * passo a passo para gerar a nova no CWS e o formulário para colar.
 */
export function CorreiosTokenPanel() {
  const { canEditSettings, profileLoading } = useAuth();
  const { status, carregando } = useCorreiosChave();
  // O evento atualiza este painel e o aviso do cabeçalho de uma vez.
  function aoSalvar(novo: StatusChaveCorreios) {
    window.dispatchEvent(new CustomEvent(EVENTO_CHAVE_ATUALIZADA, { detail: novo }));
  }

  return (
    <section className="max-w-3xl space-y-4 animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Rastreio Correios"
        description="A chave que deixa o CRM consultar o rastreio dos pedidos nos Correios. Ela vence a cada 180 dias e é renovada aqui mesmo, sem chamar o suporte."
      />
      <CartaoStatus status={status} carregando={carregando} />
      <PassoAPasso />
      {profileLoading ? null : canEditSettings ? (
        <FormularioChave onSalvo={aoSalvar} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Só administradores da conta podem trocar a chave. Peça para um administrador seguir os passos acima.
        </p>
      )}
    </section>
  );
}
