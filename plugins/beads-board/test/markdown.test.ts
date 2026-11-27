import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, renderMarkdown, sanitizeUrl } from "../src/markdown.ts";

test("renders structured Gemba Flow bead with headings, code, bold, italic, and checkboxes", () => {
  const md = [
    "## Context",
    "The gate in `eval/gates/g8-handoff.ts` fails on **empty** or *malformed* input.",
    "",
    "### Guardrails",
    "- Preserve `snake_case_var` identifiers",
    "- Do not multiply 2 * 3 * 4 into italics",
    "  - Nested bullet with `inline code`",
    "",
    "## Acceptance criteria",
    "- [ ] Handle empty input cleanly",
    "- [x] Add regression test",
    "- [X] Verify uppercase check",
    "",
    "1. First step",
    "2. Second step",
    "",
    "```ts",
    "const x = a < b && c > d;",
    "```",
  ].join("\n");

  const html = renderMarkdown(md);

  assert.match(html, /<h2 class="md-h md-h2">Context<\/h2>/);
  assert.match(html, /<h3 class="md-h md-h3">Guardrails<\/h3>/);
  assert.match(html, /<code class="md-code">eval\/gates\/g8-handoff\.ts<\/code>/);
  assert.match(html, /<strong>empty<\/strong>/);
  assert.match(html, /<em>malformed<\/em>/);
  assert.match(html, /<code class="md-code">snake_case_var<\/code>/);
  assert.match(html, /2 \* 3 \* 4/);
  assert.match(html, /<ul class="md-list"><li>Nested bullet with <code class="md-code">inline code<\/code><\/li><\/ul>/);
  assert.match(
    html,
    /<li class="md-task-item"><input class="md-checkbox" type="checkbox" disabled><span class="md-task-body">Handle empty input cleanly<\/span><\/li>/,
  );
  assert.match(
    html,
    /<li class="md-task-item"><input class="md-checkbox" type="checkbox" disabled checked><span class="md-task-body">Add regression test<\/span><\/li>/,
  );
  assert.match(
    html,
    /<li class="md-task-item"><input class="md-checkbox" type="checkbox" disabled checked><span class="md-task-body">Verify uppercase check<\/span><\/li>/,
  );
  assert.match(html, /<ol class="md-list"><li>First step<\/li><li>Second step<\/li><\/ol>/);
  assert.match(
    html,
    /<pre class="md-code-block" data-lang="ts"><code>const x = a &lt; b &amp;&amp; c &gt; d;<\/code><\/pre>/,
  );

  // No raw Markdown syntax leaked into headings or code spans
  assert.doesNotMatch(html, /## Context/);
  assert.doesNotMatch(html, /`eval\/gates\/g8-handoff\.ts`/);
});

test("preserves line breaks and lists in plain-prose beads without blank lines", () => {
  const plain = [
    "Investigate timeout in worker.",
    "Acceptance:",
    "- Timeout configurable via env",
    "- Unit test covers fallback",
  ].join("\n");

  const html = renderMarkdown(plain);
  assert.equal(
    html,
    '<p class="md-p">Investigate timeout in worker.<br>Acceptance:</p>' +
      '<ul class="md-list"><li>Timeout configurable via env</li><li>Unit test covers fallback</li></ul>',
  );
});

test("does not misparse #123 references or snake_case words", () => {
  const html = renderMarkdown("Fixes #123 in foo_bar_baz and __init__");
  assert.doesNotMatch(html, /<h1/);
  assert.doesNotMatch(html, /<em>/);
  assert.match(html, /Fixes #123 in foo_bar_baz/);
});

test("supports h1 through h4, blockquotes, horizontal rules, and safe links", () => {
  const md = [
    "# One",
    "## Two",
    "### Three",
    "#### Four",
    "> Quoted **note**",
    "---",
    "See [Docs](https://example.com/path?a=1&b=2) and http://localhost:3000/test.",
    "Wiki: [Markdown](https://en.wikipedia.org/wiki/Markdown_(markup))",
  ].join("\n");

  const html = renderMarkdown(md);
  assert.match(html, /<h1 class="md-h md-h1">One<\/h1>/);
  assert.match(html, /<h2 class="md-h md-h2">Two<\/h2>/);
  assert.match(html, /<h3 class="md-h md-h3">Three<\/h3>/);
  assert.match(html, /<h4 class="md-h md-h4">Four<\/h4>/);
  assert.match(
    html,
    /<blockquote class="md-blockquote"><p class="md-p">Quoted <strong>note<\/strong><\/p><\/blockquote>/,
  );
  assert.match(html, /<hr class="md-hr">/);
  assert.match(
    html,
    /<a class="md-link" href="https:\/\/example\.com\/path\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer" data-open-url="https:\/\/example\.com\/path\?a=1&amp;b=2">Docs<\/a>/,
  );
  assert.match(
    html,
    /<a class="md-link" href="http:\/\/localhost:3000\/test" target="_blank" rel="noopener noreferrer" data-open-url="http:\/\/localhost:3000\/test">http:\/\/localhost:3000\/test<\/a>\./,
  );
  assert.match(
    html,
    /<a class="md-link" href="https:\/\/en\.wikipedia\.org\/wiki\/Markdown_\(markup\)"/,
  );
});

const SAFE_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "input",
  "span",
  "pre",
  "code",
  "strong",
  "em",
  "del",
  "blockquote",
  "hr",
  "a",
]);

