/**
 * Consented Graphify install (SPEC-phase2 §9): asks once per workspace according to
 * `gisoo.graphify.autoInstall`, then runs `uv tool install graphifyy` / `pipx install graphifyy` /
 * `python -m pip install --user graphifyy` as a visible VS Code task, in that order, until one succeeds.
 * Only in a trusted workspace. On failure the command to run by hand is shown.
 */
import * as vscode from 'vscode';
import { getSettings } from '../config';
import { hostStr, type HostStringKey } from '../ui/strings';
import { detectGraphify, detectPython, installPlans, planCommand, type GraphifyDetection, type InstallPlan } from './detect';

const ASKED_KEY = 'gisoo.graph.installAsked';

const t = (key: HostStringKey, ...args: Array<string | number>): string => hostStr(getSettings().language, key, ...args);

export type ConsentResult = 'yes' | 'no' | 'never';

/** One notification: install / not now / never ask. "Never" writes the setting. */
export async function askInstallConsent(context: vscode.ExtensionContext): Promise<ConsentResult> {
  const mode = getSettings().graphifyAutoInstall;
  if (mode === 'never') return 'never';
  if (mode === 'always') return 'yes';
  if (context.workspaceState.get<boolean>(ASKED_KEY)) return 'no';
  await context.workspaceState.update(ASKED_KEY, true);
  const choice = await vscode.window.showInformationMessage(t('host.graph.installPrompt'), t('host.graph.install'), t('host.graph.notNow'), t('host.graph.never'));
  if (choice === t('host.graph.install')) return 'yes';
  if (choice === t('host.graph.never')) {
    await vscode.workspace.getConfiguration('gisoo').update('graphify.autoInstall', 'never', vscode.ConfigurationTarget.Global);
    return 'never';
  }
  return 'no';
}

/** Runs one install plan as a visible terminal task and resolves with its exit code. */
export async function runInstallTask(plan: InstallPlan, cwd: string): Promise<number | undefined> {
  const task = new vscode.Task({ type: 'gisoo' }, vscode.TaskScope.Workspace, `${t('host.graph.taskName')} (${plan.kind})`, 'Gisoo', new vscode.ProcessExecution(plan.file, plan.args, { cwd, env: { PYTHONUTF8: '1', NO_COLOR: '1' } }));
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true, focus: false, echo: true };
  task.isBackground = false;
  const execution = await vscode.tasks.executeTask(task);
  return new Promise<number | undefined>((resolve) => {
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) {
        sub.dispose();
        resolve(e.exitCode);
      }
    });
  });
}

/**
 * Installs (or upgrades) Graphify after consent was given. Returns the detection on success.
 * Shows the manual command when every installer failed.
 */
export async function installGraphify(cwd: string, upgrade = false): Promise<GraphifyDetection | undefined> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(t('host.graph.untrusted'));
    return undefined;
  }
  const python = await detectPython();
  const plans = await installPlans(upgrade, python);
  if (!plans.length) {
    void vscode.window.showWarningMessage(t('host.graph.noPython'));
    return undefined;
  }
  for (const plan of plans) {
    const code = await runInstallTask(plan, cwd);
    if (code === 0) {
      const found = await detectGraphify(cwd);
      if (found) {
        void vscode.window.showInformationMessage(t('host.graph.installed', found.version));
        return found;
      }
    }
  }
  void vscode.window.showErrorMessage(t('host.graph.installFailed', planCommand(plans[0])));
  return undefined;
}
