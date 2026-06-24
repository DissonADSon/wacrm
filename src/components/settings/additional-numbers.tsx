'use client';

// ============================================================
// Números adicionais (multi-número).
//
// Lista os números WhatsApp da conta e permite ADICIONAR um número
// extra via Evolution (Baileys / não-oficial). Respeita o limite da
// conta (gate comercial): se o limite foi atingido, mostra o aviso
// de "contrate um número adicional" em vez do formulário.
//
// O número WABA principal é gerido acima (componente WhatsAppConfig);
// aqui ficam os números adicionais.
// ============================================================
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface NumberRow {
  id: string;
  label: string | null;
  provider: string;
  phone_number_id: string;
  evolution_instance: string | null;
  status: string;
  is_default: boolean;
}

const providerLabel: Record<string, string> = {
  evohub: 'WABA (EvoHub)',
  cloud: 'WABA (Cloud API)',
  evolution: 'Evolution (Baileys)',
};

// Preço do número adicional não-WABA (Evolution) e destino da solicitação.
// Por ora aponta para a landing de contratação; trocar por um webhook de
// provisionamento depois (basta mudar a env, sem tocar no componente).
const NUMERO_ADICIONAL_PRECO = 'R$ 49,90/mês';
const CONTRATAR_NUMERO_URL =
  process.env.NEXT_PUBLIC_CONTRATAR_NUMERO_URL || 'https://adsonsolucoes.com.br/contrate';

export function AdditionalNumbers() {
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [limit, setLimit] = useState(1);
  const [canAdd, setCanAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form Evolution
  const [label, setLabel] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [instance, setInstance] = useState('');
  const [apikey, setApikey] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/whatsapp/numbers');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setNumbers(data.numbers ?? []);
      setLimit(data.limit ?? 1);
      setCanAdd(!!data.canAdd);
    } catch {
      toast.error('Não foi possível carregar os números.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!apiBase || !instance || !apikey) {
      toast.error('Preencha a base, a instância e a apikey.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, api_base: apiBase, evolution_instance: instance, apikey }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Falha ao adicionar o número.');
        return;
      }
      toast.success('Número adicionado.');
      setShowForm(false);
      setLabel(''); setApiBase(''); setInstance(''); setApikey('');
      await load();
    } catch {
      toast.error('Não foi possível conectar ao servidor.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Remover este número?')) return;
    try {
      const res = await fetch(`/api/whatsapp/numbers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Falha ao remover.');
        return;
      }
      toast.success('Número removido.');
      await load();
    } catch {
      toast.error('Não foi possível conectar ao servidor.');
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Smartphone className="size-4" /> Números adicionais
        </CardTitle>
        <CardDescription>
          Conecte um segundo número (via Evolution) à mesma caixa de entrada.
          {' '}Usando {numbers.length} de {limit} número(s).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            {/* Lista de números */}
            <div className="flex flex-col gap-2">
              {numbers.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {n.label || n.evolution_instance || n.phone_number_id}
                      {n.is_default && (
                        <Badge variant="secondary" className="ml-2">Padrão</Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {providerLabel[n.provider] ?? n.provider} · {n.status === 'connected' ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                  {!n.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(n.id)}
                      aria-label="Remover número"
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Adicionar número — botão sempre visível; desabilitado quando
                bate o limite (a pessoa vê que existe e pede liberação). */}
            {showForm && canAdd ? (
                <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Novo número via Evolution</p>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="evo-label">Nome (opcional)</Label>
                    <Input id="evo-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Comercial" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="evo-base">Base da API Evolution</Label>
                    <Input id="evo-base" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://evo.exemplo.com.br" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="evo-instance">Instância</Label>
                    <Input id="evo-instance" value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="nome-da-instancia" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="evo-apikey">apikey da instância</Label>
                    <Input id="evo-apikey" type="password" value={apikey} onChange={(e) => setApikey(e.target.value)} required />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={saving}>
                      {saving ? <Loader2 className="size-4 animate-spin" /> : 'Salvar número'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
            ) : canAdd ? (
              <Button
                variant="outline"
                onClick={() => setShowForm(true)}
                className="w-fit"
              >
                <Plus className="size-4" /> Adicionar número
              </Button>
            ) : (
              // Sem cota no plano: em vez de só desabilitar, oferece a
              // contratação de um número adicional não-WABA (Evolution).
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium text-foreground">
                    Adicionar um número extra (sem WABA) — {NUMERO_ADICIONAL_PRECO}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Conecte um segundo número via WhatsApp comum (QR, sem conta
                    oficial Meta) à mesma caixa de entrada. Você já usa {numbers.length} de{' '}
                    {limit} número(s) do seu plano.
                  </p>
                </div>
                <Button
                  className="w-fit"
                  onClick={() =>
                    window.open(CONTRATAR_NUMERO_URL, '_blank', 'noopener,noreferrer')
                  }
                >
                  <Plus className="size-4" /> Solicitar número adicional
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
