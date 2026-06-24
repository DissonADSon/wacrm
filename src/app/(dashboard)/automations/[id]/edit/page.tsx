"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldAlert } from "lucide-react"

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from "@/components/automations/automation-builder"
import { useCan } from "@/hooks/use-can"
import type { AutomationTriggerType } from "@/types"

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const canEdit = useCan("edit-automations")
  const [initial, setInitial] = useState<BuilderInitial | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/automations/${id}`)
      if (!res.ok) {
        if (!cancelled) setError(`Falha ao carregar (${res.status})`)
        return
      }
      const body = await res.json()
      if (cancelled) return
      setInitial({
        id: body.automation.id,
        name: body.automation.name ?? "",
        description: body.automation.description ?? "",
        trigger_type: body.automation.trigger_type as AutomationTriggerType,
        trigger_config: body.automation.trigger_config ?? {},
        is_active: !!body.automation.is_active,
        steps: fromServerSteps((body.steps ?? []) as ServerStepNode[]),
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => router.push("/automations")}
          className="text-sm text-primary hover:text-primary/80"
        >
          Voltar para Automações
        </button>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  // Somente admin/owner editam. Agentes/viewers veem o resumo em leitura
  // e os logs, mas não abrem o editor (decisão ADSon).
  if (!canEdit) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 py-24 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Acesso somente leitura
        </p>
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-left">
          <p className="text-sm font-semibold text-foreground">{initial.name}</p>
          {initial.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{initial.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Status: {initial.is_active ? "Ativa" : "Pausada"}
          </p>
        </div>
        <p className="max-w-sm text-xs text-muted-foreground">
          Apenas administradores e proprietários podem editar automações.
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => router.push(`/automations/${id}/logs`)}
            className="text-sm text-primary hover:text-primary/80"
          >
            Ver logs
          </button>
          <button
            onClick={() => router.push("/automations")}
            className="text-sm text-primary hover:text-primary/80"
          >
            Voltar para Automações
          </button>
        </div>
      </div>
    )
  }

  return <AutomationBuilder initial={initial} />
}
