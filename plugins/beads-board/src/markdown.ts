/**
 * Lightweight, zero-dependency, XSS-safe Markdown renderer for the Beads Board
 * detail pane.
 *
 * Security model:
 * - Raw HTML is NEVER passed through; all text, code, and attribute values are
 *   HTML-escaped.
 * - Links allow only `http://` and `https://` URLs validated via `new URL()`.
 *   Unsafe protocols (`javascript:`, `data:`, `vbscript:`, etc.) render only
 *   their escaped label text with no `<a>` tag.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validate an external URL for link rendering. Allows only `http:` and `https:`
 * schemes and rejects control characters or embedded whitespace.
 */
export function sanitizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f\s"'<>`]/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.href;
}

const ESCAPABLE_PUNCT = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "~",
  ">",
  "<",
  "|",
]);

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9]/.test(ch));
}

function isWhitespace(ch: string | undefined): boolean {
  return !ch || /\s/.test(ch);
}

/**
 * Find the matching closing delimiter (`**`, `__`, `~~`, `***`, `*`, `_`)
 * skipping over inline code spans and backslash escapes.
 */
function findClosingDelimiter(
  s: string,
  start: number,
  delim: string,
  requireWordBoundary: boolean,
): number {
  let i = start;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (s[i] === "`") {
      let tickLen = 0;
      while (i + tickLen < s.length && s[i + tickLen] === "`") tickLen++;
      const closeTick = findClosingBackticks(s, i + tickLen, tickLen);
      i = closeTick !== -1 ? closeTick + tickLen : i + tickLen;
      continue;
    }
    if (s.startsWith(delim, i)) {
      const prev = s[i - 1];
      const next = s[i + delim.length];
      // Do not match a single `*` inside `**` unless delim is `***` or `**`
      const overlapsStrong =
        delim.length === 1 &&
        (prev === delim || next === delim);
      if (
        !overlapsStrong &&
        i > start &&
        !isWhitespace(prev) &&
        (!requireWordBoundary || !isWordChar(next))
      ) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function findClosingBackticks(s: string, from: number, count: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === "`") {
      let run = 0;
      while (i + run < s.length && s[i + run] === "`") run++;
      if (run === count) return i;
      i += run;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Parse a Markdown link `[label](dest)` or image `![alt](dest)` starting at
 * the `[` index. Returns `{ label, url, end }` where `end` is the index just
 * past the closing `)`, or `null` if malformed.
 */
function parseLinkAt(
  s: string,
  openBracket: number,
): { label: string; url: string; end: number } | null {
  let depth = 1;
  let i = openBracket + 1;
  while (i < s.length && depth > 0) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (s[i] === "`") {
      let tickLen = 0;
      while (i + tickLen < s.length && s[i + tickLen] === "`") tickLen++;
      const closeTick = findClosingBackticks(s, i + tickLen, tickLen);
      i = closeTick !== -1 ? closeTick + tickLen : i + tickLen;
      continue;
    }
    if (s[i] === "[") depth++;
    else if (s[i] === "]") depth--;
    i++;
  }
  if (depth !== 0) return null;
  const closeBracket = i - 1;
  if (s[closeBracket + 1] !== "(") return null;

  const label = s.slice(openBracket + 1, closeBracket);
  let j = closeBracket + 2;
  // Skip leading spaces inside (...)
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;

  // Support optional <url> angle-bracket syntax or bare url with balanced parens
  let urlRaw = "";
  if (s[j] === "<") {
    const closeAngle = s.indexOf(">", j + 1);
    if (closeAngle === -1) return null;
    urlRaw = s.slice(j + 1, closeAngle);
    j = closeAngle + 1;
    while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
    if (s[j] !== ")") {
      const closeParen = s.indexOf(")", j);
      if (closeParen === -1) return null;
      j = closeParen;
    }
    return { label, url: urlRaw, end: j + 1 };
  }

  let parenDepth = 0;
  const urlStart = j;
  while (j < s.length) {
    const ch = s[j];
    if (ch === "\\" && j + 1 < s.length) {
      j += 2;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      j++;
      continue;
    }
    if (ch === ")") {
      if (parenDepth === 0) break;
      parenDepth--;
      j++;
      continue;
    }
    if (ch === " " || ch === "\t") {
      // Optional CommonMark link title ("...", '...', or (...)) after whitespace
      const candidateUrl = s.slice(urlStart, j);
      let k = j;
      while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
      if (s[k] === ")") {
        return { label, url: candidateUrl, end: k + 1 };
      }
      if (s[k] === '"' || s[k] === "'") {
        const quote = s[k];
        k++;
        while (k < s.length && s[k] !== quote) {
          if (s[k] === "\\" && k + 1 < s.length) k += 2;
          else k++;
        }
        if (k < s.length && s[k] === quote) {
          k++;
          while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
          if (s[k] === ")") {
            return { label, url: candidateUrl, end: k + 1 };
          }
        }
      }
      // Malformed destination with unquoted spaces — consume to ')' and let sanitizeUrl reject it
      while (j < s.length && s[j] !== ")") {
        if (s[j] === "\\" && j + 1 < s.length) j += 2;
        else j++;
      }
      if (j >= s.length) return null;
      return { label, url: s.slice(urlStart, j), end: j + 1 };
    }
    j++;
  }
  if (j >= s.length || s[j] !== ")") return null;
  urlRaw = s.slice(urlStart, j);
  return { label, url: urlRaw, end: j + 1 };
}

function renderInline(s: string, inLink = false): string {
  let out = "";
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // 1. Backslash escape
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE_PUNCT.has(s[i + 1])) {
      out += escapeHtml(s[i + 1]);
      i += 2;
      continue;
    }

    // 2. Inline code span (`...` or ``...``)
    if (ch === "`") {
      let tickLen = 0;
      while (i + tickLen < s.length && s[i + tickLen] === "`") tickLen++;
      const close = findClosingBackticks(s, i + tickLen, tickLen);
      if (close !== -1) {
        let code = s.slice(i + tickLen, close);
        if (
          code.length >= 2 &&
          code.startsWith(" ") &&
          code.endsWith(" ") &&
          code.trim().length > 0
        ) {
          code = code.slice(1, -1);
        }
        out += `<code class="md-code">${escapeHtml(code)}</code>`;
        i = close + tickLen;
        continue;
      }
      out += "`".repeat(tickLen);
      i += tickLen;
      continue;
    }

    // 3. Markdown image ![alt](url) — never emit <img>; render escaped alt text
    if (ch === "!" && s[i + 1] === "[") {
      const parsed = parseLinkAt(s, i + 1);
      if (parsed) {
        out += escapeHtml(parsed.label);
        i = parsed.end;
        continue;
      }
    }

    // 4. Markdown link [label](url)
    if (ch === "[" && !inLink) {
      const parsed = parseLinkAt(s, i);
      if (parsed) {
        const labelHtml = renderInline(parsed.label, true);
        const safeUrl = sanitizeUrl(parsed.url);
        if (safeUrl) {
          const escapedUrl = escapeHtml(safeUrl);
          out += `<a class="md-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer" data-open-url="${escapedUrl}">${labelHtml}</a>`;
        } else {
          out += labelHtml;
        }
        i = parsed.end;
        continue;
      }
    }

    // 5. Bold+italic (***...***)
    if (s.startsWith("***", i) && !isWhitespace(s[i + 3])) {
      const close = findClosingDelimiter(s, i + 3, "***", false);
      if (close !== -1) {
        out += `<strong><em>${renderInline(s.slice(i + 3, close), inLink)}</em></strong>`;
        i = close + 3;
        continue;
      }
    }

    // 6. Bold (**...** or __...__)
    if (s.startsWith("**", i) && !isWhitespace(s[i + 2])) {
      const close = findClosingDelimiter(s, i + 2, "**", false);
      if (close !== -1) {
        out += `<strong>${renderInline(s.slice(i + 2, close), inLink)}</strong>`;
        i = close + 2;
        continue;
      }
    }
    if (
      s.startsWith("__", i) &&
      !isWordChar(s[i - 1]) &&
      !isWhitespace(s[i + 2])
    ) {
      const close = findClosingDelimiter(s, i + 2, "__", true);
      if (close !== -1) {
        out += `<strong>${renderInline(s.slice(i + 2, close), inLink)}</strong>`;
        i = close + 2;
        continue;
      }
    }

    // 7. Strikethrough (~~...~~)
    if (s.startsWith("~~", i) && !isWhitespace(s[i + 2])) {
      const close = findClosingDelimiter(s, i + 2, "~~", false);
      if (close !== -1) {
        out += `<del>${renderInline(s.slice(i + 2, close), inLink)}</del>`;
        i = close + 2;
        continue;
      }
    }

    // 8. Italic (*...* or _..._)
    if (ch === "*" && s[i + 1] !== "*" && !isWhitespace(s[i + 1])) {
      const close = findClosingDelimiter(s, i + 1, "*", false);
      if (close !== -1) {
        out += `<em>${renderInline(s.slice(i + 1, close), inLink)}</em>`;
        i = close + 1;
        continue;
      }
    }
    if (
      ch === "_" &&
      s[i + 1] !== "_" &&
      !isWordChar(s[i - 1]) &&
      !isWhitespace(s[i + 1])
    ) {
      const close = findClosingDelimiter(s, i + 1, "_", true);
      if (close !== -1) {
        out += `<em>${renderInline(s.slice(i + 1, close), inLink)}</em>`;
        i = close + 1;
        continue;
      }
    }

    // 9. Bare autolink (http:// or https://)
    if (
      !inLink &&
      (s.startsWith("https://", i) || s.startsWith("http://", i)) &&
      (i === 0 || /[\s([{:]/.test(s[i - 1]))
    ) {
      const m = /^https?:\/\/[^\s<>"'`]+/.exec(s.slice(i));
      if (m) {
        let candidate = m[0];
        // Strip trailing sentence punctuation and unmatched closing parens/brackets
        while (candidate.length > 0) {
          const last = candidate[candidate.length - 1];
          if (/[.,;:!?]/.test(last)) {
            candidate = candidate.slice(0, -1);
          } else if (last === ")") {
            const opens = (candidate.match(/\(/g) || []).length;
            const closes = (candidate.match(/\)/g) || []).length;
            if (closes > opens) candidate = candidate.slice(0, -1);
            else break;
          } else if (last === "]") {
            const opens = (candidate.match(/\[/g) || []).length;
            const closes = (candidate.match(/\]/g) || []).length;
            if (closes > opens) candidate = candidate.slice(0, -1);
            else break;
          } else {
            break;
          }
        }
        const safeUrl = sanitizeUrl(candidate);
        if (safeUrl) {
          const escapedUrl = escapeHtml(safeUrl);
          out += `<a class="md-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer" data-open-url="${escapedUrl}">${escapeHtml(candidate)}</a>`;
          i += candidate.length;
          continue;
        }
      }
    }

    // 10. Plain escaped character
    out += escapeHtml(ch);
    i++;
  }

  return out;
}

type ListMatch = {
  indent: number;
  kind: "ul" | "ol";
  start: number;
  task: "checked" | "unchecked" | null;
  content: string;
};

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 2 : 1;
  return w;
}

function matchFenceOpen(line: string): { char: string; len: number; lang: string } | null {
  const m = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
  if (!m) return null;
  const char = m[1][0];
  const info = m[2].trim();
  if (char === "`" && info.includes("`")) return null;
  const langMatch = /^([A-Za-z0-9._+-]+)/.exec(info);
  return { char, len: m[1].length, lang: langMatch ? langMatch[1] : "" };
}

function isFenceClose(line: string, char: string, len: number): boolean {
  const re = new RegExp(`^ {0,3}${char === "`" ? "`" : "~"}{${len},}[ \\t]*$`);
  return re.test(line);
}

function matchHeading(line: string): { level: number; text: string } | null {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
  if (!m) return null;
  let text = (m[2] ?? "").trim();
  // Strip optional closing ATX hashes preceded by whitespace
  text = text.replace(/[ \t]+#+[ \t]*$/, "").trim();
  return { level: m[1].length, text };
}

function isHorizontalRule(line: string): boolean {
  return /^ {0,3}(?:(-[ \t]*){3,}|(\*[ \t]*){3,}|(_[ \t]*){3,})$/.test(line);
}

function matchBlockquote(line: string): string | null {
  const m = /^ {0,3}>[ \t]?(.*)$/.exec(line);
  return m ? m[1] : null;
}

function matchListItem(line: string): ListMatch | null {
  const ul = /^([ \t]*)([-*+])[ \t]+(.*)$/.exec(line);
  if (ul) {
    const rest = ul[3];
    const task = /^\[([ xX])\](?:[ \t]+(.*)|$)/.exec(rest);
    return {
      indent: indentWidth(ul[1]),
      kind: "ul",
      start: 1,
      task: task ? (task[1].toLowerCase() === "x" ? "checked" : "unchecked") : null,
      content: task ? (task[2] ?? "") : rest,
    };
  }
  const ol = /^([ \t]*)(\d{1,9})\.[ \t]+(.*)$/.exec(line);
  if (ol) {
    return {
      indent: indentWidth(ol[1]),
      kind: "ol",
      start: Number.parseInt(ol[2], 10),
      task: null,
      content: ol[3],
    };
  }
  return null;
}

function isBlockStart(line: string): boolean {
  return (
    matchFenceOpen(line) !== null ||
    matchHeading(line) !== null ||
    isHorizontalRule(line) ||
    matchBlockquote(line) !== null ||
    matchListItem(line) !== null
  );
}

function stripIndent(line: string, cols: number): string {
  let removed = 0;
  let idx = 0;
  while (idx < line.length && removed < cols) {
    if (line[idx] === "\t") {
      removed += 2;
      idx++;
    } else if (line[idx] === " ") {
      removed += 1;
      idx++;
    } else {
      break;
    }
  }
  return line.slice(idx);
}

function parseList(
  lines: string[],
  startIdx: number,
  baseIndent: number,
  kind: "ul" | "ol",
): { html: string; nextIdx: number } {
  const first = matchListItem(lines[startIdx])!;
  const items: string[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const itemMatch = matchListItem(lines[i]);
    if (!itemMatch || itemMatch.indent !== baseIndent || itemMatch.kind !== kind) {
      break;
    }

    const contentLines: string[] = [itemMatch.content];
    const nestedBlocks: string[] = [];
    i++;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") {
        // Peek ahead past blank lines
        let k = i;
        while (k < lines.length && lines[k].trim() === "") k++;
        if (k >= lines.length) {
          i = k;
          break;
        }
        const nextLine = lines[k];
        const nextList = matchListItem(nextLine);
        if (nextList && nextList.indent === baseIndent && nextList.kind === kind) {
          i = k;
          break;
        }
        const nextIndent = indentWidth(/^[ \t]*/.exec(nextLine)![0]);
        if (nextIndent > baseIndent) {
          i = k;
          continue;
        }
        i = k;
        break;
      }

      const nextList = matchListItem(line);
      if (nextList) {
        if (nextList.indent > baseIndent) {
          const nested = parseList(lines, i, nextList.indent, nextList.kind);
          nestedBlocks.push(nested.html);
          i = nested.nextIdx;
          continue;
        }
        break;
      }

      const lineIndent = indentWidth(/^[ \t]*/.exec(line)![0]);
      if (lineIndent > baseIndent) {
        const unindented = stripIndent(line, baseIndent + 2);
        // Handle fenced code block indented inside a list item
        const fence = matchFenceOpen(unindented);
        if (fence) {
          const codeLines: string[] = [];
          i++;
          while (i < lines.length) {
            const cLine = stripIndent(lines[i], baseIndent + 2);
            if (isFenceClose(cLine, fence.char, fence.len)) {
              i++;
              break;
            }
            codeLines.push(cLine);
            i++;
          }
          const langAttr = fence.lang ? ` data-lang="${escapeHtml(fence.lang)}"` : "";
          nestedBlocks.push(
            `<pre class="md-code-block"${langAttr}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
          );
          continue;
        }
        contentLines.push(unindented.trimEnd());
        i++;
        continue;
      }

      break;
    }

    const bodyHtml =
      contentLines.map((l) => renderInline(l.trimEnd())).join("<br>") +
      nestedBlocks.join("");

    if (itemMatch.task !== null) {
      const checkedAttr = itemMatch.task === "checked" ? " checked" : "";
      items.push(
        `<li class="md-task-item"><input class="md-checkbox" type="checkbox" disabled${checkedAttr}><span class="md-task-body">${bodyHtml}</span></li>`,
      );
    } else {
      items.push(`<li>${bodyHtml}</li>`);
    }
  }

  const startAttr = kind === "ol" && first.start !== 1 ? ` start="${first.start}"` : "";
  return {
    html: `<${kind} class="md-list"${startAttr}>${items.join("")}</${kind}>`,
    nextIdx: i,
  };
}

function renderBlocks(lines: string[]): string {
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    const fence = matchFenceOpen(line);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i], fence.char, fence.len)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      const langAttr = fence.lang ? ` data-lang="${escapeHtml(fence.lang)}"` : "";
      blocks.push(
        `<pre class="md-code-block"${langAttr}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Heading
    const heading = matchHeading(line);
    if (heading) {
      blocks.push(
        `<h${heading.level} class="md-h md-h${heading.level}">${renderInline(heading.text)}</h${heading.level}>`,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (isHorizontalRule(line)) {
      blocks.push(`<hr class="md-hr">`);
      i++;
      continue;
    }

    // Blockquote
    const bq = matchBlockquote(line);
    if (bq !== null) {
      const quoteLines: string[] = [bq];
      i++;
      while (i < lines.length) {
        const nextBq = matchBlockquote(lines[i]);
        if (nextBq !== null) {
          quoteLines.push(nextBq);
          i++;
        } else {
          break;
        }
      }
      blocks.push(
        `<blockquote class="md-blockquote">${renderBlocks(quoteLines)}</blockquote>`,
      );
      continue;
    }

    // List (bullet, numbered, or task list)
    const listMatch = matchListItem(line);
    if (listMatch) {
      const parsed = parseList(lines, i, listMatch.indent, listMatch.kind);
      blocks.push(parsed.html);
      i = parsed.nextIdx;
      continue;
    }

    // Paragraph (breaks: true — single newlines become <br>, block elements interrupt cleanly)
    const paraLines: string[] = [line.trimEnd()];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === "" || isBlockStart(next)) break;
      paraLines.push(next.trimEnd());
      i++;
    }
    blocks.push(
      `<p class="md-p">${paraLines.map((l) => renderInline(l)).join("<br>")}</p>`,
    );
  }

  return blocks.join("");
}

/**
 * Render Markdown text to sanitized, XSS-safe HTML for the detail pane.
 */
export function renderMarkdown(input: string): string {
  if (!input) return "";
  const normalized = input.replace(/\r\n?/g, "\n");
  return renderBlocks(normalized.split("\n"));
}
