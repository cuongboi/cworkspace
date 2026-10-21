import {
  BellIcon,
  CalendarIcon,
  HomeIcon,
  type LucideIcon,
  MessageCircleIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useApp } from "@/hooks/use-app";
import { db } from "@/lib/api-client";
import { useDbQuery } from "@/lib/query";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

/** Unread conversations: last message newer than my read marker. */
function useUnreadChats() {
  const { me } = useApp();
  const { data = [] } = useDbQuery(["conversationMember", "findMany", "unread"], () =>
    db.conversationMember.findMany({
      where: { userId: me.id },
      select: {
        lastReadAt: true,
        conversation: { select: { lastMessageAt: true } },
      },
    }),
  );
  return data.filter((m) => m.conversation.lastMessageAt > m.lastReadAt).length;
}

type NavItem = {
  label: string;
  icon: LucideIcon;
  path: string;
  badge?: number;
};

export function useNavItems(): NavItem[] {
  const { t } = useTranslation();
  const { isAdmin } = useApp();
  const unreadChats = useUnreadChats();
  return [
    { label: t("nav.activity"), icon: BellIcon, path: "/notifications" },
    {
      label: t("nav.chat"),
      icon: MessageCircleIcon,
      path: "/chat",
      badge: unreadChats,
    },
    { label: t("nav.home"), icon: HomeIcon, path: "/" },
    { label: t("nav.groups"), icon: UsersIcon, path: "/groups" },
    { label: t("nav.calendar"), icon: CalendarIcon, path: "/calendar" },
    { label: t("nav.people"), icon: UserIcon, path: "/people" },
    ...(isAdmin ? [{ label: t("nav.admin"), icon: SettingsIcon, path: "/settings" }] : []),
  ];
}

/** Phones: thumb-reachable tab bar (5 most-used places); People/Admin live in the account menu. */
export function MobileTabBar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const isActive = useIsNavActive();
  const { pathname } = useLocation();
  const order = ["/", "/groups", "/chat", "/calendar", "/notifications"];
  const nav = useNavItems()
    .filter((i) => order.includes(i.path))
    .sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
  // inside a conversation the composer owns the bottom edge (like LINE)
  if (/^\/chat\/.+|^\/groups\/[^/]+\/c\//.test(pathname)) return null;
  return (
    <nav
      aria-label={t("nav.main")}
      className={cn(
        "grid shrink-0 grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {nav.map((item) => {
        const active = isActive(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted-foreground transition-colors active:bg-muted",
              active && "text-brand",
            )}
          >
            <span className="relative">
              <item.icon
                className={cn("size-6", active && "fill-brand/15")}
                strokeWidth={active ? 1.5 : 1}
              />
              {item.badge ? (
                <span className="absolute -top-1 -right-2.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-highlight px-1 text-[10px] leading-none font-bold text-highlight-foreground ring-2 ring-card">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </span>
            <span className="leading-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function useIsNavActive() {
  const { pathname } = useLocation();
  return (path: string) => (path === "/" ? pathname === "/" : pathname.startsWith(path));
}

/** Teams-style app bar: a narrow column of icon + label buttons. */
export function AppSidebar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const nav = useNavItems();
  const isActive = useIsNavActive();

  return (
    <nav
      aria-label={t("nav.main")}
      className={cn("flex w-17 shrink-0 flex-col items-stretch gap-1 py-2", className)}
    >
      {nav.map((item) => (
        <NavButton key={item.path} item={item} active={isActive(item.path)} />
      ))}
      <div className="mt-auto flex justify-center pt-2">
        <UserMenu side="right" align="end" />
      </div>
    </nav>
  );
}

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.path}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative mx-1 flex flex-col items-center gap-0.5 rounded-md py-1.5 text-2xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
        active && "font-semibold text-brand hover:text-brand",
      )}
    >
      {/* the active indicator sits on the rail's left edge like Teams */}
      {active ? (
        <span className="absolute top-2 bottom-2 -left-1 w-0.75 rounded-r bg-brand" />
      ) : null}
      <span className="relative">
        <item.icon
          className={cn("size-5", active && "fill-brand/15")}
          strokeWidth={active ? 1.5 : 1}
        />
        {item.badge ? (
          <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-2xs leading-none font-bold text-highlight-foreground">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </span>
      <span className="leading-tight">{item.label}</span>
    </Link>
  );
}
