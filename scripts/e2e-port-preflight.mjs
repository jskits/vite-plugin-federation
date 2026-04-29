import net from 'node:net';
import { getE2ePort } from '../examples/e2ePorts.mjs';

const portKeys = process.argv.slice(2);
if (portKeys.length === 0) {
  throw new Error('Usage: node scripts/e2e-port-preflight.mjs REACT_REMOTE [OTHER_PORT_KEY...]');
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

const blocked = [];
for (const key of portKeys) {
  const port = getE2ePort(key);
  const ipv4Free = await canListen(port, '127.0.0.1');
  const ipv6Free = await canListen(port, '::1');
  if (!ipv4Free || !ipv6Free) {
    blocked.push({ key, port });
  }
}

if (blocked.length > 0) {
  const details = blocked
    .map(({ key, port }) => `${key} uses ${port}; override with MF_E2E_${key}_PORT=<free-port>`)
    .join('\n');
  throw new Error(`E2E port preflight failed:\n${details}`);
}
