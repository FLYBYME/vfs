
export class GitIgnore {
    private patterns: { regex: RegExp, negative: boolean }[] = [];

    constructor(content: string) {
        this.parse(content);
    }

    private parse(content: string) {
        const lines = content.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;

            let negative = false;
            if (line.startsWith('!')) {
                negative = true;
                line = line.substring(1);
            }

            // Simple glob to regex conversion
            // Escaping implementation omitted for brevity, focusing on common cases
            // 1. Escape special regex characters
            let regexStr = line.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');

            // 2. Handle ** (match any deep)
            regexStr = regexStr.replace(/\\\*\\\*\//g, '(?:.*/)?');
            regexStr = regexStr.replace(/\\\*\\\*/g, '.*');

            // 3. Handle * (match any in path)
            // If it was just *, it became \*
            regexStr = regexStr.replace(/\\\*/g, '[^/]*');

            // 4. Handle ?
            regexStr = regexStr.replace(/\\\?/g, '.');

            // 5. Directory matching
            if (line.endsWith('/')) {
                // node_modules/ -> node_modules/.*
                regexStr += '.*';
            } else {
                // If it doesn't contain a slash (except maybe at end), it matches anywhere
                // e.g. "foo" matches "foo", "a/foo", "a/b/foo"
                // But simplified: let's assume relative to root if it starts with /
                if (!line.startsWith('/')) {
                    // Match anywhere: (?:^|/)pattern(?:$|/)
                    // But for simplicity in VFS, we can assume we check relative paths
                    regexStr = '(?:^|/)' + regexStr + '(?:$|/.*)';
                } else {
                    // Starts with /
                    regexStr = '^' + regexStr.substring(1) + '(?:$|/.*)';
                }
            }

            // Ensure regexStr is valid
            try {
                this.patterns.push({ regex: new RegExp(regexStr), negative });
            } catch (e) {
                console.warn(`Invalid gitignore pattern: ${line}`);
            }
        }
    }

    public ignores(filePath: string): boolean {
        // filePath should be relative to root, e.g. "src/index.ts"
        let ignored = false;

        for (const { regex, negative } of this.patterns) {
            if (regex.test(filePath)) {
                ignored = !negative;
            }
        }
        return ignored;
    }
}
