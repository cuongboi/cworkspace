import { useState } from "react"
import { toast } from "sonner"
import { type UploadedAttachment, uploadFile } from "@/lib/upload"

type Pending = { key: string; name: string }

/** Upload state for composers: pick files, track in-flight uploads, collect ids to connect. */
export function useUploads(organizationId: string) {
  const [done, setDone] = useState<UploadedAttachment[]>([])
  const [pending, setPending] = useState<Pending[]>([])

  const add = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`
      setPending((p) => [...p, { key, name: file.name }])
      try {
        const attachment = await uploadFile(file, organizationId)
        setDone((d) => [...d, attachment])
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : `Could not upload ${file.name}`
        )
      } finally {
        setPending((p) => p.filter((x) => x.key !== key))
      }
    }
  }

  return {
    attachments: done,
    uploading: pending.length > 0,
    pending,
    add,
    remove: (id: string) => setDone((d) => d.filter((a) => a.id !== id)),
    reset: () => setDone([]),
    /** `{ connect: [...] }` for a nested `attachments` relation, or undefined when empty */
    connect: () =>
      done.length ? { connect: done.map((a) => ({ id: a.id })) } : undefined,
  }
}