function assertOnlySafeHtmlTags(html: string, context: string) {
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    assert.ok(SAFE_TAGS.has(tag), `disallowed tag <${tag}> for: ${context}`);
    assert.doesNotMatch(
      attrs,
      /\bon[a-z]+\s*=/i,
      `event handler attribute on <${tag}> for: ${context}`,
    );
    assert.doesNotMatch(
      attrs,
      /javascript:/i,
      `javascript: in attribute on <${tag}> for: ${context}`,
    );
  }
}

test("escapes untrusted HTML and script tags everywhere (XSS protection)", () => {
  const payloads = [
    `<script>alert("xss")</script>`,
    `<img src=x onerror=alert(1)>`,
    `<svg/onload=alert(1)>`,
    `## <script>alert(1)</script>`,
    `**<img src=x onerror=alert(1)>**`,
    `- <iframe src="https://evil.test"></iframe>`,
    "`<script>alert(1)</script>`",
    "```\n</pre><script>alert(1)</script>\n```",
    `[<img src=x onerror=alert(1)>](https://example.com)`,
  ];

  for (const payload of payloads) {
    const html = renderMarkdown(payload);
    assertOnlySafeHtmlTags(html, payload);
    assert.doesNotMatch(html, /<script\b/i, `raw <script> leaked for: ${payload}`);
    assert.doesNotMatch(html, /<img\b/i, `raw <img> leaked for: ${payload}`);
    assert.doesNotMatch(html, /<svg\b/i, `raw <svg> leaked for: ${payload}`);
    assert.doesNotMatch(html, /<iframe\b/i, `raw <iframe> leaked for: ${payload}`);
  }
  assert.equal(
    renderMarkdown(`<img src=x onerror=alert(1)>`),
    `<p class="md-p">&lt;img src=x onerror=alert(1)&gt;</p>`,
  );
});

test("rejects javascript:, data:, vbscript:, file: URLs and attribute breakout attempts", () => {
  const dangerous = [
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click](  javascript:alert(1))",
    "[click](java\tscript:alert(1))",
    "[click](data:text/html,<script>alert(1)</script>)",
    "[click](vbscript:msgbox(1))",
    "[click](file:///etc/passwd)",
    "[click](<javascript:alert(1)>)",
    `[click](https://example.com" onclick="alert(1))`,
    `[click](https://example.com/a"b)`,
    "![img](javascript:alert(1))",
    "![img](https://example.com/pic.png)",
  ];

  for (const input of dangerous) {
    const html = renderMarkdown(input);
    assertOnlySafeHtmlTags(html, input);
    assert.doesNotMatch(html, /<a\b/i, `unsafe link became <a> for: ${input}`);
    assert.doesNotMatch(html, /<img\b/i, `image became <img> for: ${input}`);
    assert.doesNotMatch(html, /javascript:/i, `javascript: leaked for: ${input}`);
  }

  assert.equal(sanitizeUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeUrl("data:text/html,hi"), null);
  assert.equal(sanitizeUrl(`https://example.com" onclick="alert(1)`), null);
  assert.equal(sanitizeUrl("https://example.com/ok"), "https://example.com/ok");
  assert.equal(sanitizeUrl("http://example.com/ok"), "http://example.com/ok");
  assert.equal(escapeHtml(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
});
