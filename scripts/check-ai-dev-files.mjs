import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];

const read = path => readFileSync(join(root, path), 'utf8');
const exists = path => existsSync(join(root, path));

function fail(message) {
  failures.push(message);
}

function listWorkspaceDirs(base) {
  if (!exists(base)) return [];
  return readdirSync(join(root, base))
    .map(name => `${base}/${name}`)
    .filter(path => statSync(join(root, path)).isDirectory());
}

// docs/ is the published site, so its guidance is gated like a workspace guide even though
// it is neither a package nor an app.
const agentFiles = ['AGENTS.md', 'docs/AGENTS.md'];
const claudeFiles = ['CLAUDE.md'];

for (const dir of [...listWorkspaceDirs('packages'), ...listWorkspaceDirs('apps')]) {
  const agentsPath = `${dir}/AGENTS.md`;
  const claudePath = `${dir}/CLAUDE.md`;
  if (exists(agentsPath) || exists(claudePath)) {
    agentFiles.push(agentsPath);
    claudeFiles.push(claudePath);
  }
}

for (const path of agentFiles) {
  if (!exists(path)) fail(`Missing ${path}`);
}

for (const path of claudeFiles) {
  if (!exists(path)) {
    fail(`Missing ${path}`);
    continue;
  }

  const content = read(path);
  const firstInstruction = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (firstInstruction !== '@AGENTS.md') {
    fail(`${path} must import sibling AGENTS.md as its first non-empty line`);
  }

  const lineCount = content.trimEnd().split(/\r?\n/).length;
  if (lineCount > 10) {
    fail(`${path} should stay a thin Claude shim; found ${lineCount} lines`);
  }
}

const rootAgents = read('AGENTS.md');
const routedGuides = [...rootAgents.matchAll(/\]\(((?:packages|apps)\/[^)]+\/AGENTS\.md)\)/g)].map(match => match[1]);
for (const path of routedGuides) {
  if (!exists(path)) fail(`Root AGENTS.md routes to missing ${path}`);
}

const volatilePatterns = [
  /\bacross\s+\d+\s+blockchains\b/i,
  /\bEVM\s*\(\d+\)/,
  /\bNon-EVM\s*\(\d+\)/,
  /\b\d+\s+chains\b/i,
  /\ball\s+\d+\s+chains\b/i,
  /\bissue\s+#\d+\b/i,
  /\bparent\s+issue\s+#\d+\b/i,
  /#\d+/,
  /\bformerly\b/i,
  /\btoday:\s*\d+/i,
];

function checkVolatile(path, content) {
  for (const pattern of volatilePatterns) {
    if (pattern.test(content)) fail(`${path} contains volatile AI-guidance text matching ${pattern}`);
  }
}

for (const path of agentFiles) {
  if (!exists(path)) continue;
  const content = read(path);
  const lineCount = content.trimEnd().split(/\r?\n/).length;
  const maxLines = path === 'AGENTS.md' ? 150 : 220;
  if (lineCount > maxLines) {
    fail(`${path} is ${lineCount} lines; keep agent guidance under ${maxLines} lines`);
  }
  checkVolatile(path, content);
}

for (const path of routedGuides) {
  const dir = path.slice(0, -'/AGENTS.md'.length);
  const rel = relative(root, join(root, dir, 'CLAUDE.md'));
  if (!exists(rel)) fail(`${path} should have a sibling CLAUDE.md shim`);
}

// Dev skills are the ones our AGENTS.md files point at (.claude/skills/<name>/);
// vendored skills (cloudflare/resend/…) and any skill no AGENTS.md points at aren't referenced, so they're out of this gate.
const sodaxDevSkills = [
  ...new Set(
    agentFiles
      .filter(exists)
      .flatMap(path => [...read(path).matchAll(/\.claude\/skills\/([a-z0-9][a-z0-9-]*)\//g)].map(match => match[1])),
  ),
].sort();
const seenSkillNames = new Map();

for (const skill of sodaxDevSkills) {
  const dir = `.claude/skills/${skill}`;
  const skillPath = `${dir}/SKILL.md`;
  if (!exists(skillPath)) {
    fail(`Missing dev skill ${skillPath}`);
    continue;
  }

  const content = read(skillPath);
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    fail(`${skillPath} is missing YAML frontmatter`);
  } else {
    const block = frontmatter[1];
    const nameMatch = block.match(/^name:\s*(.+?)\s*$/m);
    const name = nameMatch ? nameMatch[1].replace(/^['"]|['"]$/g, '').trim() : '';
    if (!name) fail(`${skillPath} frontmatter is missing 'name'`);
    if (!/^description:\s*\S/m.test(block)) fail(`${skillPath} frontmatter is missing 'description'`);
    else if (!/^description:\s*['"]/m.test(block))
      fail(`${skillPath} frontmatter 'description' must be quoted (it usually contains a colon)`);
    if (name && name !== skill) fail(`${skillPath} frontmatter name '${name}' must match its directory '${skill}'`);
    if (name && seenSkillNames.has(name)) fail(`Duplicate dev skill name '${name}'`);
    if (name) seenSkillNames.set(name, skillPath);
  }

  // Relative .md links (e.g. references/…) must resolve.
  for (const match of content.matchAll(/\]\((?!https?:)([^)#]+\.md)(?:#[^)]*)?\)/g)) {
    if (!existsSync(join(root, dir, match[1]))) fail(`${skillPath} links to missing file ${match[1]}`);
  }

  // Volatile-text ban applies to skill prose too (SKILL.md + references).
  checkVolatile(skillPath, content);
  const refDir = `${dir}/references`;
  if (exists(refDir)) {
    for (const file of readdirSync(join(root, refDir))) {
      if (file.endsWith('.md')) checkVolatile(`${refDir}/${file}`, read(`${refDir}/${file}`));
    }
  }
}

if (failures.length > 0) {
  console.error('AI dev file validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `AI dev file validation passed (${agentFiles.length} AGENTS.md files, ${claudeFiles.length} CLAUDE.md shims, ${sodaxDevSkills.length} dev skills).`,
);
