import { resolve } from 'path';
import { pathToFileURL } from 'url';

export function isExecutedDirectly(importMetaUrl: string): boolean {
    const entryPath = process.argv[1];
    if (!entryPath) {
        return false;
    }

    return pathToFileURL(resolve(entryPath)).href === importMetaUrl;
}
