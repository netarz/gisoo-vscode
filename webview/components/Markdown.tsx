import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { renderMarkdown, renderStreamingMarkdown } from '../markdown';
import { post } from '../vscode';

function flashCopied(button: HTMLButtonElement): void {
  const icon = button.querySelector('.codicon');
  if (!icon) {
    return;
  }
  icon.classList.remove('codicon-copy');
  icon.classList.add('codicon-check');
  setTimeout(() => {
    icon.classList.remove('codicon-check');
    icon.classList.add('codicon-copy');
  }, 1200);
}

/** Handles clicks inside rendered markdown: external links and code-block buttons. */
export function onMarkdownClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[data-href], a[href]');
  if (link) {
    event.preventDefault();
    const url = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
    if (url) {
      post({ type: 'link.open', url });
    }
    return;
  }
  const button = target.closest<HTMLButtonElement>('button[data-action]');
  if (!button) {
    return;
  }
  const block = button.closest<HTMLElement>('.code-block');
  const code = block?.querySelector('pre > code')?.textContent ?? '';
  const language = block?.getAttribute('data-lang') || undefined;
  switch (button.dataset.action) {
    case 'copy':
      post({ type: 'code.copy', code });
      flashCopied(button);
      break;
    case 'insert':
      post({ type: 'code.insert', code });
      break;
    case 'newfile':
      post({ type: 'code.newFile', code, language });
      break;
    default:
      break;
  }
}

export function Markdown({ text, streaming, class: cls }: { text: string; streaming?: boolean; class?: string }): JSX.Element {
  const html = useMemo(() => (streaming ? renderStreamingMarkdown(text) : renderMarkdown(text)), [text, streaming]);
  return <div class={`md${cls ? ` ${cls}` : ''}`} dir="auto" dangerouslySetInnerHTML={{ __html: html }} onClick={onMarkdownClick} />;
}
