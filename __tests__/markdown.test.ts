import {
  highlightCode,
  isSafeMarkdownUrl,
  parseInlineMarkdown,
  parseMarkdown,
} from '../src/chat/markdown';

describe('secure markdown parser', () => {
  it('parses headings, lists, blockquotes, tables, and fenced code', () => {
    const blocks = parseMarkdown(
      '# Heading\n\n- one\n- two\n\n> quote\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst value = 1;\n```',
    );
    expect(blocks).toEqual([
      {type: 'heading', level: 1, text: 'Heading'},
      {type: 'list', ordered: false, items: ['one', 'two']},
      {type: 'blockquote', text: 'quote'},
      {type: 'table', headers: ['A', 'B'], rows: [['1', '2']]},
      {type: 'code', language: 'ts', code: 'const value = 1;'},
    ]);
  });

  it('handles malformed Markdown conservatively as text', () => {
    expect(parseMarkdown('unclosed **emphasis and [text](not a url')).toEqual([
      {type: 'paragraph', text: 'unclosed **emphasis and [text](not a url'},
    ]);
  });

  it('allows only explicit web/mail schemes and removes unsafe links', () => {
    expect(isSafeMarkdownUrl('https://example.test')).toBe(true);
    expect(isSafeMarkdownUrl('mailto:test@example.test')).toBe(true);
    const unsafeScheme = `java${'script'}:alert(1)`;
    expect(isSafeMarkdownUrl(unsafeScheme)).toBe(false);
    expect(isSafeMarkdownUrl('data:text/html,<script>alert(1)</script>')).toBe(
      false,
    );
    expect(
      parseInlineMarkdown(
        '[good](https://example.test) [bad](javascript:alert(1))',
      ),
    ).toBe('good bad [unsafe link removed]');
  });

  it('tokenizes common code syntax without evaluating or rendering HTML', () => {
    const tokens = highlightCode('const value = "hello"; // note', 'ts');
    expect(
      tokens.some(token => token.kind === 'keyword' && token.text === 'const'),
    ).toBe(true);
    expect(tokens.some(token => token.kind === 'string')).toBe(true);
    expect(tokens.some(token => token.kind === 'comment')).toBe(true);
  });
});
