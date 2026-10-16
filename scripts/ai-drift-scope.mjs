import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decides, without any model in the loop, which AI-facing markdown a pull request could have
// invalidated. The drift auditor reads only what lands here, so this file is the difference
// between a focused audit and dumping the whole 1.9 MB knowledge tree into a prompt.
//
// The routing is not invented. The four consumer-facing packages own the skills named for them in
// the table in packages/skills/AGENTS.md, and per-feature knowledge filenames mirror the per-feature
// source directories. `@sodax/types` and `@sodax/swaps-api` ship no skill of their own — that file
// says so — so they route into the SDK skill, which is where their surface is documented. Where a
// name does not line up, SEGMENT_ALIASES records it and the unit tests assert every alias target
// still exists — a rename fails CI instead of silently degrading the audit to package-wide guidance.

export const SKILL_BY_PACKAGE = {
  'packages/sdk': 'sodax-sdk',
  'packages/dapp-kit': 'sodax-dapp-kit',
  'packages/wallet-sdk-core': 'sodax-wallet-sdk-core',
  'packages/wallet-sdk-react': 'sodax-wallet-sdk-react',
  // No skill of their own; their public surface is documented inside the SDK skill.
  'packages/types': 'sodax-sdk',
  'packages/swaps-api': 'sodax-sdk',
  'packages/bridge-api': 'sodax-sdk',
};

// Packages with source but deliberately no skill: their guidance is their own AGENTS.md. Listed
// explicitly so that adding a package forces a routing decision instead of silently getting none.
export const NO_SKILL_PACKAGES = new Set(['packages/libs']);

// Source directory whose children name a feature the knowledge tree documents one file per.
// wallet-sdk-react is deliberately absent: its knowledge splits by connectivity concern
// (connect, wallet-modal, …), which no src/ directory maps onto, so it always audits
// package-wide.
const FEATURE_ROOT = {
  'packages/sdk': 'src',
  'packages/dapp-kit': 'src/hooks',
  'packages/wallet-sdk-core': 'src/wallet-providers',
  'packages/types': 'src',
};

// A package that is itself one feature of the skill it routes into: any change to it belongs to
// that feature, even when the file sits directly in src/.
export const PACKAGE_SEGMENT = {
  'packages/swaps-api': 'swaps-api',
  'packages/bridge-api': 'bridge-api',
};

export const SEGMENT_ALIASES = {
  'sodax-sdk': {
    errors: 'error-codes',
    chains: 'chain-keys',
    backend: 'backend-api',
  },
  'sodax-dapp-kit': {
    mm: 'money-market',
    migrate: 'migration',
    // Small surfaces the knowledge tree groups into one file.
    backend: 'auxiliary-services',
    partner: 'auxiliary-services',
    recovery: 'auxiliary-services',
    sponsoring: 'auxiliary-services',
    'swaps-api': 'auxiliary-services',
    'bridge-api': 'auxiliary-services',
  },
};

// The files that decide what this gate does. claude-code-action validates only the workflow against
// the default branch, so the other three run from the pull request's own HEAD — meaning a change to
// any of them is a change the gate cannot audit honestly. Say so rather than report a clean run.
export const GATE_PATHS = [
  '.github/workflows/ai-drift-check.yml',
  '.github/ai-drift-prompt.md',
  'scripts/ai-drift-scope.mjs',
  'scripts/ai-drift-report.mjs',
];

const KNOWLEDGE_MODES = ['integration', 'migration-v1-to-v2'];

// Knowledge files that carry behavioural claims about a package as a whole. Deliberately not
// README.md / quickstart.md — those are indexes, and auditing them burns context without
// covering a claim the feature files do not already state.
const PACKAGE_WIDE_KNOWLEDGE = ['ai-rules.md', 'architecture.md', 'chain-specifics.md'];

// Third-party skills vendored into .claude/skills/. Not ours to keep in sync with this repo.
const VENDORED_DEV_SKILLS = new Set(['cloudflare', 'resend', 'email-best-practices', 'valibot']);

// Root AGENTS.md describes the package roster, dependency direction, commands and CI shape —
// it only goes stale when one of those moves, or when this gate itself does.
const ROOT_GUIDANCE_TRIGGERS = [
  /^package\.json$/,
  /^turbo\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^\.github\/workflows\//,
  /^\.github\/ai-drift-prompt\.md$/,
  /^scripts\/ai-drift-[a-z-]+\.mjs$/,
  /^(packages|apps)\/[^/]+\/package\.json$/,
];

