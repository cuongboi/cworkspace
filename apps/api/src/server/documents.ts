import { DOCUMENT_CONTENT_TYPES, type DocumentKind } from "@app/shared/link-preview";

/**
 * Raw bytes for the in-app document viewer. Served same-origin (the bucket has no CORS) and always
 * as an inert download: HTML goes out as text/plain under a sandbox CSP, so opening the URL
 * directly can never run it on our origin. The viewer renders HTML in a sandboxed iframe instead.
 */
export function documentResponse(body: Uint8Array, kind: DocumentKind) {
  return new Response(body, {
    headers: {
      "content-type": DOCUMENT_CONTENT_TYPES[kind],
      "content-disposition": "attachment",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}
