import { lazy, Suspense, useEffect, useState } from 'react';
import { loadRemote } from 'vite-plugin-federation/runtime';
import './app.css';

const RemoteButton = lazy(() => import('reactRemote/Button'));

export default function App() {
  const [RemoteCard, setRemoteCard] = useState(null);

  useEffect(() => {
    let active = true;

    loadRemote('reactRemote/Card').then((module) => {
      if (!active) return;
      setRemoteCard(() => module.default ?? module);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="host-shell">
      <p style={{ color: '#475569', marginBottom: '0.75rem' }}>Host app</p>
      <h1 style={{ fontSize: '2.3rem', margin: 0 }}>reactHost</h1>
      <p style={{ color: '#64748b', lineHeight: 1.6, maxWidth: '42rem' }}>
        The button below is loaded through static federated import, and the card is loaded through
        the runtime `loadRemote()` API.
      </p>

      <section className="host-grid">
        <article className="host-panel">
          <h2 style={{ marginTop: 0 }}>Static remote import</h2>
          <Suspense fallback={<p>Loading remote button…</p>}>
            <RemoteButton label="Loaded from reactRemote/Button" />
          </Suspense>
        </article>

        <article className="host-panel">
          <h2 style={{ marginTop: 0 }}>Runtime bridge</h2>
          {RemoteCard ? <RemoteCard title="Loaded via loadRemote('reactRemote/Card')" /> : <p>Loading remote card…</p>}
        </article>
      </section>
    </main>
  );
}