// Paths a dev skill cites are the paths that skill's procedure depends on, so citation is the
// mapping — no hand-maintained table to rot.
const CITED_PATH = /\b(?:packages|apps|scripts)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:ts|tsx|mjs|json|sh)\b/g;

const PRIORITY = { changed: 0, feature: 1, agents: 2, wide: 3 };
const PRIORITY_ORDER = [PRIORITY.changed, PRIORITY.feature, PRIORITY.agents, PRIORITY.wide];

const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const isSourceFile = path =>
  /^(packages|apps)\/[^/]+\/src\//.test(path) &&
  /\.(ts|tsx)$/.test(path) &&
  !/\.(test|spec)\.tsx?$/.test(path) &&
  !/(^|\/)(e2e-tests|__tests__|__mocks__)\//.test(path);

export const isAiFile = path => {
  if (path === 'AGENTS.md' || path === 'CLAUDE.md') return true;
  if (/^(packages|apps)\/[^/]+\/(AGENTS|CLAUDE)\.md$/.test(path)) return true;
  if (path.startsWith('packages/skills/skills/') && path.endsWith('.md')) return true;

  const devSkill = path.match(/^\.claude\/skills\/([^/]+)\/.+\.md$/);
  return Boolean(devSkill) && !VENDORED_DEV_SKILLS.has(devSkill[1]);
};

const packageOf = path => {
  const match = path.match(/^((?:packages|apps)\/[^/]+)\//);
  return match ? match[1] : null;
};

const walkMarkdown = (root, dir) => {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];

  return readdirSync(absolute).flatMap(name => {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) return walkMarkdown(root, path);
    return name.endsWith('.md') ? [path] : [];
  });
};

// A feature segment is the directory under FEATURE_ROOT that owns the changed file. A file
// sitting directly in that root (index.ts, constants.ts) belongs to no single feature.
const segmentOf = (pkg, skill, path) => {
  if (PACKAGE_SEGMENT[pkg]) return PACKAGE_SEGMENT[pkg];

  const root = FEATURE_ROOT[pkg];
  if (!root || !path.startsWith(`${pkg}/${root}/`)) return null;

  const rest = path.slice(`${pkg}/${root}/`.length);
  if (!rest.includes('/')) return null;

  const segment = kebab(rest.slice(0, rest.indexOf('/')));
  return SEGMENT_ALIASES[skill]?.[segment] ?? segment;
};

export const knowledgeTargets = (exists, skill, segment) => {
  const skillDir = `packages/skills/skills/${skill}`;
  const candidates = [`${skillDir}/${segment}/SKILL.md`];

  for (const mode of KNOWLEDGE_MODES) {
    const knowledge = `${skillDir}/${mode}/knowledge`;
    candidates.push(
      `${knowledge}/features/${segment}.md`,
      `${knowledge}/reference/${segment}.md`,
      `${knowledge}/recipes/${segment}.md`,
    );
  }

  return candidates.filter(exists);
};

const packageWideTargets = (exists, skill) => {
  const skillDir = `packages/skills/skills/${skill}`;
  const candidates = [`${skillDir}/SKILL.md`];

  for (const mode of KNOWLEDGE_MODES) {
    for (const name of PACKAGE_WIDE_KNOWLEDGE) candidates.push(`${skillDir}/${mode}/knowledge/${name}`);
  }

  return candidates.filter(exists);
};

const devSkillGroups = (root, exists, changed) => {
  const base = '.claude/skills';
  if (!existsSync(join(root, base))) return [];

  const skills = readdirSync(join(root, base)).filter(
    name => !VENDORED_DEV_SKILLS.has(name) && statSync(join(root, base, name)).isDirectory(),
  );

  return skills.flatMap(name => {
    const files = walkMarkdown(root, `${base}/${name}`);
    const matched = new Map();

    for (const file of files) {
      const cited = new Set(readFileSync(join(root, file), 'utf8').match(CITED_PATH) ?? []);
      const hits = changed.filter(path => cited.has(path));
      if (hits.length > 0) matched.set(file, hits);
    }

    if (matched.size === 0) return [];

    const skillEntry = `${base}/${name}/SKILL.md`;
    const aiFiles = [...new Set([...(exists(skillEntry) ? [skillEntry] : []), ...matched.keys()])];

    return [
      {
        label: `${base}/${name}`,
        reason: 'dev skill cites a changed source file',
        changed: [...new Set([...matched.values()].flat())].sort(),
        aiFiles,
      },
    ];
  });
};

