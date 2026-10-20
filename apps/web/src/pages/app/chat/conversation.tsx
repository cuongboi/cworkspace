import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChatShell } from "@/components/chat/chat-shell"
import { PageTitle } from "@/components/common/page-title"

const ConversationPage = () => {
  const { t } = useTranslation()
  const params = useParams()
  const conversationId = params.conversationId
  return (
    <>
      <PageTitle title={t("chat.pageTitle")} />
      <ChatShell conversationId={conversationId} />
    </>
  )
}

export default ConversationPage
