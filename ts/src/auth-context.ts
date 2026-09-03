import { ParsedAuthorization, parseAuthorizationHeader } from './auth-header.js';

export interface AuthContext {
    authorization?: ParsedAuthorization;
    headers: Record<string, string>;
}

export function buildAuthContextFromAuthorization(authorizationHeader: string | undefined): AuthContext {
    if (!authorizationHeader) {
        return {
            headers: {}
        };
    }

    const authorization = parseAuthorizationHeader(authorizationHeader);
    return {
        authorization,
        headers: {
            Authorization: authorization.rawAuthorization
        }
    };
}

export function buildAuthContextFromEnv(env: NodeJS.ProcessEnv = process.env): AuthContext {
    const authorizationHeader = env.LOGEASE_AUTH_HEADER
        || (env.LOGEASE_API_KEY ? `apikey ${env.LOGEASE_API_KEY}` : undefined);

    return buildAuthContextFromAuthorization(authorizationHeader);
}
