import fs from 'node:fs';

const INSTRUCTIONS_URL = new URL('../../config/log-tools-instructions.txt', import.meta.url);

export function loadLogToolsInstructions(): string {
    try {
        const text = fs.readFileSync(INSTRUCTIONS_URL, 'utf8').trim();
        if (!text) throw new Error('文件为空');
        return text;
    } catch (error: any) {
        throw new Error(`读取 config/log-tools-instructions.txt 失败：${error?.message || error}`);
    }
}
