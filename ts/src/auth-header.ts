export type ParsedAuthorization =
    | {
          kind: 'apikey';
          rawAuthorization: string;
          apiKeyPreview: string;
      }
    | {
          kind: 'basic';
          rawAuthorization: string;
          username: string;
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

    return {
        kind: 'apikey',
        rawAuthorization,
        apiKeyPreview: maskValue(normalizedApiKey)
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

    throw new Error('仅支持 apikey 和 Basic 两种 Authorization 格式。');
}

export function describeAuthorization(auth: ParsedAuthorization): string {
    if (auth.kind === 'basic') {
        return `basic:${auth.username}`;
    }

    return `apikey:${auth.apiKeyPreview}`;
}
