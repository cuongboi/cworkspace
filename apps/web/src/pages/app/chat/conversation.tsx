import { useParams } from "react-router-dom"
import { ChatShell } from "@/components/chat/chat-shell"
import { PageTitle } from "@/components/common/page-title"

const ConversationPage = () => {
  const params = useParams()
  const conversationId = params.conversationId
  return (
    <>
      <PageTitle title="Chats" />
      <ChatShell conversationId={conversationId} />
    </>
  )
}

export default ConversationPage
