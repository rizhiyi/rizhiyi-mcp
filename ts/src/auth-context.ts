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

    // 只从 apikey 的 `user:secret` 里拆分 username：这类部署要求把 username 作为
    // query 参数传（避免中文用户名写不进 HTTP header）。
    //
    // Basic 认证不能这么做——凭据本身就在 Authorization 头里，而另一类日志易版本
    // 会直接拒绝该参数（4104 Parameters 中不支持传入 username），注入反而把请求打挂。
    // 显式传入的 LOGEASE_USERNAME 仍然优先。
    let username = explicitUsername;
    if (!username && authorization.kind === 'apikey') {
        username = authorization.username;
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
