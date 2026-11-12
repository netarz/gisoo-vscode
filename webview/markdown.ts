/**
 * Markdown -> safe HTML for assistant text.
 *
 * marked produces the HTML, highlight.js colours fenced code, DOMPurify strips anything the CSP
 * would refuse anyway (scripts, inline styles, event handlers). Links and code-block buttons carry
 * `data-*` attributes and are wired up by event delegation in the Markdown component.
 */
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import php from 'highlight.js/lib/languages/php';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import powershell from 'highlight.js/lib/languages/powershell';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import { t } from './strings';

const languages: Record<string, unknown> = {
  typescript, javascript, json, python, php, go, rust, java, kotlin, csharp, cpp, c, bash, shell,
  powershell, sql, css, scss, xml, yaml, markdown, diff, dockerfile,
};
for (const [name, def] of Object.entries(languages)) {
  hljs.registerLanguage(name, def as Parameters<typeof hljs.registerLanguage>[1]);
}
hljs.registerAliases(['ts', 'tsx', 'mts', 'cts'], { languageName: 'typescript' });
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['html', 'vue', 'svelte', 'blade', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['ps1', 'pwsh'], { languageName: 'powershell' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['rs'], { languageName: 'rust' });
hljs.registerAliases(['kt'], { languageName: 'kotlin' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });
hljs.registerAliases(['c++', 'cc', 'hpp', 'h'], { languageName: 'cpp' });
hljs.registerAliases(['docker'], { languageName: 'dockerfile' });
hljs.registerAliases(['patch'], { languageName: 'diff' });

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseLang(lang: string | undefined): string {
  const first = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
  return first;
}

export function highlight(code: string, lang: string | undefined): { html: string; language: string } {
  const name = normaliseLang(lang);
  if (name && hljs.getLanguage(name)) {
    try {
      return { html: hljs.highlight(code, { language: name, ignoreIllegals: true }).value, language: name };
    } catch {
      // fall through to plain text
    }
  }
  return { html: escapeHtml(code), language: name };
}

function iconButton(action: string, icon: string, label: string): string {
  return `<button type="button" class="code-btn" data-action="${action}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><span class="codicon codicon-${icon}" aria-hidden="true"></span></button>`;
}

export function codeBlockHtml(code: string, lang: string | undefined): string {
  const { html, language } = highlight(code, lang);
  const label = language ? escapeHtml(language) : '';
  return (
    `<div class="code-block" data-lang="${label}" dir="ltr">` +
    `<div class="code-head"><span class="code-lang">${label}</span><span class="code-actions">` +
    iconButton('copy', 'copy', t('code.copy')) +
    iconButton('insert', 'insert', t('code.insert')) +
    iconButton('newfile', 'new-file', t('code.newFile')) +
    `</span></div>` +
    `<pre><code class="hljs${language ? ` language-${label}` : ''}">${html}</code></pre></div>`
  );
}

const renderer = {
  code({ text, lang }: Tokens.Code): string {
    return codeBlockHtml(text, lang);
  },
  link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, { href, title, tokens }: Tokens.Link): string {
    const inner = this.parser.parseInline(tokens as Tokens.Generic[]);
    const safeHref = /^(https?:|mailto:|vscode:)/i.test(href) ? href : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    if (!safeHref) {
      return inner;
    }
    return `<a href="${escapeHtml(safeHref)}" data-href="${escapeHtml(safeHref)}"${titleAttr}>${inner}</a>`;
  },
  image({ href, text }: Tokens.Image): string {
    // Only data URIs may render (no network requests from the webview); everything else is a link.
    if (/^data:image\//i.test(href)) {
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">`;
    }
    return `<a href="${escapeHtml(href)}" data-href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`;
  },
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    // Raw HTML from the model is shown as text, never interpreted.
    return escapeHtml(text);
  },
};

const md = new Marked({ gfm: true, breaks: false, renderer: renderer as never });

const purifyConfig: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'video', 'audio', 'link', 'meta'],
  FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload', 'target'],
  ADD_ATTR: ['data-action', 'data-href', 'data-lang', 'dir'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|vscode):|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
};

/** Render markdown to sanitised HTML. */
export function renderMarkdown(source: string): string {
  let html: string;
  try {
    html = md.parse(source, { async: false }) as string;
  } catch {
    html = `<p>${escapeHtml(source)}</p>`;
  }
  return DOMPurify.sanitize(html, purifyConfig) as string;
}

/**
 * While streaming, an unterminated fence would swallow the rest of the text as code. Close it so
 * the partial block still renders as code; the final text re-renders correctly.
 */
export function renderStreamingMarkdown(source: string): string {
  const fences = source.match(/^\s{0,3}(```|~~~)/gm);
  if (fences && fences.length % 2 === 1) {
    return renderMarkdown(`${source}\n${fences[fences.length - 1].trim()}`);
  }
  return renderMarkdown(source);
}