export const scopeAiDrift = ({ root, changedFiles, maxFiles = 40, maxBytes = 400_000 }) => {
  const exists = path => existsSync(join(root, path));
  const changed = [...new Set(changedFiles)].sort();
  const groups = new Map();

  const addGroup = (label, reason, source, aiFiles) => {
    const group = groups.get(label) ?? { label, reason, changed: [], aiFiles: [] };
    group.changed.push(...source);
    group.aiFiles.push(...aiFiles);
    groups.set(label, group);
  };

  // Forward direction: changed source -> the guidance that describes it. Grouped by package first,
  // so the package-wide fallback is a decision about the package rather than about each file.
  const sourceByPackage = new Map();
  for (const path of changed.filter(isSourceFile)) {
    const pkg = packageOf(path);
    if (!pkg) continue;
    sourceByPackage.set(pkg, [...(sourceByPackage.get(pkg) ?? []), path]);
  }

  for (const [pkg, paths] of sourceByPackage) {
    const agents = exists(`${pkg}/AGENTS.md`) ? [`${pkg}/AGENTS.md`] : [];
    const skill = SKILL_BY_PACKAGE[pkg];

    // A package with no skill still has a guide, and that guide describes the source that just
    // moved. Routing into the knowledge tree is what needs a skill; auditing the guide is not.
    if (!skill) {
      if (agents.length > 0) addGroup(`${pkg}:guide`, `changes under ${pkg}`, paths, agents);
      continue;
    }

    const unowned = [];
    for (const path of paths) {
      const segment = segmentOf(pkg, skill, path);
      const targets = segment ? knowledgeTargets(exists, skill, segment) : [];

      if (segment && targets.length > 0) {
        addGroup(`${pkg}:${segment}`, `changes under ${pkg} feature "${segment}"`, [path], [...targets, ...agents]);
      } else {
        unowned.push(path);
      }
    }

    if (unowned.length === 0) continue;

    // Package-wide knowledge only when nothing in the package resolved to a feature. Otherwise the
    // routine "one feature plus a shared helper" change would drag the whole package's guidance in
    // on top of the feature files, which is what starves the budget on large pull requests.
    if (unowned.length === paths.length) {
      addGroup(`${pkg}:*`, `changes under ${pkg} with no single owning feature`, unowned, [
        ...packageWideTargets(exists, skill),
        ...agents,
      ]);
    } else if (agents.length > 0) {
      addGroup(`${pkg}:guide`, `changes under ${pkg} outside any single feature`, unowned, agents);
    }
  }

  // Reverse direction: an AI file changed, so its claims must still be backed by current source.
  const changedAiFiles = changed.filter(isAiFile).filter(exists);
  if (changedAiFiles.length > 0) {
    addGroup('ai-files-changed', 'AI files edited by this PR', [], changedAiFiles);
  }

  for (const group of devSkillGroups(root, exists, changed)) {
    addGroup(group.label, group.reason, group.changed, group.aiFiles);
  }

  if (changed.some(path => ROOT_GUIDANCE_TRIGGERS.some(pattern => pattern.test(path))) && exists('AGENTS.md')) {
    addGroup('repo-root', 'workspace layout, scripts or CI changed', [], ['AGENTS.md']);
  }

  // Rank within a group: files the PR touched, then feature-specific guidance, then package
  // guidance, then package-wide knowledge.
  const priorityOf = path => {
    if (changedAiFiles.includes(path)) return PRIORITY.changed;
    if (path.endsWith('/AGENTS.md') || path === 'AGENTS.md') return PRIORITY.agents;
    if (PACKAGE_WIDE_KNOWLEDGE.some(name => path.endsWith(`/${name}`))) return PRIORITY.wide;
    if (/^packages\/skills\/skills\/[^/]+\/SKILL\.md$/.test(path)) return PRIORITY.wide;
    return PRIORITY.feature;
  };

  const queues = [...groups.values()].map(group =>
    [...new Set(group.aiFiles)]
      .map(path => ({ path, priority: priorityOf(path), bytes: statSync(join(root, path)).size, taken: false }))
      .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path)),
  );

  const kept = [];
  const keptPaths = new Set();
  const dropped = [];
  const decided = new Set();
  let bytes = 0;
  let full = false;

  // Round-robin across groups, one priority tier at a time. A flat global sort tie-breaks on path
  // and so starves whole packages alphabetically — a change spanning three packages would audit the
  // first one exhaustively and never open a file from the third.
  for (const priority of PRIORITY_ORDER) {
    let progressed = true;
    while (progressed) {
      progressed = false;

      for (const queue of queues) {
        const next = queue.find(entry => entry.priority === priority && !entry.taken);
        if (!next) continue;

        next.taken = true;
        progressed = true;
        if (decided.has(next.path)) continue;
        decided.add(next.path);

        // Once the budget is reached, stop admitting: letting a smaller, less specific file in
        // behind a larger, more specific one that was just refused inverts the whole ranking.
        if (full || kept.length >= maxFiles || bytes + next.bytes > maxBytes) {
          full = true;
          dropped.push(next.path);
          continue;
        }

        kept.push(next.path);
        keptPaths.add(next.path);
        bytes += next.bytes;
      }
    }
  }

  return {
    shouldRun: kept.length > 0,
    // claude-code-action refuses to run when the workflow invoking it differs from the copy on the
    // default branch — otherwise a pull request could rewrite the workflow to exfiltrate its token.
    // The prompt and these scripts get no such protection: they run straight from the pull request's
    // own checkout. So the workflow skips the audit on this flag rather than publishing a verdict the
    // pull request wrote the rules for, and the report step tells that silence apart from an auditor
    // that genuinely broke.
    gateSelfEdited: changed.some(path => GATE_PATHS.includes(path)),
    changedFiles: changed,
    aiFiles: kept,
    dropped,
    bytes,
    groups: [...groups.values()]
      .map(group => {
        const all = [...new Set(group.aiFiles)].sort();
        return {
          label: group.label,
          reason: group.reason,
          changed: [...new Set(group.changed)].sort(),
          aiFiles: all.filter(path => keptPaths.has(path)),
          // Kept in the output on purpose: a starved group that vanishes tells the auditor the
          // package was never touched, which is a different and worse claim than "not audited".
          droppedAiFiles: all.filter(path => !keptPaths.has(path)),
        };
      })
      .filter(group => group.aiFiles.length > 0 || group.droppedAiFiles.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
};

// Both flags the workflow branches on. gate_self_edited is not decoration: the prompt load and the
// audit are skipped on it, so a pull request that edits the gate cannot audit itself. Exporting only
// should_run left that skip unreachable.
export const stepOutputs = scope => `should_run=${scope.shouldRun}\ngate_self_edited=${scope.gateSelfEdited}\n`;

const parseArgs = argv => {
  const args = { base: null, out: 'drift-scope.json' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') args.base = argv[index + 1];
    if (argv[index] === '--out') args.out = argv[index + 1];
  }
  return args;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { base, out } = parseArgs(process.argv.slice(2));

  if (!base) {
    console.error('Usage: node scripts/ai-drift-scope.mjs --base <sha> [--out drift-scope.json]');
    process.exit(2);
  }

  // --no-renames so a moved file reports both paths. Rename detection hides the origin, and the
  // origin is exactly what the stale guidance still describes.
  const diff = execFileSync('git', ['diff', '--no-renames', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  const scope = scopeAiDrift({ root: process.cwd(), changedFiles: diff.split('\n').filter(Boolean) });

  writeFileSync(out, `${JSON.stringify(scope, null, 2)}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, stepOutputs(scope));
  }

  if (!scope.shouldRun) {
    console.log(`No AI files describe the ${scope.changedFiles.length} changed file(s); drift audit not needed.`);
  } else if (scope.gateSelfEdited) {
    console.log('This pull request edits the drift check itself; the audit is skipped. Review the AI files by hand.');
  } else {
    console.log(`Auditing ${scope.aiFiles.length} AI file(s), ${Math.round(scope.bytes / 1024)} KB:\n`);
    for (const group of scope.groups) {
      console.log(`- ${group.label} (${group.reason})`);
      for (const path of group.aiFiles) console.log(`    ${path}`);
      for (const path of group.droppedAiFiles) console.log(`    ${path} (not audited — over budget)`);
    }
    if (scope.dropped.length > 0) {
      // Never silent: a truncated audit that reads as complete is worse than no audit.
      console.log(`\nDropped ${scope.dropped.length} lower-priority file(s) to stay inside the audit budget:`);
      for (const path of scope.dropped) console.log(`    ${path}`);
    }
  }
}
