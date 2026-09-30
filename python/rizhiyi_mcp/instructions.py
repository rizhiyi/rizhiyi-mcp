from pathlib import Path

_INSTRUCTIONS_PATH = Path(__file__).resolve().parents[2] / "config" / "log-tools-instructions.txt"


def load_log_tools_instructions() -> str:
    try:
        text = _INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"读取 config/log-tools-instructions.txt 失败：{exc}") from exc
    if not text:
        raise RuntimeError("读取 config/log-tools-instructions.txt 失败：文件为空")
    return text
