import type { walk as estreeWalk } from 'estree-walker';

type Walk = typeof estreeWalk;

let walkPromise: Promise<Walk> | null = null;

export function loadWalk(): Promise<Walk> {
  walkPromise ||= import('estree-walker').then(({ walk }) => walk);
  return walkPromise;
}
