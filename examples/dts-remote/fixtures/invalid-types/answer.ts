export interface FederationAnswer {
  id: string;
  label: string;
  score: number;
}

export const answer: FederationAnswer = {
  id: 'invalid-dts-remote-answer',
  label: 'Invalid federated type-safe answer',
  score: 'not-a-number',
};

export function formatAnswer(value: FederationAnswer): string {
  return `${value.label}: ${value.score}`;
}
