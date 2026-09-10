export type ParsedAuthorization =
    | {
          kind: 'apikey';
          rawAuthorization: string;
          apiKeyPreview: string;
          username?: string;
      }
    | {
          kind: 'basic';
          rawAuthorization: string;
          username: string;
      }
    | {
          kind: 'bearer';
          rawAuthorization: string;
          tokenPreview: string;
          username?: string;
      };

function maskValue(value: string): string {
    if (value.length <= 6) {
        return `${value.slice(0, 2)}***`;
    }

    return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function parseBasicAuthorization(rawAuthorization: string, encodedCredentials: string): ParsedAuthorization {
    let decoded = '';

    try {
        decoded = Buffer.from(encodedCredentials, 'base64').toString('utf8');
    } catch {
        throw new Error('Basic Auth 编码无效。');
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
        throw new Error('Basic Auth 缺少 user:password 结构。');
    }

    const username = decoded.slice(0, separatorIndex).trim();
    const password = decoded.slice(separatorIndex + 1);
    if (!username || !password) {
        throw new Error('Basic Auth 需要同时包含用户名和密码。');
    }

    return {
        kind: 'basic',
        rawAuthorization,
        username
    };
}

function parseApiKeyAuthorization(rawAuthorization: string, apiKey: string): ParsedAuthorization {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
        throw new Error('apikey 认证缺少 key。');
    }

    // 尝试拆分 username:secret 格式。冒号之后的 secret 不能包含冒号，
    // 但 username 可以包含中文等非 ASCII 字符。
    let username: string | undefined;
    let secretValue = normalizedApiKey;
    const separatorIndex = normalizedApiKey.indexOf(':');
    if (separatorIndex > 0) {
        const parsedUser = normalizedApiKey.slice(0, separatorIndex).trim();
        username = parsedUser || undefined;
        secretValue = normalizedApiKey.slice(separatorIndex + 1).trim();
        if (!secretValue) {
            throw new Error('apikey 认证缺少 secret 部分。');
        }
    }

    // header 里只放 secret（避免中文 username 无法写入 HTTP header）
    const rewritten = `apikey ${secretValue}`;

    return {
        kind: 'apikey',
        rawAuthorization: rewritten,
        apiKeyPreview: maskValue(secretValue),
        username
    };
}

function parseBearerAuthorization(rawAuthorization: string, token: string): ParsedAuthorization {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
        throw new Error('Bearer Auth 缺少 access_token。');
    }
    // Bearer 只放 token（原始 Authorization 已经是 Bearer xxx）；username 由后端 OAuth introspect 过程填充。
    return {
        kind: 'bearer',
        rawAuthorization,
        tokenPreview: maskValue(normalizedToken),
        username: undefined,
    };
}

export function parseAuthorizationHeader(authorizationHeader: string | undefined): ParsedAuthorization {
    const rawAuthorization = authorizationHeader?.trim();
    if (!rawAuthorization) {
        throw new Error('缺少 Authorization 请求头。');
    }

    const firstSpaceIndex = rawAuthorization.indexOf(' ');
    if (firstSpaceIndex <= 0) {
        throw new Error('Authorization 格式无效。');
    }

    const scheme = rawAuthorization.slice(0, firstSpaceIndex).trim().toLowerCase();
    const credentials = rawAuthorization.slice(firstSpaceIndex + 1).trim();

    if (scheme === 'apikey') {
        return parseApiKeyAuthorization(rawAuthorization, credentials);
    }

    if (scheme === 'basic') {
        return parseBasicAuthorization(rawAuthorization, credentials);
    }

    if (scheme === 'bearer') {
        return parseBearerAuthorization(rawAuthorization, credentials);
    }

    throw new Error('仅支持 apikey、Basic、Bearer 三种 Authorization 格式。');
}

export function describeAuthorization(auth: ParsedAuthorization): string {
    if (auth.kind === 'basic') {
        return `basic:${auth.username}`;
    }
    if (auth.kind === 'bearer') {
        const userPart = auth.username ? `${auth.username}:` : '';
        return `bearer:${userPart}${auth.tokenPreview}`;
    }

    const userPart = auth.username ? `${auth.username}:` : '';
    return `apikey:${userPart}${auth.apiKeyPreview}`;
}
