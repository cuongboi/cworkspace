import {
  DownloadIcon,
  LanguagesIcon,
  SettingsIcon,
  UsersIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
  UserCogIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { UserAvatar } from "@/components/common/user-avatar";
import { useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/hooks/use-app";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { authClient } from "@/lib/auth-client";
import { disablePush } from "@/lib/push";
import { LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export function UserMenu({
  className,
  side,
  align = "end",
}: {
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const { me, isAdmin } = useApp();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const installApp = useInstallPrompt();
  const isMobile = useIsMobile();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("rounded-full", className)}
          aria-label={t("account.menu")}
        >
          <UserAvatar
            user={{ id: me.id, name: me.name, image: me.image ?? null }}
            size="default"
            presence
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-60 **:[[role^=menuitem]]:max-md:min-h-11"
        side={side}
        align={align}
      >
        <DropdownMenuLabel className="grid leading-tight">
          <span className="truncate font-medium">{me.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{me.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(`/people/${me.id}`)}>
          <UserIcon />
          {t("account.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/account")}>
          <UserCogIcon />
          {t("account.settings")}
        </DropdownMenuItem>
        {/* phones: the tab bar has no room for these */}
        <DropdownMenuItem className="md:hidden" onSelect={() => navigate("/people")}>
          <UsersIcon />
          {t("nav.people")}
        </DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem className="md:hidden" onSelect={() => navigate("/settings")}>
            <SettingsIcon />
            {t("nav.admin")}
          </DropdownMenuItem>
        ) : null}
        {!isMobile && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LanguagesIcon />
                {t("account.language")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={i18n.resolvedLanguage}
                  onValueChange={(lng) => void i18n.changeLanguage(lng)}
                >
                  {LANGUAGES.map((l) => (
                    <DropdownMenuRadioItem key={l.code} value={l.code}>
                      {l.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SunIcon />
                {t("account.theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">
                    <SunIcon /> {t("account.light")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon /> {t("account.dark")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon /> {t("account.system")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        {installApp.mode && (
          <DropdownMenuItem
            onSelect={() => {
              if (installApp.mode === "native") void installApp.install();
              else
                toast.info(t("account.installApp"), {
                  description: t("account.installHint"),
                });
            }}
          >
            <DownloadIcon />
            {t("account.installApp")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await disablePush().catch(() => {});
            await authClient.signOut();
            window.location.href = "/sign-in";
          }}
        >
          <LogOutIcon />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
