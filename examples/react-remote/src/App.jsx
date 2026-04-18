import Button from './Button';
import Card from './Card';

export default function App() {
  return (
    <main
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: '48rem',
        padding: '3rem 1.25rem',
      }}
    >
      <p style={{ color: '#475569', marginBottom: '0.75rem' }}>Remote preview</p>
      <h1 style={{ fontSize: '2rem', margin: 0 }}>reactRemote</h1>
      <p style={{ color: '#64748b', lineHeight: 1.6 }}>
        This app exposes `./Button` and `./Card` through `mf-manifest.json`.
      </p>
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
        <Button />
        <Card />
      </div>
    </main>
  );
}
