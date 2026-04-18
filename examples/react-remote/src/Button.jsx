import './Button.css';

export default function Button({ label = 'Remote Button' }) {
  return <button className="remote-button">{label}</button>;
}
