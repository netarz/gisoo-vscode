import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { QueuedMessage, Todo } from '../../src/shared/protocol';
import { t } from '../strings';
import { post } from '../vscode';
import { AttachmentChip } from './Turns';
import { Button, Icon, IconButton } from './common';

function todoIcon(status: Todo['status']): JSX.Element {
  switch (status) {
    case 'done':
      return <Icon name="pass-filled" class="todo-icon todo-done" />;
    case 'in_progress':
      return <Icon name="loading" spin class="todo-icon todo-progress" />;
    default:
      return <Icon name="circle-large-outline" class="todo-icon todo-pending" />;
  }
}

export function TodoCard({ todos, showStart }: { todos: Todo[]; showStart: boolean }): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false);
  if (!todos.length) {
    return null;
  }
  const done = todos.filter((todo) => todo.status === 'done').length;
  const current = todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status === 'pending');
  return (
    <div class={`todo-card${collapsed ? ' is-collapsed' : ''}`}>
      <div class="todo-head">
        <Icon name="checklist" />
        <span class="todo-title">{t('todo.title')}</span>
        <span class="todo-progress-text">{t('todo.progress', { done, total: todos.length })}</span>
        <span class="todo-bar" aria-hidden="true"><span class="todo-bar-fill" style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }} /></span>
        <IconButton icon={collapsed ? 'chevron-up' : 'chevron-down'} label={collapsed ? t('todo.expand') : t('todo.collapse')} onClick={() => setCollapsed(!collapsed)} />
      </div>
      {collapsed ? (
        current ? <div class="todo-current" dir="auto">{todoIcon(current.status)}<span>{current.content}</span></div> : null
      ) : (
        <ul class="todo-list">
          {todos.map((todo, i) => (
            <li key={i} class={`todo-item todo-${todo.status}`} dir="auto">
              {todoIcon(todo.status)}
              <span>{todo.content}</span>
            </li>
          ))}
        </ul>
      )}
      {showStart ? (
        <div class="todo-actions">
          <Button kind="primary" icon="rocket" onClick={() => post({ type: 'plan.start' })}>{t('todo.startBuilding')}</Button>
        </div>
      ) : null}
    </div>
  );
}

function QueueChip({ item }: { item: QueuedMessage }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const save = () => {
    const value = text.trim();
    if (value && value !== item.text) {
      post({ type: 'queue.edit', id: item.id, text: value });
    }
    setEditing(false);
  };
  if (editing) {
    return (
      <div class="queue-item is-editing">
        <textarea
          class="queue-edit"
          dir="auto"
          rows={2}
          value={text}
          aria-label={t('queue.edit')}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              save();
            } else if (event.key === 'Escape') {
              setText(item.text);
              setEditing(false);
            }
          }}
        />
        <div class="queue-edit-actions">
          <Button kind="primary" onClick={save}>{t('queue.save')}</Button>
          <Button kind="ghost" onClick={() => { setText(item.text); setEditing(false); }}>{t('turn.cancel')}</Button>
        </div>
      </div>
    );
  }
  return (
    <div class="queue-item" title={t('queue.hint')}>
      <Icon name="clock" />
      <span class="queue-text" dir="auto">{item.text}</span>
      {item.attachments.length ? <span class="queue-attachments">{item.attachments.map((attachment, i) => <AttachmentChip key={i} attachment={attachment} />)}</span> : null}
      <IconButton icon="edit" label={t('queue.edit')} onClick={() => { setText(item.text); setEditing(true); }} />
      <IconButton icon="close" label={t('queue.remove')} onClick={() => post({ type: 'queue.remove', id: item.id })} />
    </div>
  );
}

export function QueueChips({ queue }: { queue: QueuedMessage[] }): JSX.Element | null {
  if (!queue.length) {
    return null;
  }
  return (
    <div class="queue" aria-label={t('queue.title')}>
      {queue.map((item) => <QueueChip key={item.id} item={item} />)}
    </div>
  );
}
