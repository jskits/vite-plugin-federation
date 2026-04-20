export function AppShell({ RemoteButton, buttonProps }) {
  return (
    <main className="ssr-shell">
      <p className="ssr-kicker">Server Rendering + Federation Runtime</p>
      <h1 className="ssr-title">reactSsrHost</h1>
      <p className="ssr-copy">
        This page renders a federated React component on the server through{' '}
        <code>loadRemoteFromManifest()</code>, injects the remote expose CSS from the manifest, and
        hydrates the exact same remote on the client.
      </p>

      <section className="ssr-grid">
        <article className="ssr-card">
          <h2>Server Path</h2>
          <p>
            The Node runtime resolves <code>mf-manifest.json</code>, selects the SSR-capable entry,
            and renders the remote before HTML is sent to the browser.
          </p>
        </article>

        <article className="ssr-card">
          <h2>Client Path</h2>
          <p>
            The hydration bundle uses the same manifest URL, registers the remote again in the
            browser runtime, and hydrates without changing the rendered output.
          </p>
        </article>
      </section>

      <section className="ssr-card">
        <h2>Remote Component</h2>
        <div className="ssr-remote">
          <RemoteButton {...buttonProps} />
        </div>
      </section>

      <p className="ssr-footnote">
        Default remote manifest URL: <code>http://localhost:4174/mf-manifest.json</code>. Override
        it with <code>REACT_REMOTE_MANIFEST_URL</code> when starting the server.
      </p>
    </main>
  );
}
