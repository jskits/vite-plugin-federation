import sharedValue from '@mf-e2e/shared-value';

export function getSharedReport() {
  return {
    ...sharedValue,
    renderedBy: 'shared-negotiation-remote',
  };
}

export default getSharedReport;
