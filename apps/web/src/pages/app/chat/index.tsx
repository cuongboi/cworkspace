import { useTranslation } from "react-i18next"
import { ChatShell } from "@/components/chat/chat-shell"
import { PageTitle } from "@/components/common/page-title"

const ChatPage = () => {
  const { t } = useTranslation()
  return (
    <>
      <PageTitle title={t("chat.pageTitle")} />
      <ChatShell />
    </>
  )
}

export default ChatPage
