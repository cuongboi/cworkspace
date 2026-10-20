import { ShieldAlertIcon } from "lucide-react"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { PageTitle } from "@/components/common/page-title"
import { InvitationsSettings } from "@/components/settings/invitations-settings"
import { MembersSettings } from "@/components/settings/members-settings"
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

const TABS = ["members", "invitations"] as const
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
          <TabsList>
            <TabsTrigger value="members">
              {t("settings.tabs.members")}
            </TabsTrigger>
            <TabsTrigger value="invitations">
              {t("settings.tabs.invitations")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="members">
            <MembersSettings />
          </TabsContent>
          <TabsContent value="invitations">
            <InvitationsSettings />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

export default SettingsPage
