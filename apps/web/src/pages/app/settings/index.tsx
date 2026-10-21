import { ShieldAlertIcon } from "lucide-react"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { PageTitle } from "@/components/common/page-title"
import { GeneralSettings } from "@/components/settings/general-settings"
import { IntegrationsSettings } from "@/components/settings/integrations-settings"
import { InvitationsSettings } from "@/components/settings/invitations-settings"
import { MembersSettings } from "@/components/settings/members-settings"
import { NotificationsSettings } from "@/components/settings/notifications-settings"
import { SignInSettings } from "@/components/settings/sign-in-settings"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApp } from "@/hooks/use-app"
import { COMPANY_NAME } from "@/lib/company"

const TABS = [
  "members",
  "invitations",
  "general",
  "integrations",
  "notifications",
  "signIn",
] as const
type Tab = (typeof TABS)[number]

const SettingsPage = () => {
  const { t } = useTranslation()
  const { isAdmin } = useApp()
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("members")
  )

  if (!isAdmin) {
    return (
      <Empty className="min-h-[60svh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("settings.adminsOnly")}</EmptyTitle>
          <EmptyDescription>
            {t("settings.adminsOnlyBody", { company: COMPANY_NAME })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to={"/"}>{t("settings.backHome")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <PageTitle title={t("settings.pageTitle", { company: COMPANY_NAME })} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("settings.subtitle", { company: COMPANY_NAME })}
          </p>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => void setTab(value as Tab)}
          className="gap-6"
        >
          <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
            {TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`settings.tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="members">
            <MembersSettings />
          </TabsContent>
          <TabsContent value="invitations">
            <InvitationsSettings />
          </TabsContent>
          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="integrations">
            <IntegrationsSettings />
          </TabsContent>
          <TabsContent value="notifications">
            <NotificationsSettings />
          </TabsContent>
          <TabsContent value="signIn">
            <SignInSettings />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

export default SettingsPage
