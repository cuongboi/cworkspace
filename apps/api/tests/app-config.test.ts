import { describe, expect, test } from "bun:test";
import {
  buildManifest,
  DEFAULT_APP_CONFIG,
  parseAppConfig,
  renderHead,
} from "@app/shared/app-config";

describe("parseAppConfig", () => {
  test("defaults when nothing is set", () => {
    expect(parseAppConfig({})).toEqual(DEFAULT_APP_CONFIG);
  });

  test("reads APP_NAME and APP_INFO", () => {
    const cfg = parseAppConfig({
      APP_NAME: " Acme ",
      APP_INFO: JSON.stringify({
        description: "Hi",
        themeColor: "#123456",
        ogImage: "/og.png",
        locale: "ja_JP",
        twitterSite: "@acme",
        unknown: 1,
      }),
      APP_URL: "https://work.acme.test/",
    });
    expect(cfg).toMatchObject({
      name: "Acme",
      shortName: "Acme",
      description: "Hi",
      themeColor: "#123456",
      backgroundColor: "#123456",
      ogImage: "/og.png",
      locale: "ja_JP",
      twitterSite: "@acme",
      url: "https://work.acme.test",
    });
  });

  test("APP_URL that isn't a URL (WEB_ORIGIN=*) leaves url empty", () => {
    expect(parseAppConfig({ APP_URL: "*" }).url).toBe("");
  });

  test.each([
    ["{oops", /not valid JSON/],
    ["[1]", /JSON object/],
    ['{"themeColor":"red"}', /#hex/],
    ['{"ogImage":"javascript:alert(1)"}', /ogImage/],
    ['{"locale":"english"}', /locale/],
    ['{"description":42}', /must be a string/],
  ])("rejects APP_INFO=%s", (info, message) => {
    expect(() => parseAppConfig({ APP_INFO: info })).toThrow(message);
  });
});

describe("renderHead", () => {
  test("escapes user-controlled values in tags and the inline script", () => {
    const cfg = parseAppConfig({
      APP_NAME: `</title><script>alert(1)</script>"`,
      APP_INFO: JSON.stringify({ description: "a\u2028b</script>" }),
    });
    const head = renderHead(cfg);
    expect(head).not.toContain("<script>alert");
    expect(head).toContain("<title>&#60;/title&#62;&#60;script&#62;");
    const script = /<script>(.*)<\/script>/s.exec(head)?.[1] ?? "";
    expect(script).not.toContain("</");
    expect(script).not.toContain("\u2028");
    // still the same value once parsed
    expect(JSON.parse(script.replace("window.__APP_CONFIG__=", "")).description).toBe(
      "a\u2028b</script>",
    );
  });

  test("absolute OG urls from APP_URL, else from the request origin, else omitted", () => {
    const withUrl = parseAppConfig({
      APP_INFO: '{"ogImage":"/og.png"}',
      APP_URL: "https://a.test",
    });
    expect(renderHead(withUrl, "https://ignored.test")).toContain(
      '<meta property="og:image" content="https://a.test/og.png" />',
    );
    const noUrl = parseAppConfig({ APP_INFO: '{"ogImage":"/og.png"}', APP_URL: "*" });
    expect(renderHead(noUrl, "https://b.test")).toContain('content="https://b.test/og.png"');
    expect(renderHead(noUrl, "https://b.test")).toContain(
      'name="twitter:card" content="summary_large_image"',
    );
    const bare = renderHead(noUrl);
    expect(bare).not.toContain("og:image");
    expect(bare).not.toContain("og:url");
    expect(bare).toContain('content="summary"');
  });
});

test("buildManifest uses the configured names and colors", () => {
  const m = buildManifest(
    parseAppConfig({ APP_NAME: "Acme", APP_INFO: '{"shortName":"A","backgroundColor":"#fff"}' }),
  );
  expect(m).toMatchObject({ name: "Acme", short_name: "A", background_color: "#fff", lang: "en" });
});
