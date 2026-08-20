import React, {useMemo, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import {
  highlightCode,
  isSafeMarkdownUrl,
  MarkdownBlock,
  parseMarkdown,
} from '../chat/markdown';

const colors = {
  surfaceRaised: '#232b37',
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  codeText: '#d8e5ff',
  keyword: '#ffb86c',
  string: '#9be28f',
  number: '#c6a0f6',
  comment: '#7f8c9f',
  operator: '#ff8fa3',
};

function renderInline(text: string, onUnsafeLink: () => void) {
  const parts = text
    .split(/(\[[^\]]+\]\(((?:[^()]|\([^()]*\))*)\))/g)
    .filter(Boolean);
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)$/);
    if (!link) {
      return <Text key={`${part}-${index}`}>{part}</Text>;
    }
    const [label, url] = [link[1], link[2].trim()];
    if (!isSafeMarkdownUrl(url)) {
      onUnsafeLink();
      return (
        <Text key={`${part}-${index}`} style={styles.unsafeLink}>
          {label} [unsafe link removed]
        </Text>
      );
    }
    return (
      <Text
        key={`${part}-${index}`}
        accessibilityRole="link"
        onPress={() => Linking.openURL(url).catch(() => undefined)}
        style={styles.link}>
        {label}
      </Text>
    );
  });
}

function CodeBlock({block}: {block: Extract<MarkdownBlock, {type: 'code'}>}) {
  const [expanded, setExpanded] = useState(block.code.split('\n').length <= 18);
  const tokens = useMemo(
    () => highlightCode(block.code, block.language),
    [block.code, block.language],
  );
  const hiddenLineCount = block.code.split('\n').length - 18;
  return (
    <View style={styles.codeContainer}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{block.language}</Text>
        <View style={styles.codeHeaderActions}>
          <Pressable
            accessibilityLabel="Copy code"
            onPress={() => Clipboard.setString(block.code)}>
            <Text style={styles.codeAction}>Copy</Text>
          </Pressable>
          {hiddenLineCount > 0 ? (
            <Pressable
              accessibilityLabel={
                expanded ? 'Collapse code block' : 'Expand code block'
              }
              onPress={() => setExpanded(value => !value)}>
              <Text style={styles.codeAction}>
                {expanded ? 'Collapse' : `Show ${hiddenLineCount} more lines`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text selectable style={styles.codeText}>
        {(expanded
          ? tokens
          : highlightCode(
              block.code.split('\n').slice(0, 18).join('\n'),
              block.language,
            )
        ).map((token, index) => (
          <Text key={`${token.text}-${index}`} style={styles[token.kind]}>
            {token.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

export function MarkdownMessage({content}: {content: string}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  const [unsafeLinkWarning, setUnsafeLinkWarning] = useState(false);
  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <Text
                key={index}
                style={[styles.heading, styles[`heading${block.level}`]]}>
                {renderInline(block.text, () => setUnsafeLinkWarning(true))}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={index} selectable style={styles.paragraph}>
                {renderInline(block.text, () => setUnsafeLinkWarning(true))}
              </Text>
            );
          case 'blockquote':
            return (
              <View key={index} style={styles.quote}>
                <Text selectable style={styles.quoteText}>
                  {renderInline(block.text, () => setUnsafeLinkWarning(true))}
                </Text>
              </View>
            );
          case 'list':
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <Text
                    key={`${item}-${itemIndex}`}
                    selectable
                    style={styles.listItem}>
                    {block.ordered ? `${itemIndex + 1}. ` : '• '}
                    {renderInline(item, () => setUnsafeLinkWarning(true))}
                  </Text>
                ))}
              </View>
            );
          case 'table':
            return (
              <View key={index} style={styles.table}>
                {[block.headers, ...block.rows].map((row, rowIndex) => (
                  <View
                    key={rowIndex}
                    style={[
                      styles.tableRow,
                      rowIndex === 0 && styles.tableHeader,
                    ]}>
                    {row.map((cell, cellIndex) => (
                      <Text
                        key={`${cell}-${cellIndex}`}
                        selectable
                        style={styles.tableCell}>
                        {renderInline(cell, () => setUnsafeLinkWarning(true))}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            );
          case 'code':
            return <CodeBlock key={index} block={block} />;
        }
      })}
      {unsafeLinkWarning ? (
        <Text accessibilityLiveRegion="polite" style={styles.warning}>
          Unsafe links were removed.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {gap: 8},
  paragraph: {color: colors.text, fontSize: 15, lineHeight: 21},
  heading: {color: colors.text, fontWeight: '700'},
  heading1: {fontSize: 22},
  heading2: {fontSize: 19},
  heading3: {fontSize: 17},
  heading4: {fontSize: 16},
  heading5: {fontSize: 15},
  heading6: {fontSize: 14},
  link: {color: colors.accent, textDecorationLine: 'underline'},
  unsafeLink: {color: colors.muted, fontStyle: 'italic'},
  quote: {borderLeftColor: colors.accent, borderLeftWidth: 3, paddingLeft: 10},
  quoteText: {color: colors.muted, fontSize: 14, lineHeight: 20},
  list: {gap: 4},
  listItem: {color: colors.text, fontSize: 15, lineHeight: 21},
  table: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  tableHeader: {backgroundColor: colors.surfaceRaised, borderTopWidth: 0},
  tableCell: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    padding: 7,
  },
  codeContainer: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    overflow: 'hidden',
  },
  codeHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  codeHeaderActions: {alignItems: 'center', flexDirection: 'row', gap: 10},
  codeLanguage: {color: colors.muted, fontSize: 11, textTransform: 'uppercase'},
  codeAction: {color: colors.accent, fontSize: 11, fontWeight: '600'},
  codeText: {
    color: colors.codeText,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  plain: {color: colors.codeText},
  keyword: {color: colors.keyword},
  string: {color: colors.string},
  number: {color: colors.number},
  comment: {color: colors.comment},
  operator: {color: colors.operator},
  warning: {color: colors.muted, fontSize: 11},
});
