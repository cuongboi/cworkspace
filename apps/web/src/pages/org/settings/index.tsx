import { ShieldAlertIcon } from "lucide-react"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { Link } from "react-router-dom"
import { PageTitle } from "@/components/common/page-title"
import { GeneralSettings } from "@/components/settings/general-settings"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

const TABS = ["general", "members", "invitations"] as const
type Tab = (typeof TABS)[number]

const SettingsPage = () => {
  const { org, me, isAdmin, href } = useOrg()
  // same query (and cache entry) OrgLayout uses for the role: avoid flashing "Admins only"
  const { isPending: rolePending } = useDbQuery(
    ["member", "findFirst", "me", org.id],
    () =>
      db.member.findFirst({
        where: { organizationId: org.id, userId: me.id },
        select: { role: true },
      })
  )
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("general")
  )

  if (rolePending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <Empty className="min-h-[60svh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Admins only</EmptyTitle>
          <EmptyDescription>
            Only owners and admins of {org.name} can manage its settings.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to={href("/")}>Back to home</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <PageTitle title={`Settings · ${org.name}`} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage {org.name}, its members and invitations.
          </p>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => void setTab(value as Tab)}
          className="gap-6"
        >
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="invitations">Invitations</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <GeneralSettings key={`${org.id}:${org.name}:${org.logo ?? ""}`} />
          </TabsContent>
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
