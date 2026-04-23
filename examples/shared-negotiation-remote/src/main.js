import { getSharedReport } from './Widget';

const app = document.getElementById('app');
const report = getSharedReport();

app.innerHTML = `
  <h1>Shared negotiation remote</h1>
  <p data-testid="remote-preview">${report.origin}@${report.version}</p>
`;
