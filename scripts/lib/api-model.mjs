/**
 * Build a model of the public API from the TypeScript sources: every export of each package entry
 * point, its kind, its declaration text and its TSDoc. Used by `scripts/gen-docs.mjs` (the API
 * reference) and by the TSDoc-coverage test.
 */
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The package entry points: import specifier → source file. */
export const ENTRIES = [
  { specifier: '@ultrarouter/sdk', file: 'src/index.ts', slug: 'sdk' },
  { specifier: '@ultrarouter/sdk/context', file: 'src/context.ts', slug: 'context' },
];

function program() {
  const files = ENTRIES.map((e) => join(ROOT, e.file));
  return ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
}

function kindOf(decl) {
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isEnumDeclaration(decl)) return 'enum';
  if (ts.isVariableDeclaration(decl)) return 'const';
  return ts.SyntaxKind[decl.kind];
}

/** The TSDoc text of a declaration (summary + block tags), or ''. */
function docOf(decl) {
  const nodes = ts.getJSDocCommentsAndTags(decl);
  const target = ts.isVariableDeclaration(decl) ? decl.parent.parent : decl;
  const own = ts.getJSDocCommentsAndTags(target);
  const all = nodes.length > 0 ? nodes : own;
  const docs = all.filter((n) => ts.isJSDoc(n));
  const last = docs.at(-1);
  if (last === undefined) return { summary: '', examples: [] };
  const summary =
    typeof last.comment === 'string'
      ? last.comment
      : (ts.getTextOfJSDocComment(last.comment) ?? '');
  const examples = (last.tags ?? [])
    .filter((t) => t.tagName.text === 'example')
    .map((t) =>
      typeof t.comment === 'string' ? t.comment : (ts.getTextOfJSDocComment(t.comment) ?? ''),
    );
  return { summary: summary.trim(), examples };
}

/** Declaration source text without its leading TSDoc and without function bodies. */
function signatureText(decl, sf) {
  const printer = ts.createPrinter({ removeComments: true });
  if (ts.isFunctionDeclaration(decl)) {
    const copy = ts.factory.updateFunctionDeclaration(
      decl,
      decl.modifiers,
      decl.asteriskToken,
      decl.name,
      decl.typeParameters,
      decl.parameters,
      decl.type,
      undefined,
    );
    return printer.printNode(ts.EmitHint.Unspecified, copy, sf).replace(/;$/, '');
  }
  if (ts.isClassDeclaration(decl)) {
    return `class ${decl.name?.text ?? ''}`;
  }
  if (ts.isVariableDeclaration(decl)) {
    const list = decl.parent;
    const keyword = (list.flags & ts.NodeFlags.Const) !== 0 ? 'const' : 'let';
    const typeText = decl.type !== undefined ? decl.type.getText(sf) : undefined;
    if (typeText !== undefined) return `${keyword} ${decl.name.getText(sf)}: ${typeText}`;
    const init = decl.initializer?.getText(sf) ?? '';
    const short = init.length > 200 ? `${init.slice(0, 200).trimEnd()} …` : init;
    return `${keyword} ${decl.name.getText(sf)} = ${short}`;
  }
  return printer.printNode(ts.EmitHint.Unspecified, decl, sf);
}

/** Members of an interface or class: name, signature text, doc. */
function membersOf(decl, sf) {
  const out = [];
  const members = decl.members ?? [];
  for (const m of members) {
    const name = m.name?.getText?.(sf);
    if (name === undefined) {
      if (ts.isIndexSignatureDeclaration(m))
        out.push({
          name: '[key]',
          text: m.getText(sf).replace(/\/\*\*[\s\S]*?\*\/\s*/g, ''),
          doc: docOf(m).summary,
        });
      if (ts.isConstructorDeclaration(m))
        out.push({
          name: 'constructor',
          text: `constructor(${m.parameters.map((p) => p.getText(sf)).join(', ')})`,
          doc: docOf(m).summary,
        });
      continue;
    }
    const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
    if (
      mods.some(
        (x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword,
      )
    )
      continue;
    if (name.startsWith('#')) continue;
    let text;
    if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
      text = `${name}(${m.parameters.map((p) => p.getText(sf)).join(', ')})${m.type ? `: ${m.type.getText(sf)}` : ''}`;
    } else if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
      text = `${mods.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : ''}${name}${m.questionToken ? '?' : ''}: ${m.type ? m.type.getText(sf) : 'unknown'}`;
    } else if (ts.isConstructorDeclaration(m)) {
      text = `constructor(${m.parameters.map((p) => p.getText(sf)).join(', ')})`;
    } else {
      text = m.getText(sf);
    }
    // Overloads: keep every signature, docs from the documented one.
    const doc = docOf(m).summary;
    const prev = out.find((o) => o.name === name);
    if (prev !== undefined) {
      prev.text = `${prev.text}\n${text}`;
      if (prev.doc === '' && doc !== '') prev.doc = doc;
      continue;
    }
    out.push({
      name,
      text: text.replace(/\/\*\*[\s\S]*?\*\/\s*/g, '').replace(/\n\s*/g, ' '),
      doc,
    });
  }
  return out;
}

/**
 * The API model: for each entry, the sorted list of exports.
 * @returns {{ specifier: string, slug: string, exports: { name: string, kind: string, source: string, signature: string, doc: string, examples: string[], members: { name: string, text: string, doc: string }[] }[] }[]}
 */
export function buildApiModel() {
  const prog = program();
  const checker = prog.getTypeChecker();
  return ENTRIES.map((entry) => {
    const sf = prog.getSourceFile(join(ROOT, entry.file));
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    const exports = [];
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
      const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      const decls = target.getDeclarations() ?? [];
      // Prefer the documented declaration (functions with overloads, merged decls).
      const decl = decls.find((d) => docOf(d).summary !== '') ?? decls[0];
      if (decl === undefined) continue;
      const declSf = decl.getSourceFile();
      const { summary, examples } = docOf(decl);
      const name = sym.getName();
      exports.push({
        name,
        kind: name === 'default' ? 'default' : kindOf(decl),
        source: relative(ROOT, declSf.fileName),
        signature: name === 'default' ? 'export default UltraRouter' : signatureText(decl, declSf),
        doc: summary,
        examples,
        members:
          ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl)
            ? membersOf(decl, declSf)
            : [],
      });
    }
    exports.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return { specifier: entry.specifier, slug: entry.slug, exports };
  });
}
