import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { t } from '../strings';

const PREVIEW_LINES = 60;

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'diff-meta';
  }
  if (line.startsWith('@@')) {
    return 'diff-hunk';
  }
  if (line.startsWith('+')) {
    return 'diff-add';
  }
  if (line.startsWith('-')) {
    return 'diff-del';
  }
  if (line.startsWith('\\')) {
    return 'diff-meta';
  }
  return 'diff-ctx';
}

/** A unified diff, coloured per line, collapsed to a preview when long. */
export function DiffView({ diff }: { diff: string }): JSX.Element {
  const lines = useMemo(() => diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'), [diff]);
  const [expanded, setExpanded] = useState(false);
  const truncated = lines.length > PREVIEW_LINES && !expanded;
  const shown = truncated ? lines.slice(0, PREVIEW_LINES) : lines;
  return (
    <div class="diff" dir="ltr">
      <pre class="diff-pre">
        {shown.map((line, i) => (
          <div class={`diff-line ${lineClass(line)}`} key={i}>{line.length ? line : ' '}</div>
        ))}
      </pre>
      {lines.length > PREVIEW_LINES ? (
        <button type="button" class="link-btn diff-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('tool.diffLess') : t('tool.diffMore', { n: lines.length - PREVIEW_LINES })}
        </button>
      ) : null}
    </div>
  );
}
