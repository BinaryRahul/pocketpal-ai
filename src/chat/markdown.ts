export type MarkdownToken = {
  text: string;
  kind: 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'operator';
};

export type MarkdownBlock =
  | {type: 'paragraph'; text: string}
  | {type: 'heading'; level: number; text: string}
  | {type: 'blockquote'; text: string}
  | {type: 'list'; ordered: boolean; items: string[]}
  | {type: 'code'; language: string; code: string}
  | {type: 'table'; headers: string[]; rows: string[][]};

const SAFE_SCHEMES = new Set(['https:', 'http:', 'mailto:']);
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'class',
  'new',
  'import',
  'from',
  'export',
  'async',
  'await',
  'def',
  'true',
  'false',
  'null',
]);

export function isSafeMarkdownUrl(value: string): boolean {
  const scheme = value
    .trim()
    .match(/^([a-z][a-z\d+.-]*:)/i)?.[1]
    ?.toLowerCase();
  return Boolean(scheme && SAFE_SCHEMES.has(scheme));
}

export function parseInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(
      /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g,
      (_match, label: string, url: string) =>
        isSafeMarkdownUrl(url.trim())
          ? label
          : `${label} [unsafe link removed]`,
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)([^*_\n]+)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1');
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => parseInlineMarkdown(cell.trim()));
}

export function parseMarkdown(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({
        type: 'code',
        language: fence[1] || 'text',
        code: codeLines.join('\n'),
      });
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: parseInlineMarkdown(heading[2]),
      });
      index += 1;
      continue;
    }
    if (
      index + 1 < lines.length &&
      line.includes('|') &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].includes('|') &&
        lines[index].trim()
      ) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({type: 'table', headers, rows});
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const quoteLines = [quote[1]];
      index += 1;
      while (index < lines.length) {
        const nextQuote = lines[index].match(/^\s*>\s?(.*)$/);
        if (!nextQuote) {
          break;
        }
        quoteLines.push(nextQuote[1]);
        index += 1;
      }
      blocks.push({
        type: 'blockquote',
        text: parseInlineMarkdown(quoteLines.join('\n')),
      });
      continue;
    }
    const list = line.match(/^\s*([-*+] |\d+[.)] )(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items = [parseInlineMarkdown(list[2])];
      index += 1;
      while (index < lines.length) {
        const next = lines[index].match(/^\s*([-*+] |\d+[.)] )(.+)$/);
        if (!next || /^\d/.test(next[1]) !== ordered) {
          break;
        }
        items.push(parseInlineMarkdown(next[2]));
        index += 1;
      }
      blocks.push({type: 'list', ordered, items});
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s*#{1,6}\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*([-*+] |\d+[.)] )/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      text: parseInlineMarkdown(paragraphLines.join('\n')),
    });
  }
  return blocks;
}

export function highlightCode(code: string, language: string): MarkdownToken[] {
  if (!language || language === 'text' || language === 'txt') {
    return [{text: code, kind: 'plain'}];
  }
  const tokenPattern =
    /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|===|!==|=>|[+*/%=<>-]|\b[A-Za-z_$][\w$]*\b)/g;
  const tokens: MarkdownToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(code))) {
    if (match.index > lastIndex) {
      tokens.push({text: code.slice(lastIndex, match.index), kind: 'plain'});
    }
    const value = match[0];
    const kind = /^\/\/|^#|^\/\*/.test(value)
      ? 'comment'
      : /^['"]/.test(value)
        ? 'string'
        : /^\d/.test(value)
          ? 'number'
          : KEYWORDS.has(value)
            ? 'keyword'
            : /^[+*/%=<>-]|^===|^!==|^=>/.test(value)
              ? 'operator'
              : 'plain';
    tokens.push({text: value, kind});
    lastIndex = tokenPattern.lastIndex;
  }
  if (lastIndex < code.length) {
    tokens.push({text: code.slice(lastIndex), kind: 'plain'});
  }
  return tokens.length ? tokens : [{text: code, kind: 'plain'}];
}
