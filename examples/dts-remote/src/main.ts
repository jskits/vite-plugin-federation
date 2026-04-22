import { answer, formatAnswer } from './answer';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.textContent = formatAnswer(answer);
}
