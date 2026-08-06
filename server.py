"""
Local Time MCP Server
=====================
一个用于学习 MCP (Model Context Protocol) 的入门级 Server。
提供本地时间、时区时间、时间格式化、时间差计算等工具。

运行方式：
    python server.py

MCP 通信协议：stdio（标准输入输出）
"""

from mcp.server.fastmcp import FastMCP
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import json

# ============================================================
# 1. 创建 MCP Server 实例
#    FastMCP 是官方提供的高层封装，几行代码就能跑起来
# ============================================================
mcp = FastMCP("local-time-server")


# ============================================================
# 2. 定义 Tool（工具）
#    用 @mcp.tool() 装饰器注册，函数文档字符串会作为工具描述
#    发给 LLM，LLM 根据描述决定何时调用这个工具
# ============================================================

@mcp.tool()
def get_current_time(tz: str = "local") -> str:
    """获取当前时间。

    Args:
        tz: 时区名称。传 "local" 获取本地时间，
            或传 IANA 时区名如 "Asia/Shanghai"、"America/New_York"、"UTC"。
            默认 "local"。

    Returns:
        ISO 8601 格式的时间字符串，附带时区信息。
    """
    if tz == "local" or tz == "":
        now = datetime.now().astimezone()
    else:
        try:
            now = datetime.now(ZoneInfo(tz))
        except Exception:
            return f"错误：无法识别的时区 '{tz}'。示例：Asia/Shanghai, UTC, America/New_York"

    return json.dumps({
        "datetime": now.isoformat(),
        "timezone": str(now.tzinfo),
        "readable": now.strftime("%Y年%m月%d日 %H:%M:%S %Z"),
        "unix_timestamp": int(now.timestamp()),
    }, ensure_ascii=False)


@mcp.tool()
def format_time(
    year: int,
    month: int,
    day: int,
    hour: int = 0,
    minute: int = 0,
    second: int = 0,
    tz: str = "UTC",
    fmt: str = "%Y-%m-%d %H:%M:%S %Z"
) -> str:
    """按指定格式格式化一个时间点。

    Args:
        year: 年，如 2026
        month: 月 (1-12)
        day: 日 (1-31)
        hour: 小时 (0-23)，默认 0
        minute: 分钟 (0-59)，默认 0
        second: 秒 (0-59)，默认 0
        tz: 时区，默认 "UTC"
        fmt: strftime 格式字符串，默认 "%Y-%m-%d %H:%M:%S %Z"

    Returns:
        格式化后的时间字符串。
    """
    try:
        dt = datetime(year, month, day, hour, minute, second, tzinfo=ZoneInfo(tz))
        return dt.strftime(fmt)
    except Exception as e:
        return f"错误：{e}"


@mcp.tool()
def time_diff(
    start: str,
    end: str,
    unit: str = "seconds"
) -> str:
    """计算两个时间点之间的差值。

    Args:
        start: 起始时间，ISO 8601 格式，如 "2026-01-01T00:00:00+08:00"
        end: 结束时间，ISO 8601 格式
        unit: 返回单位，可选 "seconds"（秒）、"minutes"（分钟）、
              "hours"（小时）、"days"（天）。默认 "seconds"。

    Returns:
        时间差值的字符串表示。
    """
    try:
        dt_start = datetime.fromisoformat(start)
        dt_end = datetime.fromisoformat(end)
        delta = dt_end - dt_start
        total_seconds = delta.total_seconds()

        units = {
            "seconds": total_seconds,
            "minutes": total_seconds / 60,
            "hours": total_seconds / 3600,
            "days": total_seconds / 86400,
        }

        if unit not in units:
            return f"错误：不支持的单位 '{unit}'。可选：seconds, minutes, hours, days"

        return json.dumps({
            "start": start,
            "end": end,
            "diff": units[unit],
            "unit": unit,
            "human_readable": str(delta),
        }, ensure_ascii=False)
    except Exception as e:
        return f"错误：{e}"


@mcp.tool()
def list_timezones(region: str = "") -> str:
    """列出可用的时区名称（可按区域筛选）。

    Args:
        region: 区域前缀筛选，如 "Asia"、"America"、"Europe"。
                留空则返回所有时区。

    Returns:
        时区列表的 JSON 字符串。
    """
    import zoneinfo
    all_zones = sorted(zoneinfo.available_timezones())

    if region:
        filtered = [z for z in all_zones if z.startswith(region)]
    else:
        filtered = all_zones

    return json.dumps({
        "total": len(filtered),
        "timezones": filtered[:200],  # 限制返回数量
        "note": f"共 {len(all_zones)} 个时区" + (f"，筛选 '{region}' 后 {len(filtered)} 个" if region else ""),
    }, ensure_ascii=False)


# ============================================================
# 3. 启动 Server
# ============================================================
if __name__ == "__main__":
    # stdio 模式：通过标准输入输出与 MCP Client（如 WorkBuddy）通信
    # 这是本地 MCP Server 最常用的传输方式
    mcp.run()
