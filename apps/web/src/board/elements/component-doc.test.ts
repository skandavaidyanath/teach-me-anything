import { describe, expect, it } from "vitest";
import { buildComponentDocument, stripDocumentWrapper } from "./component-doc";

describe("component document", () => {
  it("keeps only what belongs in the body when the model hands back a whole page", () => {
    const code = '```html\n<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>x</title><style>p{color:red}</style></head>\n<body class="a">\n<p>Hi</p>\n<script>var a = 1;</script>\n</body></html>\n```';
    expect(stripDocumentWrapper(code)).toBe("<style>p{color:red}</style>\n\n<p>Hi</p>\n<script>var a = 1;</script>");
  });

  it("embeds the initial state safely and locks the frame down", () => {
    const doc = buildComponentDocument("<p>x</p>", { note: "</script><b>", n: 1 });
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain('var state={"note":"\\u003c/script>\\u003cb>","n":1};');
    expect(doc.indexOf("<p>x</p>")).toBeGreaterThan(doc.indexOf("window.addEventListener(\"load\""));
  });
});
