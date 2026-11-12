/**
 * "Gisoo: Install skill" (SPEC-phase2 §7): pick a source (known repo, GitHub URL, local folder or
 * archive), pick the scope, download/copy and scan, show the result and ask for a modal
 * confirmation (twice when the scan has high findings), then install. Nothing is executed.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { getSettings } from '../config';
import { primaryRoot } from '../tools/workspace';
import { hostStr, type HostStringKey } from '../ui/strings';
import {
  cleanupStaged,
  describeStaged,
  fetchArchiveSource,
  installStagedSkill,
  KNOWN_SKILL_REPOS,
  makeTempRoot,
  parseSkillSource,
  projectSkillsDir,
  SkillInstallError,
  skillCandidates,
  stageEntries,
  stageFolder,
  stripTopFolder,
  targetExists,
  userSkillsDir,
  type SkillSourceSpec,
  type StagedSkill,
} from './install';
import { formatBytes, formatFindings } from './scan';

const t = (key: HostStringKey, ...args: Array<string | number>): string => hostStr(getSettings().language, key, ...args);

export interface InstallSkillResult {
  name: string;
  dir: string;
  scope: 'user' | 'project';
}

/** @param sourceText Optional source typed after `/skills install`; otherwise the user is asked. */
export async function installSkillCommand(sourceText?: string): Promise<InstallSkillResult | undefined> {
  const source = sourceText?.trim() ? parseSkillSource(sourceText, (p) => fs.existsSync(p)) : await pickSource();
  if (!source) {
    if (sourceText?.trim()) void vscode.window.showErrorMessage(t('host.skill.badSource', sourceText.trim()));
    return undefined;
  }
  const scope = await pickScope();
  if (!scope) return undefined;
  const skillsDir = scope === 'project' ? projectSkillsDir(primaryRoot() as string) : userSkillsDir(os.homedir());

  let staged: StagedSkill | undefined;
  try {
    staged = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('host.skill.fetching', source.label), cancellable: true }, (_progress, token) =>
      stage(source, token),
    );
    if (!staged) return undefined;
    if (staged.scan.refused) {
      await vscode.window.showErrorMessage(t('host.skill.refused', staged.name, staged.scan.refused), { modal: true });
      return undefined;
    }
    const detail = describeForUser(staged, scope, skillsDir);
    const install = t('host.skill.install');
    const first = await vscode.window.showWarningMessage(t('host.skill.confirmTitle', staged.name), { modal: true, detail }, install);
    if (first !== install) return undefined;
    if (staged.scan.high) {
      const highLines = formatFindings({ ...staged.scan, findings: staged.scan.findings.filter((f) => f.level === 'high') }, 10).join('\n');
      const anyway = t('host.skill.installAnyway');
      const second = await vscode.window.showWarningMessage(t('host.skill.highTitle', staged.name), { modal: true, detail: `${t('host.skill.highDetail')}\n\n${highLines}` }, anyway);
      if (second !== anyway) return undefined;
    }
    let replace = false;
    if (await targetExists(skillsDir, staged.name)) {
      const yes = t('host.skill.replace');
      const choice = await vscode.window.showWarningMessage(t('host.skill.exists', staged.name), { modal: true }, yes);
      if (choice !== yes) return undefined;
      replace = true;
    }
    const containRoot = scope === 'project' ? (primaryRoot() as string) : undefined;
    const record = await installStagedSkill(staged, { skillsDir, scope, replace, homeDir: os.homedir(), containRoot });
    void vscode.window.showInformationMessage(t('host.skill.installed', record.name, record.dir));
    return { name: record.name, dir: record.dir, scope };
  } catch (error) {
    if (error instanceof SkillInstallError && error.reason === 'outside') {
      void vscode.window.showErrorMessage(t('host.skills.unsafeTarget'));
      return undefined;
    }
    const message = error instanceof SkillInstallError ? error.message : error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(t('host.skill.failed', message));
    return undefined;
  } finally {
    await cleanupStaged(staged);
  }
}

