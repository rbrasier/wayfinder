import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./markdown-html";

describe("renderMarkdownToHtml", () => {
  it("renders paragraphs, emphasis, code and safe links", () => {
    expect(renderMarkdownToHtml("Hello **team**, see [the notes](https://example.gov.au) and `H-1`.")).toBe(
      '<p>Hello <strong>team</strong>, see <a href="https://example.gov.au">the notes</a> and <code>H-1</code>.</p>',
    );
  });

  it("renders headings and both kinds of list", () => {
    expect(renderMarkdownToHtml("# Summary\n\n- one\n- two\n\n1. first\n2. second")).toBe(
      "<h3>Summary</h3><ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>",
    );
  });

  it("escapes HTML so a value pasted into the message can never inject markup", () => {
    expect(renderMarkdownToHtml('A <script>alert("x")</script> & "quotes"')).toBe(
      "<p>A &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;</p>",
    );
  });

  it("keeps an unsafe link as text", () => {
    expect(renderMarkdownToHtml("[click](javascript:alert(1))")).not.toContain("<a ");
  });

  it("keeps line breaks inside a paragraph and renders code blocks verbatim", () => {
    expect(renderMarkdownToHtml("line one\nline two")).toBe("<p>line one<br>line two</p>");
    expect(renderMarkdownToHtml("```\na < b\n```")).toBe("<pre><code>a &lt; b</code></pre>");
  });
});
