import { useQueryClient } from "@tanstack/react-query";
import { BellIcon, ShieldIcon, SlidersHorizontalIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryState } from "nuqs";
import { PageTitle } from "@/components/common/page-title";
import { PasswordCard } from "@/components/account/password-card";
import { PreferencesCard } from "@/components/account/preferences-card";
import { PushSettings } from "@/components/account/push-settings";
import { SESSIONS_KEY, SessionsCard } from "@/components/account/sessions-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { accountTabParser, type AccountTab } from "@/lib/search-params";

const AccountPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useQueryState("tab", accountTabParser);

  return (
    <>
      <PageTitle title={t("account.page.title")} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("account.page.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("account.page.subtitle")}</p>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => void setTab(value as AccountTab)}
          className="gap-6"
        >
          <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 md:mx-0 md:px-0">
            <TabsList>
              <TabsTrigger value="security">
                <ShieldIcon />
                {t("account.page.tabs.security")}
              </TabsTrigger>
              <TabsTrigger value="notifications">
                <BellIcon />
                {t("account.page.tabs.notifications")}
              </TabsTrigger>
              <TabsTrigger value="preferences">
                <SlidersHorizontalIcon />
                {t("account.page.tabs.preferences")}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="security" className="flex flex-col gap-6">
            <SessionsCard />
            <PasswordCard
              onOthersRevoked={() => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })}
            />
          </TabsContent>
          <TabsContent value="notifications">
            <PushSettings />
          </TabsContent>
          <TabsContent value="preferences">
            <PreferencesCard />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default AccountPage;
