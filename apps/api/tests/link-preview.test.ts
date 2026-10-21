import { describe, expect, test } from "bun:test";
import {
  extractLinks,
  type DocumentKind,
  documentKind,
  matchEmbed,
  mediaTypeFromUrl,
} from "@app/shared/link-preview";
import { assertPublicUrl } from "../src/lib/safe-fetch";
import {
  decodeEntities,
  documentUrl,
  normalizeUrl,
  parseHtmlMeta,
} from "../src/server/link-preview";

describe("assertPublicUrl", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.1.2.3/",
    "http://192.168.0.1/",
    "http://[::ffff:127.0.0.1]/",
    "https://example.com:22/",
    "https://user:pass@example.com/",
    "ftp://example.com/",
    "file:///etc/passwd",
  ]) {
    test(`rejects ${url}`, async () => {
      await expect(assertPublicUrl(new URL(url))).rejects.toThrow();
    });
  }
});

describe("matchEmbed", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s", "youtube", "start=65"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube", "/embed/dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "youtube", "/embed/dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "vimeo", "/video/76979871"],
    [
      "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
      "loom",
      "/embed/0123456789abcdef0123456789abcdef",
    ],
  ])("%s", (url, provider, fragment) => {
    const e = matchEmbed(url);
    expect(e?.provider).toBe(provider as never);
    expect(e?.embedUrl).toContain(fragment);
  });

  test("ignores look-alikes and bad ids", () => {
    expect(matchEmbed("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(matchEmbed("https://www.youtube.com/watch?v=<script>")).toBeNull();
    expect(matchEmbed("https://vimeo.com/channels/staff")).toBeNull();
  });
});

test("mediaTypeFromUrl", () => {
  expect(mediaTypeFromUrl("https://x.test/a/b.JPG?w=1")).toBe("image");
  expect(mediaTypeFromUrl("https://x.test/clip.mp4")).toBe("video");
  expect(mediaTypeFromUrl("https://x.test/page.html")).toBeNull();
});

test("extractLinks dedupes and caps", () => {
  const text =
    "a https://a.test b https://a.test @[Bob](u1) https://b.test https://c.test https://d.test";
  expect(extractLinks(text)).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
});

test("normalizeUrl strips fragment and tracking params", () => {
  expect(normalizeUrl("https://a.test/p?id=1&utm_source=x&fbclid=y#top")).toBe(
    "https://a.test/p?id=1",
  );
  expect(normalizeUrl("javascript:alert(1)")).toBeNull();
});

test("decodeEntities", () => {
  expect(decodeEntities("Tom &amp; Jerry &#39;s &#x2014; &quot;x&quot;")).toBe(
    `Tom & Jerry 's — "x"`,
  );
});

describe("parseHtmlMeta", () => {
  const base = new URL("https://site.test/blog/post");

  test("prefers Open Graph, resolves relative URLs", async () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Hello &amp; welcome">
      <meta property="og:description" content="Desc">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Site">
      <meta name="theme-color" content="#112233">
      <link rel="shortcut icon" href="/fav.ico"></head><body><meta property="og:title" content="late"></body></html>`;
    expect(await parseHtmlMeta(html, base)).toEqual({
      type: "page",
      title: "Hello & welcome",
      description: "Desc",
      image: "https://site.test/img/cover.png",
      imageLayout: "banner",
      siteName: "Site",
      favicon: "https://site.test/fav.ico",
      themeColor: "#112233",
    });
  });

  test("falls back to twitter and <title>, drops non-http images", async () => {
    const meta = await parseHtmlMeta(
      `<head><title> Plain  title </title><meta name="twitter:card" content="summary">
       <meta name="twitter:image" content="javascript:alert(1)"><meta name="description" content="d"></head>`,
      base,
    );
    expect(meta?.title).toBe("Plain title");
    expect(meta?.description).toBe("d");
    expect(meta?.image).toBeUndefined();
    expect(meta?.imageLayout).toBe("thumb");
    expect(meta?.favicon).toBe("https://site.test/favicon.ico");
  });

  test("no title → null", async () => {
    expect(await parseHtmlMeta("<head></head><body>hi</body>", base)).toBeNull();
  });
});

describe("document links", () => {
  test.each([
    ["README.md", "markdown"],
    ["notes.MARKDOWN", "markdown"],
    ["page.htm", "html"],
    ["data.tsv", "csv"],
    ["report.pdf", "pdf"],
    ["config.yaml", "text"],
    ["archive.md.zip", null],
    ["md", null],
  ])("documentKind(%s)", (name, kind) => {
    expect(documentKind(name)).toBe(kind as DocumentKind | null);
  });
  test("documentUrl", () => {
    expect(documentUrl("https://raw.githubusercontent.com/o/r/main/README.md")).toEqual({
      url: "https://raw.githubusercontent.com/o/r/main/README.md",
      kind: "markdown",
    });
    expect(documentUrl("https://example.com/page?f=a.pdf")).toBeNull();
    expect(documentUrl("file:///etc/notes.md")).toBeNull();
    expect(documentUrl("not a url")).toBeNull();
  });
});
