import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import type { ThreadConversation, ThreadMember } from "./chat-data"
import { ConversationInfoPanel } from "./conversation-info-panel"

/** The details panel as a sheet, for widths where it doesn't fit as a column. */
export function ConversationInfoSheet({
  open,
  onOpenChange,
  conversation,
  members,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: ThreadConversation
  members: ThreadMember[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-sm">
        <SheetTitle className="sr-only">Conversation details</SheetTitle>
        <SheetDescription className="sr-only">
          Info, files and members of this conversation
        </SheetDescription>
        <ConversationInfoPanel
          conversation={conversation}
          members={members}
          onLeft={() => onOpenChange(false)}
          onPicked={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
