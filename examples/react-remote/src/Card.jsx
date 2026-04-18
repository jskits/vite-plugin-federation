export default function Card({ title = 'Runtime remote component' }) {
  return (
    <section
      style={{
        border: '1px solid #cbd5e1',
        borderRadius: '16px',
        padding: '1rem',
        background: '#f8fafc',
      }}
    >
      <strong>{title}</strong>
      <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>
        Loaded through the runtime bridge API.
      </p>
    </section>
  );
}
