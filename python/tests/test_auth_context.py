"""认证上下文的 username 派生规则。

回归点：`username` 只应在 **apikey** 场景被注入 query params（那类日志易部署要求
把 username 作为参数传，避免中文用户名写不进 HTTP header）。

**Basic** 认证必须保持干净：凭据已在 Authorization 头里，而另一类日志易版本
（实测 192.168.43.196）会直接拒绝该参数——
`4104 Parameters 中不支持传入 username`——注入反而把请求打挂。
"""

import base64
import unittest

from rizhiyi_mcp.auth import build_auth_context_from_authorization


def _basic(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


class AuthContextUsernameTestCase(unittest.TestCase):
    def test_apikey_derives_username(self) -> None:
        context = build_auth_context_from_authorization("apikey demo-user:demo-secret")
        self.assertEqual(context.username, "demo-user")
        self.assertEqual(context.headers["Authorization"], "apikey demo-secret")

    def test_apikey_without_username_part(self) -> None:
        context = build_auth_context_from_authorization("apikey demo-secret")
        self.assertIsNone(context.username)

    def test_basic_does_not_derive_username(self) -> None:
        header = _basic("admin", "All#123456")
        context = build_auth_context_from_authorization(header)
        self.assertIsNone(context.username)
        # 身份仍可从凭据里取到（供使用日志使用），只是不进 query params。
        self.assertIsNotNone(context.authorization)
        self.assertEqual(context.authorization.username, "admin")
        self.assertEqual(context.headers["Authorization"], header)

    def test_explicit_username_wins_over_both_schemes(self) -> None:
        self.assertEqual(
            build_auth_context_from_authorization("apikey demo-user:demo-secret", explicit_username="override").username,
            "override",
        )
        self.assertEqual(
            build_auth_context_from_authorization(_basic("admin", "pw"), explicit_username="override").username,
            "override",
        )

    def test_missing_header_keeps_explicit_username(self) -> None:
        context = build_auth_context_from_authorization(None, explicit_username="only")
        self.assertIsNone(context.authorization)
        self.assertEqual(context.username, "only")
        self.assertEqual(context.headers, {})


if __name__ == "__main__":
    unittest.main()
