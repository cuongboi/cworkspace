import { useParams } from "react-router-dom"
import { CallScreen } from "@/components/call/call-screen"
import { PageTitle } from "@/components/common/page-title"
import { Spinner } from "@/components/ui/spinner"
import { useTranslation } from "react-i18next"

const CallPage = () => {
  const { t } = useTranslation()
  const params = useParams()
  const callId = params.callId ?? null

  return (
    <>
      <PageTitle title={t("call.title")} />
      {callId ? (
        <CallScreen key={callId} callId={callId} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}
    </>
  )
}

export default CallPage
