import { getWorkspaceSharedReport } from './Widget.js';

const app = document.getElementById('app');
const report = getWorkspaceSharedReport();

app.innerHTML = `
  <main>
    <h1>Workspace shared remote</h1>
    <p data-testid="remote-preview">${report.packageName}@${report.version}</p>
  </main>
`;
