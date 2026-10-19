import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import { formatDistanceToNow } from "date-fns"
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  HashIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react"
import { useQueryState } from "nuqs"
import { type ReactNode, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, api } from "@/lib/api-client"
import { invalidateModels, useDbQuery } from "@/lib/query"
import { channelSettingsParser } from "@/lib/search-params"
import {
  type ChannelItem,
  deliveriesKey,
  fetchDeliveries,
  fetchIntegrations,
  type Integration,
  type IntegrationKind,
  integrationsKey,
  KIND_DESCRIPTION,
  KIND_LABEL,
} from "./channel-data"
import { ChannelFormDialog } from "./channel-form-dialog"

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

const KIND_ICON: Record<IntegrationKind, typeof WebhookIcon> = {
  INCOMING_WEBHOOK: ArrowDownLeftIcon,
  OUTGOING_WEBHOOK: ArrowUpRightIcon,
  BOT_TOKEN: BotIcon,
}

/** Channel settings: General (rename, move, topic, delete) and Integrations (moderators). */
export function ChannelSettingsDialog({
  channel,
  groupSlug,
  canManage,
}: {
  channel: ChannelItem
  groupSlug: string
  canManage: boolean
}) {
  const [tab, setTab] = useQueryState("settings", channelSettingsParser)
  const open = tab !== null
  const close = () => void setTab(null)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-1.5">
            <HashIcon className="size-4 text-muted-foreground" />
            {channel.name}
          </DialogTitle>
          <DialogDescription>
            {channel.topic || "Channel settings"}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab ?? "general"}
          onValueChange={(v) => void setTab(v as "general" | "integrations")}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="px-6 pt-3">
            <TabsList variant="line">
              <TabsTrigger value="general">General</TabsTrigger>
              {canManage ? (
                <TabsTrigger value="integrations">Integrations</TabsTrigger>
              ) : null}
            </TabsList>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-5">
              <TabsContent value="general">
                <GeneralTab
                  channel={channel}
                  groupSlug={groupSlug}
                  canManage={canManage}
                  onDeleted={close}
                />
              </TabsContent>
              {canManage ? (
                <TabsContent value="integrations">
                  <IntegrationsTab channelId={channel.id} />
                </TabsContent>
              ) : null}
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ── General ────────────────────────────────────────────────────────

