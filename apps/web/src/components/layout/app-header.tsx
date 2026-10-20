import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { COMPANY_NAME } from "@/lib/company";
import { GlobalSearch } from "./global-search";
import { UserMenu } from "./user-menu";

export function AppHeader() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-card px-3 pt-[env(safe-area-inset-top)] md:h-12 md:bg-transparent md:px-3">
      <Link
        to="/"
        className="md:absolute md:left-0 flex shrink-0 items-center justify-center md:w-17"
        title={COMPANY_NAME}
      >
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground md:size-7 md:rounded-lg">
          {COMPANY_NAME[0]?.toUpperCase()}
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-0 sm:justify-center sm:gap-1">
        <div className="hidden items-center md:flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("shell.back")}
            onClick={() => navigate(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("shell.forward")}
            onClick={() => navigate(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <GlobalSearch />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell />
        <UserMenu className="md:hidden" />
      </div>
    </header>
  );
}
