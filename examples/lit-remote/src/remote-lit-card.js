import { LitElement, css, html } from 'lit';

export class RemoteLitCard extends LitElement {
  static properties = {
    title: { type: String },
  };

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: linear-gradient(145deg, #f5fbff, #ccecff);
      border: 1px solid #90cdf4;
      border-radius: 28px;
      box-shadow: 0 24px 80px rgb(18 88 132 / 18%);
      color: #0b2738;
      max-width: 38rem;
      padding: 1.5rem;
    }

    .mark {
      background: #006f9f;
      border-radius: 999px;
      color: white;
      display: inline-block;
      font-family: Futura, Avenir, sans-serif;
      font-weight: 800;
      margin-bottom: 1rem;
      padding: 0.65rem 0.9rem;
    }

    h2 {
      margin: 0 0 0.5rem;
    }

    p {
      color: #416272;
      line-height: 1.6;
      margin: 0;
    }
  `;

  constructor() {
    super();
    this.title = 'Loaded from litRemote/RemoteLitCard';
  }

  render() {
    return html`
      <article class="card">
        <span class="mark">Lit</span>
        <h2>${this.title}</h2>
        <p>
          Lit custom elements can be shared through manifest-first federation without a framework
          plugin.
        </p>
      </article>
    `;
  }
}

if (!customElements.get('remote-lit-card')) {
  customElements.define('remote-lit-card', RemoteLitCard);
}

export const tagName = 'remote-lit-card';
