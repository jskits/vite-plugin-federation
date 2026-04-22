import { answer, formatAnswer, type FederationAnswer } from 'dtsRemote/answer';

const typedAnswer: FederationAnswer = {
  ...answer,
  score: answer.score + 1,
};

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.textContent = formatAnswer(typedAnswer);
}
