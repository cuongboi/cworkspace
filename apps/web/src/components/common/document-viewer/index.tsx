import { type DocumentKind, documentKind, fileExtension } from "@app/shared/link-preview";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { DownloadIcon, ExternalLinkIcon, Loader2Icon, XIcon } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/groups/wiki/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ApiError } from "@/lib/api-client";
import { fileUrl } from "@/lib/upload";
import { CsvTable } from "./csv-table";

const PdfDocument = lazy(() => import("./pdf-document"));

export type DocumentSource =
  | { kind: "file"; id: string; name: string }
  | { kind: "url"; url: string };

/** Whether an attachment name or a link can open in the viewer. */
export function isViewable(nameOrUrl: string) {
  return documentKind(pathOf(nameOrUrl)) !== null;
}

function pathOf(nameOrUrl: string) {
  try {
    return new URL(nameOrUrl).pathname;
  } catch {
    return nameOrUrl;
  }
}

/** Last path segment of a link, for titles. */
export function urlFileName(raw: string) {
  try {
    return decodeURIComponent(new URL(raw).pathname.split("/").pop() || raw);
  } catch {
    return raw;
  }
}

const sourceName = (s: DocumentSource) => (s.kind === "file" ? s.name : urlFileName(s.url));

/**
 * The document's bytes. The dialog and its "View" button share this cache entry, so the button
 * can spin (`query.isLoading`) while the dialog waits to open.
 */
export function useDocument(source: DocumentSource | null) {
  // not model names: realtime invalidation never touches these
  const queryKey = useMemo(
    () => (source?.kind === "file" ? ["documentFile", source.id] : ["documentLink", source?.url]),
    [source],
  );
  const query = useQuery<Blob, ApiError>({
    queryKey,
    queryFn: () =>
      api.blob(
        source?.kind === "file"
          ? `/api/files/${source.id}/content`
          : `/api/link-preview/document?url=${encodeURIComponent(source?.url ?? "")}`,
      ),
    enabled: source !== null && documentKind(sourceName(source)) !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { query, queryKey };
}

/** "View" button; spins while the document it opens is still downloading. */
export function ViewDocumentButton({
  loading,
  onClick,
  className,
}: {
  loading: boolean;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      size="xs"
      className={className}
      disabled={loading}
      aria-busy={loading}
      onClick={onClick}
    >
      {loading ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {t("common.documentViewer.view")}
    </Button>
  );
}

/** Full screen on phones, nearly the whole viewport from `md` up. */
export function DocumentViewerDialog({
  source,
  onClose,
}: {
  source: DocumentSource | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = useMemo(() => (source ? sourceName(source) : ""), [source]);
  const kind = useMemo(() => documentKind(name), [name]);

  const { query, queryKey } = useDocument(source);
  const href = useMemo(
    () =>
      !source
        ? undefined
        : source.kind === "file"
          ? fileUrl(source.id, { download: true })
          : source.url,
    [source],
  );

  return (
    // opens once the bytes arrive (or fail); the View button shows the spinner meanwhile
    <Dialog open={source !== null && !query.isLoading} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none md:top-1/2 md:left-1/2 md:h-[calc(100dvh-4rem)] md:w-[calc(100vw-4rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">
            {name}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("common.documentViewer.description")}
          </DialogDescription>
          {href ? (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <a
                href={href}
                target={source?.kind === "url" ? "_blank" : undefined}
                rel="noopener noreferrer"
                aria-label={
                  source?.kind === "url"
                    ? t("common.documentViewer.openInNewTab")
                    : t("common.documentViewer.download")
                }
              >
                {source?.kind === "url" ? <ExternalLinkIcon /> : <DownloadIcon />}
              </a>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <XIcon />
          </Button>
        </div>
        {kind === "html" && query.data ? (
          <HtmlFrame blob={query.data} textKey={queryKey} title={name} />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div
              className={cn(
                "mx-auto px-4 py-6 md:px-8",
                kind === "csv" ? "max-w-none" : "max-w-4xl",
              )}
            >
              {query.isPending ? (
                <LoadingLines />
              ) : query.error ? (
                <Message>
                  {query.error.code === "INVALID_STATE"
                    ? t("common.documentViewer.tooLarge")
                    : t("common.documentViewer.loadFailed")}
                </Message>
              ) : kind ? (
                <Body kind={kind} blob={query.data} textKey={queryKey} name={name} />
              ) : null}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  kind,
  blob,
  textKey,
  name,
}: {
  kind: DocumentKind;
  blob: Blob;
  textKey: readonly unknown[];
  name: string;
}) {
  if (kind === "pdf")
    return (
      <Suspense fallback={<LoadingLines />}>
        <PdfDocument file={blob} />
      </Suspense>
    );
  return <TextBody kind={kind} blob={blob} textKey={textKey} name={name} />;
}

function TextBody({
  kind,
  blob,
  textKey,
  name,
}: {
  kind: DocumentKind;
  blob: Blob;
  textKey: readonly unknown[];
  name: string;
}) {
  const { data: text } = useQuery({
    queryKey: [...textKey, "text"],
    queryFn: () => blob.text(),
    staleTime: Infinity,
  });
  const ext = fileExtension(name);
  // codeFence scans the whole text; only redo it when the content changes
  const markdown = useMemo(
    () =>
      text === undefined || kind === "csv"
        ? undefined
        : kind === "markdown"
          ? text
          : codeFence(text, ext),
    [text, kind, ext],
  );
  if (text === undefined) return <LoadingLines />;
  if (kind === "csv") return <CsvTable text={text} tsv={ext === "tsv"} />;
  if (markdown === undefined) return <LoadingLines />;
  return <Markdown>{markdown}</Markdown>;
}

/** Plain-text/code files reuse the Markdown code block (highlighting, copy button). */
function codeFence(text: string, ext: string) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const lang = ext === "txt" || ext === "log" ? "text" : ext;
  return `${fence}${lang}\n${text}\n${fence}`;
}

/**
 * Untrusted HTML in an opaque-origin sandbox: no scripts, no forms, no access to our cookies or
 * DOM. Links open in a new tab, outside the sandbox.
 */
function HtmlFrame({
  blob,
  textKey,
  title,
}: {
  blob: Blob;
  textKey: readonly unknown[];
  title: string;
}) {
  const { data: html } = useQuery({
    // keyed by the document, not the Blob: a Blob hashes to "{}", so every file shared one entry
    queryKey: [...textKey, "text"],
    queryFn: () => blob.text(),
    staleTime: Infinity,
  });
  // a stable string keeps the iframe from reloading on unrelated re-renders
  const srcDoc = useMemo(
    () => (html === undefined ? undefined : `<base target="_blank">${html}`),
    [html],
  );
  if (srcDoc === undefined) return null;
  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="min-h-0 w-full flex-1 bg-white"
    />
  );
}

function LoadingLines() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{children}</p>;
}
