import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistance } from "date-fns";
import {
  LaptopIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { authClient } from "@/lib/auth-client";
import { useDateLocale } from "@/lib/i18n";
import { parseUserAgent, type DeviceKind } from "@/lib/user-agent";

/** better-auth slides `updatedAt` at most once per `updateAge` (60s); treat that window as live. */
const ACTIVE_WINDOW_MS = 5 * 60_000;

export const SESSIONS_KEY = ["session", "list"] as const;

const DEVICE_ICONS: Record<DeviceKind, typeof LaptopIcon> = {
  desktop: LaptopIcon,
  mobile: SmartphoneIcon,
  tablet: TabletIcon,
};

type SessionRow = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function listSessions(): Promise<SessionRow[]> {
  const { data, error } = await authClient.listSessions();
  if (error) throw error;
  return data.map((s) => ({
    ...s,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  }));
}

export function SessionsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const current = authClient.useSession().data?.session.id;
  const { data, isPending, isError } = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: listSessions,
  });

  // current session first, then most recently active
  const sessions = [...(data ?? [])].sort(
    (a, b) =>
      Number(b.id === current) - Number(a.id === current) ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const others = sessions.filter((s) => s.id !== current);

  const revoke = async (session: SessionRow) => {
    queryClient.setQueryData<SessionRow[]>(SESSIONS_KEY, (rows) =>
      rows?.filter((r) => r.id !== session.id),
    );
    const { error } = await authClient.revokeSession({ token: session.token });
    if (error) toast.error(error.message ?? t("errors.INTERNAL"));
    else toast.success(t("account.sessions.revoked"));
    void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  };

  const revokeOthers = async () => {
    const { error } = await authClient.revokeOtherSessions();
    if (error) toast.error(error.message ?? t("errors.INTERNAL"));
    else toast.success(t("account.sessions.revokedAll"));
    void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("account.sessions.title")}</CardTitle>
        <CardDescription className="hidden md:block">
          {t("account.sessions.description")}
        </CardDescription>
        <CardAction className="max-sm:col-start-1 max-sm:row-start-3 max-sm:mt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={others.length === 0}
                className="w-full md:w-fit"
              >
                <LogOutIcon />
                {t("account.sessions.revokeAll")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("account.sessions.revokeAllTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("account.sessions.revokeAllBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void revokeOthers()}>
                  {t("account.sessions.revokeAll")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">{t("account.sessions.loadFailed")}</p>
        ) : (
          <ItemGroup className="rounded-lg border">
            {sessions.map((s, i) => (
              <div key={s.id}>
                {i > 0 ? <ItemSeparator /> : null}
                <SessionItem
                  session={s}
                  isCurrent={s.id === current}
                  onRevoke={() => void revoke(s)}
                />
              </div>
            ))}
          </ItemGroup>
        )}
        {!isPending && !isError && others.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">{t("account.sessions.onlyThis")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SessionItem({
  session,
  isCurrent,
  onRevoke,
}: {
  session: SessionRow;
  isCurrent: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const ua = parseUserAgent(session.userAgent);
  const Icon = session.userAgent ? DEVICE_ICONS[ua.device] : MonitorSmartphoneIcon;
  const name =
    ua.browser && ua.os
      ? t("account.sessions.browserOn", { browser: ua.browser, os: ua.os })
      : (ua.browser ?? ua.os ?? t("account.sessions.unknownDevice"));
  const active = isCurrent || now - session.updatedAt.getTime() < ACTIVE_WINDOW_MS;

  return (
    <Item size="sm">
      <ItemMedia variant="icon" className="size-9 rounded-md border bg-muted/40">
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate">{name}</span>
            </TooltipTrigger>
            {session.userAgent ? (
              <TooltipContent className="max-w-80 break-all">{session.userAgent}</TooltipContent>
            ) : null}
          </Tooltip>
          {isCurrent ? <Badge variant="secondary">{t("account.sessions.thisDevice")}</Badge> : null}
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-1.5 text-xs">
          <span className="font-mono tabular-nums">
            {session.ipAddress || t("account.sessions.unknownIp")}
          </span>
          <span aria-hidden>·</span>
          {active ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              {t("account.sessions.activeNow")}
            </span>
          ) : (
            <span>
              {t("account.sessions.lastActive", {
                time: formatDistance(session.updatedAt, now, { addSuffix: true, locale }),
              })}
            </span>
          )}
          <span aria-hidden>·</span>
          <span>
            {t("account.sessions.signedIn", {
              date: format(session.createdAt, "PP", { locale }),
            })}
          </span>
        </ItemDescription>
      </ItemContent>
      {isCurrent ? null : (
        <ItemActions>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onRevoke();
            }}
          >
            {t("account.sessions.revoke")}
          </Button>
        </ItemActions>
      )}
    </Item>
  );
}
