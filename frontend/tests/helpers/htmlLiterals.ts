import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Extracts every HTML-looking string literal from the frontend source, via the TypeScript AST.
 *
 * Shared by the two tests that keep the Trusted Types migration honest: one checks the sanitiser
 * does not alter this markup, the other checks inserting it never touches a Trusted Types sink.
 * Both need the same corpus — the real markup, not a hand-written sample of it.
 */

/** Stand-in for a `${...}` interpolation while checking the static shape of a literal. */
export const PLACEHOLDER = 'Xy';

export interface HtmlLiteral {
  file: string;
  line: number;
  text: string;
}

export function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function literalText(node: ts.Node): string | null {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += PLACEHOLDER + span.literal.text;
    return text;
  }
  return null;
}

const LOOKS_LIKE_HTML = /<[a-zA-Z][a-zA-Z0-9-]*[\s/>]/;

export function collectHtmlLiterals(root = 'src'): HtmlLiteral[] {
  const found: HtmlLiteral[] = [];
  for (const file of walkFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      const text = literalText(node);
      if (text !== null && LOOKS_LIKE_HTML.test(text)) {
        found.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

/**
 * The element a fragment must be parsed inside for the HTML parser to keep it.
 *
 * `<tr>` only survives in a table, `<td>` only in a row, and so on. The real call sites already
 * satisfy this — they assign to the `<tbody>` they built the rows for — so checks have to as well,
 * or they compare two equally-mangled results and prove nothing.
 */
export function hostTagFor(html: string): string {
  const first = html.trimStart().slice(0, 10).toLowerCase();
  if (first.startsWith('<tr')) return 'tbody';
  if (first.startsWith('<td') || first.startsWith('<th>') || first.startsWith('<th ')) return 'tr';
  if (first.startsWith('<tbody') || first.startsWith('<thead') || first.startsWith('<tfoot'))
    return 'table';
  if (first.startsWith('<option') || first.startsWith('<optgroup')) return 'select';
  return 'div';
}
