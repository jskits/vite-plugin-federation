import { describe, expect, it } from 'vitest';
import {
  isFederationControlChunk,
  sanitizeFederationControlChunk,
  stripEmptyPreloadCalls,
  stripLoadSharePreloadHelperCalls,
} from '../controlChunkSanitizer';

describe('controlChunkSanitizer', () => {
  it('strips minified preload helpers and loadShare side-effect imports', () => {
    const code =
      'import{_ as or}from"./assets/TreeLoader-KqsPzsXB.js";' +
      'import"./assets/reproApp__loadShare__react__loadShare__.mjs-DOStu9DH.js";' +
      'async function load(){return or(()=>import("./assets/localSharedImportMap.js"),[],import.meta.url)}';

    expect(stripEmptyPreloadCalls(code)).toBe(
      'async function load(){return import("./assets/localSharedImportMap.js")}',
    );
  });

  it('removes remoteEntry side-effect imports from localSharedImportMap chunks', () => {
    const code =
      'import "../remoteEntry.js";' + 'import "./other.js";' + 'export const usedShared = {};';

    expect(
      sanitizeFederationControlChunk(code, 'assets/localSharedImportMap-abc.js', 'remoteEntry.js'),
    ).toBe('import "./other.js";export const usedShared = {};');
  });

  it('preserves preload helpers with non-empty dependency arrays', () => {
    const code =
      'import{_ as o}from"./preload-helper-BDBacUwf.js";' +
      'const n={' +
      '"@byte/api":async()=>await import("./index-DaqjAZdf.js"),' +
      '"@byte/ui":async()=>await o(()=>import("./index-Bc0YS1wt.js"),__vite__mapDeps([0]),import.meta.url),' +
      '"@byte/user-session":async()=>await o(()=>import("./index-BV4s8wZv.js"),[],import.meta.url),' +
      '"react":async()=>await import("./index-DlZQ-_sN.js")' +
      '}';

    const result = stripEmptyPreloadCalls(code);

    expect(result).toContain(
      '"@byte/ui":async()=>await o(()=>import("./index-Bc0YS1wt.js"),__vite__mapDeps([0]),import.meta.url)',
    );

    expect(result).toContain('"@byte/user-session":async()=>await import("./index-BV4s8wZv.js")');

    expect(result).not.toMatch(/await import\([^)]+\),__vite__mapDeps/);
  });

  it('does not break when only non-empty preload helpers exist', () => {
    const code =
      'import{_ as o}from"./preload-helper.js";' +
      'const n={' +
      '"@byte/ui":async()=>await o(()=>import("./ui.js"),__vite__mapDeps([0]),import.meta.url)' +
      '}';

    const result = stripEmptyPreloadCalls(code);

    expect(result).toContain('o(()=>import("./ui.js"),__vite__mapDeps([0]),import.meta.url)');
  });

  it('strips empty preload helpers emitted by Vite 8 control chunks', () => {
    const code =
      'import{t as preload}from"./preload-helper-abc.js";' +
      'async function getMap(){return preload(()=>import("./localSharedImportMap.js"),[])}' +
      'async function getExposes(){return __vitePreload(()=>import("./virtualExposes.js"),[])}';

    expect(stripEmptyPreloadCalls(code)).toBe(
      'async function getMap(){return import("./localSharedImportMap.js")}' +
        'async function getExposes(){return import("./virtualExposes.js")}',
    );
  });

  it('inlines preload helpers imported from loadShare chunks in control chunks', () => {
    const code =
      'import{n as initRuntime}from"./dist.js";' +
      'import{i as preload}from"./remote__loadShare__shared__loadShare__.mjs-Abc.js";' +
      'async function getLocalSharedImportMap(){return preload(()=>import("./localSharedImportMap.js"),__vite__mapDeps([0,1,2]))}' +
      'export{getLocalSharedImportMap}';

    expect(
      sanitizeFederationControlChunk(code, 'assets/remoteEntry-abc.js', 'remoteEntry.js'),
    ).toBe(
      'import{n as initRuntime}from"./dist.js";' +
        'async function getLocalSharedImportMap(){return import("./localSharedImportMap.js")}' +
        'export{getLocalSharedImportMap}',
    );
  });

  it('removes only loadShare imports that are used as preload helpers', () => {
    const code =
      'import{r as preload,t as sharedValue}from"./remote__loadShare__shared__loadShare__.mjs-Abc.js";' +
      'async function loadEntry(url,resolve){return preload(()=>import(url).then(resolve),[])}' +
      'function getShared(){return sharedValue}';

    expect(stripLoadSharePreloadHelperCalls(code)).toBe(
      'import{t as sharedValue}from"./remote__loadShare__shared__loadShare__.mjs-Abc.js";' +
        'async function loadEntry(url,resolve){return import(url).then(resolve)}' +
        'function getShared(){return sharedValue}',
    );
  });

  it('does not rewrite unrelated callbacks that contain a short preload alias suffix', () => {
    const code =
      'import{r as e}from"./remote__loadShare__shared__loadShare__.mjs-Abc.js";' +
      'async function ce(callback){return callback()}' +
      'async function loadEntry(url,resolve,reject){return e(()=>import(url).then(resolve),[]).catch(reject)}' +
      'const cleanup=ce(()=>{return 1})' +
      'function fallback(e){return Promise.resolve(()=>e)}';

    expect(stripLoadSharePreloadHelperCalls(code)).toBe(
      'async function ce(callback){return callback()}' +
        'async function loadEntry(url,resolve,reject){return import(url).then(resolve).catch(reject)}' +
        'const cleanup=ce(()=>{return 1})' +
        'function fallback(e){return Promise.resolve(()=>e)}',
    );
  });

  it('ignores empty preload-shaped callbacks that are not dynamic imports', () => {
    const code =
      'import{t as preload}from"./preload-helper-abc.js";' +
      'const result=preload(()=>({ value: 1 }),[])';

    expect(stripEmptyPreloadCalls(code)).toBe(code);
  });

  it('detects federation control chunks', () => {
    expect(isFederationControlChunk('remoteEntry.js', 'remoteEntry.js')).toBe(true);
    expect(
      isFederationControlChunk(
        'assets/virtual_mf-REMOTE_ENTRY_ID___app__remoteEntry-_hash_-abc.js',
        'remoteEntry-[hash].js',
      ),
    ).toBe(true);
    expect(isFederationControlChunk('assets/hostInit-abc.js', 'remoteEntry.js')).toBe(true);
    expect(isFederationControlChunk('assets/localSharedImportMap-abc.js', 'remoteEntry.js')).toBe(
      true,
    );
    expect(isFederationControlChunk('assets/app-abc.js', 'remoteEntry.js')).toBe(false);
  });
});
