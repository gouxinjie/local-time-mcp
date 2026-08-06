"""
测试脚本 - 直接调用工具函数，不走 MCP 协议。
用于验证 server.py 中的工具逻辑是否正确。

运行：python test_server.py
"""

# 直接从 server.py 导入工具函数
# （FastMCP 的 @mcp.tool() 装饰器不会改变函数本身的可调用性）
from server import get_current_time, format_time, time_diff, list_timezones


def test_get_current_time():
    print("=" * 60)
    print("[1] get_current_time - 本地时间")
    result = get_current_time()
    print(f"  结果: {result}")
    assert "datetime" in result
    print("  ✓ 通过\n")

    print("[2] get_current_time - 上海时区")
    result = get_current_time(tz="Asia/Shanghai")
    print(f"  结果: {result}")
    assert "Asia/Shanghai" in result
    print("  ✓ 通过\n")

    print("[3] get_current_time - 无效时区")
    result = get_current_time(tz="Mars/Olympus")
    print(f"  结果: {result}")
    assert "错误" in result
    print("  ✓ 通过\n")


def test_format_time():
    print("=" * 60)
    print("[4] format_time - 格式化新年")
    result = format_time(2026, 1, 1, 0, 0, 0, "Asia/Shanghai")
    print(f"  结果: {result}")
    assert "2026" in result
    print("  ✓ 通过\n")

    print("[5] format_time - 自定义格式")
    result = format_time(2026, 8, 6, 8, 28, 0, "UTC", fmt="%Y/%m/%d %H:%M")
    print(f"  结果: {result}")
    assert "2026/08/06" in result
    print("  ✓ 通过\n")


def test_time_diff():
    print("=" * 60)
    print("[6] time_diff - 计算天数差")
    result = time_diff(
        "2026-01-01T00:00:00+08:00",
        "2026-12-31T00:00:00+08:00",
        "days"
    )
    print(f"  结果: {result}")
    assert "diff" in result
    print("  ✓ 通过\n")

    print("[7] time_diff - 计算秒数差")
    result = time_diff(
        "2026-01-01T00:00:00+00:00",
        "2026-01-01T01:00:00+00:00",
        "seconds"
    )
    print(f"  结果: {result}")
    assert "3600" in result
    print("  ✓ 通过\n")


def test_list_timezones():
    print("=" * 60)
    print("[8] list_timezones - 亚洲时区")
    result = list_timezones("Asia")
    print(f"  结果: {result[:200]}...")
    assert "Asia/Shanghai" in result
    print("  ✓ 通过\n")

    print("[9] list_timezones - 所有时区")
    result = list_timezones()
    print(f"  结果: {result[:200]}...")
    assert "total" in result
    print("  ✓ 通过\n")


if __name__ == "__main__":
    print("\n🧪 开始测试 Local Time MCP Server 工具函数\n")
    test_get_current_time()
    test_format_time()
    test_time_diff()
    test_list_timezones()
    print("=" * 60)
    print("✅ 所有测试通过！\n")
    print("下一步：")
    print("  1. 将 mcp_config_example.json 中的配置写入 ~/.workbuddy/mcp.json")
    print("  2. 在 WorkBuddy 连接器管理中信任 local-time")
    print("  3. 在对话中试试：'现在几点了？'")
