import { ParsedAuthorization, parseAuthorizationHeader } from './auth-header.js';

export interface AuthContext {
    authorization?: ParsedAuthorization;
    headers: Record<string, string>;
    username?: string;
}

export function buildAuthContextFromAuthorization(
    authorizationHeader: string | undefined,
    explicitUsername?: string | undefined
): AuthContext {
    if (!authorizationHeader) {
        return {
            headers: {},
            username: explicitUsername
        };
    }

    const authorization = parseAuthorizationHeader(authorizationHeader);

    // 优先用显式传入的 username，否则从 authorization 里提取
    let username = explicitUsername;
    if (!username) {
        if (authorization.kind === 'basic') {
            username = authorization.username;
        } else if (authorization.kind === 'apikey') {
            username = authorization.username;
        }
    }

    return {
        authorization,
        headers: {
            Authorization: authorization.rawAuthorization
        },
        username
    };
}

export function buildAuthContextFromEnv(env: NodeJS.ProcessEnv = process.env): AuthContext {
    const authorizationHeader = env.LOGEASE_AUTH_HEADER
        || (env.LOGEASE_API_KEY ? `apikey ${env.LOGEASE_API_KEY}` : undefined);

    return buildAuthContextFromAuthorization(authorizationHeader, env.LOGEASE_USERNAME);
}
