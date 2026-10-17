import { ShieldAlertIcon } from "lucide-react"
import { parseAsStringLiteral, useQueryState } from "nuqs"
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
          <EmptyTitle>Admins only</EmptyTitle>
          <EmptyDescription>
            Only admins of {COMPANY_NAME} can manage its settings.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to={"/"}>Back to home</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <PageTitle title={`Settings · ${COMPANY_NAME}`} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage the people of {COMPANY_NAME} and their invitations.
          </p>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => void setTab(value as Tab)}
          className="gap-6"
        >
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="invitations">Invitations</TabsTrigger>
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
