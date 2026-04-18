export interface OutputAssetLike {
  type: 'asset';
  fileName: string;
  name?: string | null;
  source?: unknown;
}

export interface OutputChunkLike {
  type: 'chunk';
  fileName: string;
  name?: string | null;
  code?: string;
  modules?: Record<string, unknown>;
  dynamicImports?: string[];
  viteMetadata?: {
    importedCss?: Iterable<string>;
  };
}

export type OutputBundleItemLike = OutputAssetLike | OutputChunkLike;
export type OutputBundleLike = Record<string, OutputBundleItemLike>;
