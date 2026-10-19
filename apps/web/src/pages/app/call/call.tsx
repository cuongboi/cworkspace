import { useParams } from "react-router-dom"
import { CallScreen } from "@/components/call/call-screen"
import { PageTitle } from "@/components/common/page-title"
import { Spinner } from "@/components/ui/spinner"

const CallPage = () => {
  const params = useParams()
  const callId = params.callId ?? null

  return (
    <>
      <PageTitle title="Call" />
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
