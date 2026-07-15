/** Minimal Node declarations used by vite.config.ts.
 * The browser game intentionally does not otherwise depend on Node typings.
 */
declare module 'node:crypto' {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }

  export function createHash(algorithm: 'sha256'): Hash;
}

declare module 'node:fs' {
  interface DirectoryEntry {
    readonly name: string;
    isDirectory(): boolean;
  }

  export function readdirSync(
    path: URL,
    options: { withFileTypes: true },
  ): DirectoryEntry[];
}
