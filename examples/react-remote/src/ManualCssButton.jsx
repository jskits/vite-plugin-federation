import './ManualCssButton.css';

export default function ManualCssButton({ label = 'Manual CSS Button' }) {
  return <button className="remote-manual-css-button">{label}</button>;
}
