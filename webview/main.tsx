import { render } from 'preact';
import type { HostToWebview } from '../src/shared/protocol';
import { App } from './components/App';
import { handleHostMessage } from './store';
import { post } from './vscode';

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const data = event.data;
  if (data && typeof data === 'object' && 'type' in data) {
    handleHostMessage(data);
  }
});

const root = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
root.id = 'root';
render(<App />, root);
post({ type: 'ready' });
