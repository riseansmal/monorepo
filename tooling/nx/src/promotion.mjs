import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseAllDocuments } from 'yaml';
import { projectArtifacts, rebuildableArtifacts } from './metadata.mjs';
const artifactNames = new Set(rebuildableArtifacts);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inside = (file, root) => file === root || file.startsWith(`${root}/`);
export function assertOwnedPath(tree, relative) {
  let current = '';
  for (const part of relative.split('/')) {
    current = current ? `${current}/${part}` : part;
    try {
      if (fs.lstatSync(path.join(tree.root, current)).isSymbolicLink())
        throw new Error(`Unsafe project path symlink: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export function promotionFiles(tree, root, discardGenerated = false) {
  const files = [],
    artifacts = [];
  const walk = (dir) => {
    const disk = path.join(tree.root, dir);
    if (fs.existsSync(disk) && fs.lstatSync(disk).isSymbolicLink())
      throw new Error(`Unsafe promotion symlink: ${dir}`);
    const entries = new Set([
      ...tree.children(dir),
      ...(fs.existsSync(disk) ? fs.readdirSync(disk) : []),
    ]);
    for (const name of entries) {
      const file = `${dir}/${name}`,
        real = path.join(tree.root, file);
      // lstat detects dangling symlinks too; never follow any source link.
      let actual = null;
      try {
        actual = fs.lstatSync(real);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (actual?.isSymbolicLink())
        throw new Error(`Unsafe promotion symlink: ${file}`);
      if (
        dir === root &&
        projectArtifacts.includes(name) &&
        !artifactNames.has(name)
      )
        throw new Error(
          `Local artifact store must be moved explicitly; promotion never discards it: ${file}`,
        );
      if (dir === root && artifactNames.has(name)) {
        artifacts.push(file);
        continue;
      }
      if (actual?.isDirectory() || tree.children(file).length) walk(file);
      else if (tree.exists(file)) files.push(file);
      else if (actual)
        throw new Error(
          `Unmanaged file must be moved explicitly before promotion: ${file}`,
        );
    }
  };
  walk(root);
  if (artifacts.length && !discardGenerated)
    throw new Error(
      `Generated artifacts at ${artifacts.join(', ')}. Use --discard-generated to remove these rebuildable project-root outputs after promotion.`,
    );
  return { files, artifacts };
}
export function finishPromotion(root, oldRoot, artifacts) {
  for (const file of artifacts)
    fs.rmSync(path.join(root, file), { recursive: true, force: true });
  const empty = (dir) => {
    if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory()) empty(path.join(dir, entry.name));
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  };
  empty(path.join(root, oldRoot));
}
export function rewriter(old, next, oldPackage, newPackage) {
  const mapPath = (value) =>
    inside(value, old.root) ? next.root + value.slice(old.root.length) : value;
  const mapPackage = (value) =>
    oldPackage && (value === oldPackage || value.startsWith(`${oldPackage}/`))
      ? newPackage + value.slice(oldPackage.length)
      : value;
  const pathText = (text) =>
    text.replace(
      new RegExp(
        `(?<![a-zA-Z0-9_./-])${esc(old.root)}(?=$|[/\\s'"\x60:;,)\\]])`,
        'g',
      ),
      next.root,
    );
  const command = (text) => {
    let updated = pathText(text);
    if (oldPackage)
      updated = updated.replace(
        new RegExp(
          `(pnpm\\s+--filter(?:=|\\s+))${esc(oldPackage)}(?=\\s|$)`,
          'g',
        ),
        `$1${newPackage}`,
      );
    return updated
      .replace(
        new RegExp(
          `((?:\\bnx|tooling/scripts/nx\\.mjs)\\s+run\\s+)${esc(old.name)}(?=:)`,
          'g',
        ),
        `$1${next.id}`,
      )
      .replace(
        new RegExp(
          `(tooling/scripts/deploy\\.mjs\\s+)${esc(old.name)}(?=\\s|$)`,
          'g',
        ),
        `$1${next.id}`,
      );
  };
  function json(value, file, local, key = '') {
    if (Array.isArray(value))
      return value.map((v) => json(v, file, local, key));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const name = [
          'dependencies',
          'devDependencies',
          'peerDependencies',
          'optionalDependencies',
        ].includes(key)
          ? mapPackage(k)
          : k;
        if (name !== k && Object.hasOwn(value, name))
          throw new Error(`Dependency identity collision: ${name} in ${file}`);
        out[name] =
          key === 'scripts' && typeof v === 'string'
            ? command(v)
            : json(v, file, local, k);
      }
      return out;
    }
    if (typeof value !== 'string') return value;
    if (['command', 'commands', 'run'].includes(key))
      return command(
        local
          ? value.replaceAll(
              path.posix.relative(old.root, '.') + '/tooling/',
              next.up + '/tooling/',
            )
          : value,
      );
    if (key === 'implicitDependencies' && value === old.name) return next.id;
    if (key === 'dependsOn' && value.startsWith(`${old.name}:`))
      return next.id + value.slice(old.name.length);
    if (['root', 'sourceRoot', 'outputs', 'inputs', 'references'].includes(key))
      return mapPath(value);
    if (['cwd', 'path'].includes(key) && inside(value, old.root))
      return mapPath(value);
    if (key === 'cwd' && value === '.') return value;
    if (
      local &&
      ['$schema', 'extends', 'cwd', 'path'].includes(key) &&
      value.startsWith('.')
    ) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), value),
      );
      const target = mapPath(resolved);
      let relative = path.posix.relative(
        path.posix.dirname(mapPath(file)),
        target,
      );
      if (!relative.startsWith('.')) relative = './' + relative;
      return relative;
    }
    if (
      local &&
      key === 'name' &&
      file.endsWith('/package.json') &&
      value === oldPackage
    )
      return newPackage;
    return value;
  }
  function code(text, file) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const edits = [];
    const walk = (n) => {
      if (ts.isStringLiteralLike(n)) {
        const p = n.parent;
        const imported =
          ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) &&
            p.moduleSpecifier === n) ||
          (ts.isCallExpression(p) &&
            (p.expression.kind === ts.SyntaxKind.ImportKeyword ||
              p.expression.getText(ast) === 'require') &&
            p.arguments[0] === n);
        let updated = n.text;
        if (imported) {
          updated = mapPackage(updated);
          if (updated.startsWith('.')) {
            const target = mapPath(
              path.posix.normalize(
                path.posix.join(path.posix.dirname(file), updated),
              ),
            );
            updated = path.posix.relative(
              path.posix.dirname(mapPath(file)),
              target,
            );
            if (!updated.startsWith('.')) updated = './' + updated;
          }
        }
        if (updated !== n.text)
          edits.push({
            start: n.getStart(ast) + 1,
            end: n.getEnd() - 1,
            text: updated,
          });
      }
      ts.forEachChild(n, walk);
    };
    walk(ast);
    for (const e of edits.sort((a, b) => b.start - a.start))
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
    return text;
  }
  function lock(text) {
    const docs = parseAllDocuments(text);
    let changed = false;
    for (const doc of docs) {
      if (doc.errors.length)
        throw new Error('Cannot promote malformed lockfile');
      const importers = doc.get('importers');
      if (!importers) continue;
      if (importers.has(old.root)) {
        if (importers.has(next.root))
          throw new Error('Lockfile importer collision');
        const importer = importers.get(old.root);
        importers.delete(old.root);
        importers.set(next.root, importer);
        changed = true;
      }
      for (const pair of importers.items) {
        const importerRoot = String(pair.key.value ?? pair.key);
        const priorRoot = importerRoot === next.root ? old.root : importerRoot;
        for (const section of [
          'dependencies',
          'devDependencies',
          'optionalDependencies',
        ]) {
          const deps = pair.value.get(section);
          if (!deps) continue;
          for (const dep of deps.items) {
            if (dep.key.value === oldPackage) {
              if (newPackage !== oldPackage && deps.has(newPackage))
                throw new Error(`Lockfile dependency collision: ${newPackage}`);
              dep.key.value = newPackage;
              changed = true;
            }
            const version = dep.value.get('version');
            if (typeof version === 'string' && version.startsWith('link:')) {
              const target = mapPath(
                path.posix.normalize(
                  path.posix.join(priorRoot, version.slice(5)),
                ),
              );
              const repaired =
                'link:' + path.posix.relative(importerRoot, target);
              if (repaired !== version) {
                dep.value.set('version', repaired);
                changed = true;
              }
            }
          }
        }
      }
    }
    return changed ? docs.map((d) => d.toString()).join('') : text;
  }
  function rewrite(text, file) {
    const local = inside(file, old.root);
    if (file === 'pnpm-lock.yaml') return lock(text);
    if (file.endsWith('.json')) {
      const original = JSON.parse(text),
        updated = json(original, file, local);
      return JSON.stringify(original) === JSON.stringify(updated)
        ? text
        : JSON.stringify(updated, null, 2) + '\n';
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) return code(text, file);
    if (/\.ya?ml$/.test(file)) {
      const docs = parseAllDocuments(text);
      let changed = false;
      for (const doc of docs) {
        if (doc.errors.length) throw new Error(`Invalid YAML: ${file}`);
        const visit = (node, keys = []) => {
          if (!node || typeof node !== 'object') return;
          if (typeof node.value === 'string') {
            const prev = node.value;
            if (keys.at(-1) === 'run') node.value = command(prev);
            if (
              file === '.github/workflows/deploy.yml' &&
              keys.includes('project') &&
              (keys.includes('options') || keys.at(-1) === 'default') &&
              prev === old.name
            )
              node.value = next.id;
            if (local && keys.at(-1) === 'extend')
              node.value = json(prev, file, true, 'extends');
            if (prev !== node.value) changed = true;
          }
          for (const item of node.items ?? []) {
            if (item.key) visit(item.value, [...keys, String(item.key.value)]);
            else visit(item, keys);
          }
        };
        visit(doc.contents);
      }
      return changed ? docs.map((d) => d.toString()).join('') : text;
    }
    if (path.posix.basename(file) === 'Dockerfile') return command(text);
    if (file.endsWith('.md')) {
      let result = command(text);
      if (local)
        result = pathText(result).replace(
          `identity: ${old.name}.`,
          `identity: ${next.id}.`,
        );
      return result;
    }
    if (local && file.endsWith('.toml'))
      return text.replace(
        new RegExp(
          `(extend\\s*=\\s*")${esc(path.posix.relative(old.root, '.'))}/tooling/`,
          'g',
        ),
        `$1${next.up}/tooling/`,
      );
    return text;
  }
  return { rewrite, mapPath };
}
