import { lazy, Suspense, startTransition, useEffect, useState } from 'react';
import { loadRemote, refreshRemote } from 'vite-plugin-federation/runtime';
import './app.css';

const RemoteButton = lazy(() => import('reactRemote/Button'));
const REMOTE_EXPOSE_UPDATE_EVENT = 'vite-plugin-federation:remote-expose-update';
const REMOTE_CARD_ID = 'reactRemote/Card';

export default function App() {
  const [RemoteCard, setRemoteCard] = useState(null);
  const [RemoteButtonOverride, setRemoteButtonOverride] = useState(null);
  const [cardRefreshCount, setCardRefreshCount] = useState(0);
  const [buttonRefreshVersion, setButtonRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;

    const syncRemoteCard = async (incrementRefreshCount = false) => {
      const module = await loadRemote(REMOTE_CARD_ID);
      if (!active) return;

      startTransition(() => {
        setRemoteCard(() => module.default ?? module);
        if (incrementRefreshCount) {
          setCardRefreshCount((count) => count + 1);
        }
      });
    };

    void syncRemoteCard();

    const handleRemoteExposeUpdate = async (event) => {
      const detail = event.detail;

      if (detail?.hostRemote !== 'reactRemote') {
        return;
      }

      if (detail.expose === './Button') {
        await refreshRemote(detail.remoteRequestId || 'reactRemote/Button');
        const buttonModule = await loadRemote(detail.remoteRequestId || 'reactRemote/Button');
        if (!active) return;

        startTransition(() => {
          setRemoteButtonOverride(() => buttonModule.default ?? buttonModule);
          setButtonRefreshVersion((count) => count + 1);
        });
        return;
      }

      if (detail.expose !== './Card') {
        return;
      }

      await refreshRemote(detail.remoteRequestId || REMOTE_CARD_ID);
      await syncRemoteCard(true);
    };

    window.addEventListener(REMOTE_EXPOSE_UPDATE_EVENT, handleRemoteExposeUpdate);

    return () => {
      active = false;
      window.removeEventListener(REMOTE_EXPOSE_UPDATE_EVENT, handleRemoteExposeUpdate);
    };
  }, []);

  return (
    <main className="host-shell">
      <p style={{ color: '#475569', marginBottom: '0.75rem' }}>Host app</p>
      <h1 style={{ fontSize: '2.3rem', margin: 0 }}>reactHost</h1>
      <p style={{ color: '#64748b', lineHeight: 1.6, maxWidth: '42rem' }}>
        The button below is loaded through static federated import, and the card is loaded through
        the runtime `loadRemote()` API. In dev, `./Card` also listens for remote expose updates and
        reloads itself without a full page refresh.
      </p>

      <section className="host-grid">
        <article className="host-panel">
          <h2 style={{ marginTop: 0 }}>Static remote import</h2>
          {RemoteButtonOverride ? (
            <RemoteButtonOverride
              key={buttonRefreshVersion}
              label="Loaded from reactRemote/Button"
            />
          ) : (
            <Suspense fallback={<p>Loading remote button…</p>}>
              <RemoteButton key={buttonRefreshVersion} label="Loaded from reactRemote/Button" />
            </Suspense>
          )}
        </article>

        <article className="host-panel">
          <h2 style={{ marginTop: 0 }}>Runtime bridge</h2>
          <p style={{ color: '#64748b', marginTop: 0 }}>
            Runtime refresh count: <strong>{cardRefreshCount}</strong>
          </p>
          {RemoteCard ? (
            <RemoteCard title="Loaded via loadRemote('reactRemote/Card')" />
          ) : (
            <p>Loading remote card…</p>
          )}
        </article>
      </section>
    </main>
  );
}