function GeneralTab({
  channel,
  groupSlug,
  canManage,
  onDeleted,
}: {
  channel: ChannelItem
  groupSlug: string
  canManage: boolean
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)

  const remove = async () => {
    try {
      await api.delete(`/api/channels/${channel.id}`)
      onDeleted()
      await navigate(`/groups/${groupSlug}`)
      await invalidateModels(qc, ["channel"])
      toast.success(`Deleted #${channel.name}`)
    } catch (err) {
      toast.error(errorText(err, "Could not delete the channel"))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd className="font-medium">#{channel.name}</dd>
        <dt className="text-muted-foreground">Topic</dt>
        <dd>
          {channel.topic || <span className="text-muted-foreground">None</span>}
        </dd>
        <dt className="text-muted-foreground">Visibility</dt>
        <dd>Every member of the group</dd>
      </dl>
      {canManage ? (
        <>
          <div>
            <ChannelFormDialog
              groupId={channel.groupId}
              groupSlug={groupSlug}
              channel={channel}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              Edit name, topic or location
            </Button>
          </div>
          {!channel.isDefault ? (
            <>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
                <div>
                  <p className="text-sm font-medium">Delete this channel</p>
                  <p className="text-xs text-muted-foreground">
                    Its sub-channels, messages and integrations are removed for
                    everyone. This can't be undone.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2Icon /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete #{channel.name}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        All messages, sub-channels and integrations of this
                        channel will be permanently removed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => void remove()}
                      >
                        Delete channel
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              #general is the group's main channel: it can't be renamed, moved
              or deleted.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Group admins and moderators manage channels.
        </p>
      )}
    </div>
  )
}

// ── Integrations ───────────────────────────────────────────────────

type Revealed = { integration: Integration; secret: string }

function IntegrationsTab({ channelId }: { channelId: string }) {
  const { data, isPending, error } = useDbQuery(
    integrationsKey(channelId),
    () => fetchIntegrations(channelId)
  )
  const [creating, setCreating] = useState<IntegrationKind | null>(null)
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Connect services and scripts to this channel. Secrets are shown once;
          rotate them if they leak.
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="shrink-0">
              <PlusIcon /> Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {(Object.keys(KIND_LABEL) as IntegrationKind[]).map((kind) => {
              const Icon = KIND_ICON[kind]
              return (
                <DropdownMenuItem
                  key={kind}
                  className="items-start"
                  onSelect={() => {
                    setRevealed(null)
                    setCreating(kind)
                  }}
                >
                  <Icon className="mt-0.5" />
                  <span className="flex flex-col">
                    <span className="font-medium">{KIND_LABEL[kind]}</span>
                    <span className="text-xs text-muted-foreground">
                      {KIND_DESCRIPTION[kind]}
                    </span>
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {revealed ? (
        <SecretReveal {...revealed} onDone={() => setRevealed(null)} />
      ) : null}

      {creating ? (
        <IntegrationEditor
          key={creating}
          channelId={channelId}
          kind={creating}
          onCancel={() => setCreating(null)}
          onCreated={(r) => {
            setCreating(null)
            setRevealed(r)
          }}
        />
      ) : null}

      {isPending ? (
        <Spinner className="mx-auto my-6" />
      ) : error ? (
        <p className="text-sm text-destructive">Could not load integrations.</p>
      ) : data.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          <WebhookIcon className="size-5" />
          No integrations yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((integration) => (
            <li key={integration.id}>
              <IntegrationCard
                integration={integration}
                open={openId === integration.id}
                onToggle={() =>
                  setOpenId((id) =>
                    id === integration.id ? null : integration.id
                  )
                }
                onRotated={setRevealed}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IntegrationCard({
  integration,
  open,
  onToggle,
  onRotated,
}: {
  integration: Integration
  open: boolean
  onToggle: () => void
  onRotated: (r: Revealed) => void
}) {
  const qc = useQueryClient()
  const Icon = KIND_ICON[integration.kind]
  const toggleEnabled = async (enabled: boolean) => {
    try {
      await api.patch(`/api/integrations/${integration.id}`, { enabled })
      await invalidateModels(qc, ["channelIntegration"])
    } catch (err) {
      toast.error(errorText(err, "Could not update the integration"))
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left outline-none focus-visible:underline"
        >
          <span className="block truncate text-sm font-medium">
            {integration.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {KIND_LABEL[integration.kind]} · ••••{integration.secretHint} ·{" "}
            {integration.lastUsedAt
              ? `used ${formatDistanceToNow(integration.lastUsedAt, { addSuffix: true })}`
              : "never used"}
          </span>
        </button>
        <Switch
          checked={integration.enabled}
          onCheckedChange={(v) => void toggleEnabled(v)}
          aria-label={integration.enabled ? "Disable" : "Enable"}
        />
      </div>
      {open ? (
        <div className="border-t p-3">
          <IntegrationEditor
            channelId={integration.channelId}
            kind={integration.kind}
            integration={integration}
            onRotated={onRotated}
          />
        </div>
      ) : null}
    </div>
  )
}

const lines = (value: string) =>
  value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean)

function IntegrationEditor({
  channelId,
  kind,
  integration,
  onCancel,
  onCreated,
  onRotated,
}: {
  channelId: string
  kind: IntegrationKind
  integration?: Integration
  onCancel?: () => void
  onCreated?: (r: Revealed) => void
  onRotated?: (r: Revealed) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(integration?.name ?? KIND_LABEL[kind])
  const [avatarUrl, setAvatarUrl] = useState(integration?.avatarUrl ?? "")
  const [targetUrl, setTargetUrl] = useState(integration?.targetUrl ?? "")
  const [ips, setIps] = useState(integration?.allowedIps.join("\n") ?? "")
  const [hosts, setHosts] = useState(integration?.allowedHosts.join("\n") ?? "")
  const [triggers, setTriggers] = useState(
    integration?.triggerWords.join(", ") ?? ""
  )
  const [rate, setRate] = useState(String(integration?.rateLimitPerMin ?? 60))
  const [busy, setBusy] = useState(false)
  const outgoing = kind === "OUTGOING_WEBHOOK"

  const settings = () => ({
    name: name.trim() || KIND_LABEL[kind],
    avatarUrl: avatarUrl.trim() || null,
    allowedIps: outgoing ? [] : lines(ips),
    allowedHosts: outgoing ? lines(hosts) : [],
    ...(outgoing
      ? { targetUrl: targetUrl.trim() || null, triggerWords: lines(triggers) }
      : {}),
    rateLimitPerMin: Math.min(600, Math.max(1, Number(rate) || 60)),
  })

  const save = async () => {
    setBusy(true)
    try {
      if (integration) {
        await api.patch(`/api/integrations/${integration.id}`, settings())
        toast.success("Integration saved")
      } else {
        const created = await api.post<Revealed>(
          `/api/channels/${channelId}/integrations`,
          { kind, ...settings() }
        )
        onCreated?.(created)
      }
      await invalidateModels(qc, ["channelIntegration"])
    } catch (err) {
      toast.error(errorText(err, "Could not save the integration"))
    } finally {
      setBusy(false)
    }
  }

  const rotate = async () => {
    if (!integration) return
    try {
      const r = await api.post<Revealed>(
        `/api/integrations/${integration.id}/rotate`
      )
      onRotated?.(r)
      await invalidateModels(qc, ["channelIntegration"])
    } catch (err) {
      toast.error(errorText(err, "Could not rotate the secret"))
    }
  }

  const test = async () => {
    if (!integration) return
    try {
      const r = await api.post<{
        ok: boolean
        status: number
        durationMs: number
        error?: string
      }>(`/api/integrations/${integration.id}/test`)
      if (r.ok)
        toast.success(`Delivered (HTTP ${r.status}, ${r.durationMs} ms)`)
      else toast.error(`Delivery failed: ${r.error ?? `HTTP ${r.status}`}`)
      await invalidateModels(qc, ["integrationDelivery"])
    } catch (err) {
      toast.error(errorText(err, "Could not send the test"))
    }
  }

  const remove = async () => {
    if (!integration) return
    try {
      await api.delete(`/api/integrations/${integration.id}`)
      await invalidateModels(qc, ["channelIntegration"])
      toast.success("Integration removed")
    } catch (err) {
      toast.error(errorText(err, "Could not remove the integration"))
    }
  }

  return (
    <form
      className={cn(
        "flex flex-col gap-4",
        !integration && "rounded-lg border bg-muted/30 p-4"
      )}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {!integration ? (
        <p className="text-sm font-medium">
          New {KIND_LABEL[kind].toLowerCase()}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" htmlFor={`${kind}-name`}>
          <Input
            id={`${kind}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="Avatar URL" htmlFor={`${kind}-avatar`} hint="Optional">
          <Input
            id={`${kind}-avatar`}
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      {outgoing ? (
        <>
          <Field label="Target URL" htmlFor={`${kind}-url`}>
            <Input
              id={`${kind}-url`}
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://hooks.example.com/cworkplace"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Trigger words"
              htmlFor={`${kind}-triggers`}
              hint="Comma-separated, e.g. /deploy, !bot. Empty: every message."
            >
              <Input
                id={`${kind}-triggers`}
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
              />
            </Field>
            <Field
              label="Allowed hosts"
              htmlFor={`${kind}-hosts`}
              hint="One per line; *.example.com allowed. Empty: any public host."
            >
              <Textarea
                id={`${kind}-hosts`}
                value={hosts}
                onChange={(e) => setHosts(e.target.value)}
                rows={2}
                className="font-mono text-xs"
              />
            </Field>
          </div>
        </>
      ) : (
        <Field
          label="Allowed IPs"
          htmlFor={`${kind}-ips`}
          hint="One IP or CIDR per line (e.g. 203.0.113.0/24). Empty: any address."
        >
          <Textarea
            id={`${kind}-ips`}
            value={ips}
            onChange={(e) => setIps(e.target.value)}
            rows={2}
            className="font-mono text-xs"
          />
        </Field>
      )}

      <Field
        label="Rate limit"
        htmlFor={`${kind}-rate`}
        hint="Requests per minute (1–600)."
        className="sm:max-w-40"
      >
        <Input
          id={`${kind}-rate`}
          type="number"
          min={1}
          max={600}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Spinner /> : null}
          {integration ? "Save" : "Create and show secret"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {integration ? (
          <>
            {outgoing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void test()}
              >
                <SendIcon /> Send test
              </Button>
            ) : null}
            <ConfirmButton
              label={
                <>
                  <RefreshCwIcon /> Rotate secret
                </>
              }
              title="Generate a new secret?"
              description="The current secret stops working immediately. Update every caller with the new one."
              action="Rotate"
              onConfirm={rotate}
            />
            <ConfirmButton
              destructive
              label={
                <>
                  <Trash2Icon /> Remove
                </>
              }
              title={`Remove ${integration.name}?`}
              description="Callers using it will be rejected. Messages it already posted stay."
              action="Remove"
              onConfirm={remove}
            />
          </>
        ) : null}
      </div>

      {integration && integration.kind !== "BOT_TOKEN" ? (
        <DeliveryLog integrationId={integration.id} />
      ) : null}
    </form>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ConfirmButton({
  label,
  title,
  description,
  action,
  destructive,
  onConfirm,
}: {
  label: ReactNode
  title: string
  description: string
  action: string
  destructive?: boolean
  onConfirm: () => Promise<void>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            destructive && "text-destructive hover:text-destructive"
          )}
        >
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => void onConfirm()}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeliveryLog({ integrationId }: { integrationId: string }) {
  const { data = [], isPending } = useDbQuery(
    deliveriesKey(integrationId),
    () => fetchDeliveries(integrationId)
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        Recent deliveries
      </p>
      {isPending ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-xs">
          {data.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  d.ok ? "bg-emerald-500" : "bg-destructive"
                )}
              />
              <span className="w-8 shrink-0 text-muted-foreground uppercase">
                {d.direction}
              </span>
              <span className="w-10 shrink-0 tabular-nums">
                {d.status || "—"}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {d.error ?? "OK"}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {d.durationMs} ms
              </span>
              <span className="w-24 shrink-0 text-right text-muted-foreground">
                {formatDistanceToNow(d.createdAt, { addSuffix: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Shown once after creating or rotating: the secret plus a ready-to-run example. */
function SecretReveal({
  integration,
  secret,
  onDone,
}: Revealed & { onDone: () => void }) {
  const origin = window.location.origin
  const hookUrl = `${origin}/api/hooks/${integration.id}`
  const example =
    integration.kind === "INCOMING_WEBHOOK"
      ? `SECRET='${secret}'
BODY='{"text":"Hello from CI 👋"}'
TS=$(date +%s)
SIG="v1=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -X POST '${hookUrl}' \\
  -H 'Content-Type: application/json' \\
  -H "X-Cworkplace-Timestamp: $TS" \\
  -H "X-Cworkplace-Signature: $SIG" \\
  -d "$BODY"`
      : integration.kind === "BOT_TOKEN"
        ? `curl '${origin}/api/bot/messages' -H 'Authorization: Bearer ${secret}'

curl -X POST '${origin}/api/bot/messages' \\
  -H 'Authorization: Bearer ${secret}' \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"Deploy finished ✅"}'`
        : `// Verify each request (Node):
const ts = req.headers["x-cworkplace-timestamp"]
const expected = "v1=" + crypto
  .createHmac("sha256", "${secret}")
  .update(ts + "." + rawBody)
  .digest("hex")
// reject unless crypto.timingSafeEqual(expected, req.headers["x-cworkplace-signature"])
// and |now - ts| < 5 min. Reply with { "text": "…" } to answer in the channel.`

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <KeyRoundIcon className="mt-0.5 size-4 text-amber-600" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            Copy the secret for {integration.name} now
          </p>
          <p className="text-xs text-muted-foreground">
            It won't be shown again. Rotate it to get a new one.
          </p>
        </div>
      </div>
      <CopyField value={secret} label="Secret" />
      {integration.kind === "INCOMING_WEBHOOK" ? (
        <CopyField value={hookUrl} label="Webhook URL" />
      ) : null}
      <div className="relative">
        <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed">
          {example}
        </pre>
        <CopyButton value={example} className="absolute top-1.5 right-1.5" />
      </div>
      <div>
        <Button size="sm" variant="outline" onClick={onDone}>
          I've stored it
        </Button>
      </div>
    </div>
  )
}

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="h-8 bg-background font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <CopyButton value={value} />
    </div>
  )
}

function CopyButton({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={cn("shrink-0 bg-background", className)}
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => toast.error("Could not copy"))
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}
