export interface FederationAnswer {
  id: string;
  label: string;
  score: number;
}

export const answer: FederationAnswer = {
  id: 'dts-remote-answer',
  label: 'Federated type-safe answer',
  score: 42,
};

export function formatAnswer(value: FederationAnswer): string {
  return `${value.label}: ${value.score}`;
}