async function pickSource(): Promise<SkillSourceSpec | undefined> {
  type Item = vscode.QuickPickItem & { pick: () => Promise<SkillSourceSpec | undefined> };
  const items: Item[] = [
    ...KNOWN_SKILL_REPOS.map((r) => ({
      label: `$(github) ${r.id}`,
      description: r.description,
      pick: async () => {
        const sub = await vscode.window.showInputBox({ title: t('host.skill.subpathTitle', r.id), prompt: t('host.skill.subpathPrompt'), ignoreFocusOut: true });
        if (sub === undefined) return undefined;
        return parseSkillSource(sub.trim() ? `https://github.com/${r.owner}/${r.repo}/tree/HEAD/${sub.trim().replace(/^\/+/, '')}` : `https://github.com/${r.owner}/${r.repo}`);
      },
    })),
    {
      label: `$(link) ${t('host.skill.fromUrl')}`,
      description: 'https://github.com/<owner>/<repo>[/tree/<ref>/<path>]',
      pick: async () => {
        const url = await vscode.window.showInputBox({
          title: t('host.skill.urlTitle'),
          prompt: t('host.skill.urlPrompt'),
          placeHolder: 'https://github.com/anthropics/skills/tree/main/skills/docx',
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim() && !parseSkillSource(v) ? t('host.skill.badSource', v.trim()) : undefined),
        });
        return url?.trim() ? parseSkillSource(url) : undefined;
      },
    },
    {
      label: `$(folder) ${t('host.skill.fromFolder')}`,
      pick: async () => {
        const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: t('host.skill.fromFolder') });
        return picked?.[0] ? { kind: 'folder', path: picked[0].fsPath, label: picked[0].fsPath } : undefined;
      },
    },
    {
      label: `$(file-zip) ${t('host.skill.fromArchive')}`,
      pick: async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          title: t('host.skill.fromArchive'),
          filters: { Archives: ['zip', 'skill', 'tgz', 'gz', 'tar'] },
        });
        return picked?.[0] ? { kind: 'archive', path: picked[0].fsPath, label: picked[0].fsPath } : undefined;
      },
    },
  ];
  const chosen = await vscode.window.showQuickPick(items, { title: t('host.skill.sourceTitle'), placeHolder: t('host.skill.sourcePlaceholder') });
  return chosen?.pick();
}

async function pickScope(): Promise<'user' | 'project' | undefined> {
  type Item = vscode.QuickPickItem & { scope: 'user' | 'project' };
  const items: Item[] = [{ label: `$(account) ${t('host.skill.scopeUser')}`, description: userSkillsDir(os.homedir()), scope: 'user' }];
  const root = primaryRoot();
  if (root && vscode.workspace.isTrusted) items.push({ label: `$(root-folder) ${t('host.skill.scopeProject')}`, description: projectSkillsDir(root), scope: 'project' });
  else if (root) items.push({ label: `$(root-folder) ${t('host.skill.scopeProject')}`, description: t('host.skill.scopeUntrusted'), scope: 'project' });
  const chosen = await vscode.window.showQuickPick(items, { title: t('host.skill.scopeTitle') });
  if (!chosen) return undefined;
  if (chosen.scope === 'project' && !vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(t('host.skill.scopeUntrusted'));
    return undefined;
  }
  return chosen.scope;
}

/** Download/copy into a temp folder, pick the skill folder, scan. */
async function stage(source: SkillSourceSpec, token: vscode.CancellationToken): Promise<StagedSkill | undefined> {
  const tempRoot = await makeTempRoot();
  const abort = new AbortController();
  const sub = token.onCancellationRequested(() => abort.abort());
  try {
    let dir: string;
    let commit: string | undefined;
    if (source.kind === 'folder') {
      dir = await stageFolder(source.path, tempRoot);
    } else {
      const fetched = await fetchArchiveSource(source, { signal: abort.signal });
      if (token.isCancellationRequested) return undefined;
      const candidates = skillCandidates(fetched.entries, source.kind === 'github' ? source.subpath : undefined);
      if (!candidates.length) throw new SkillInstallError(t('host.skill.noSkillMd'), 'source');
      let prefix = candidates[0];
      if (candidates.length > 1) {
        const picked = await vscode.window.showQuickPick(
          candidates.map((c) => ({ label: stripTopFolder(c, fetched.entries) || '/', prefix: c })),
          { title: t('host.skill.pickSkill'), placeHolder: t('host.skill.pickSkillPlaceholder', candidates.length) },
        );
        if (!picked) return undefined;
        prefix = picked.prefix;
      }
      dir = await stageEntries(fetched.entries, prefix, tempRoot);
      commit = fetched.commit;
    }
    return await describeStaged(dir, tempRoot, source.label, commit);
  } catch (error) {
    await cleanupStaged({ tempRoot });
    throw error;
  } finally {
    sub.dispose();
  }
}

function describeForUser(staged: StagedSkill, scope: 'user' | 'project', skillsDir: string): string {
  const lines = [
    `${t('host.skill.name')}: ${staged.name}`,
    `${t('host.skill.description')}: ${staged.description || '-'}`,
    `${t('host.skill.source')}: ${staged.source}${staged.commit ? ` (${staged.commit.slice(0, 12)})` : ''}`,
    `${t('host.skill.size')}: ${staged.files.length} ${t('host.skill.filesWord')}, ${formatBytes(staged.bytes)}`,
    `${t('host.skill.target')}: ${skillsDir} (${scope === 'user' ? t('host.skill.scopeUser') : t('host.skill.scopeProject')})`,
    '',
    `${t('host.skill.files')}:`,
    ...staged.files.slice(0, 15).map((f) => `  ${f}`),
    staged.files.length > 15 ? `  ... ${staged.files.length - 15}` : '',
    '',
    `${t('host.skill.findings')}:`,
    ...(staged.scan.findings.length ? formatFindings(staged.scan, 12).map((l) => `  ${l}`) : [`  ${t('host.skill.noFindings')}`]),
    '',
    t('host.skill.neverRuns'),
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
  return lines.join('\n');
}
