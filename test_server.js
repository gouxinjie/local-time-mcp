/**
 * 测试脚本 - 直接调用 server.js 导出的工具逻辑，不走 MCP 协议。
 * 用于验证 server.js 中的工具逻辑是否正确。
 *
 * 运行：node test_server.js
 */

import {
  isLocalTz,
  assertValidTimezone,
  currentTimeInTimezone,
  formatWallClock,
  timeDiffBetween,
  listTimezones,
} from "./server.js";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

// --- get_current_time ---
console.log("=".repeat(60));
console.log("[1] currentTimeInTimezone - 本地时间");
let r = JSON.parse(currentTimeInTimezone("local"));
check("datetime 存在", "datetime" in r, JSON.stringify(r));
check("timezone == local", r.timezone === "local", r.timezone);

console.log("\n[2] currentTimeInTimezone - 上海时区");
r = JSON.parse(currentTimeInTimezone("Asia/Shanghai"));
check("timezone == Asia/Shanghai", r.timezone === "Asia/Shanghai", r.timezone);
check("utc_offset == +0800", r.utc_offset === "+0800", r.utc_offset);

console.log("\n[3] 非法时区抛错");
try {
  assertValidTimezone("Mars/Olympus");
  check("应抛错", false);
} catch (e) {
  check("抛错并含错误信息", /无法识别的时区/.test(e.message), e.message);
}

// --- format_time ---
console.log("\n" + "=".repeat(60));
console.log("[4] formatWallClock - 上海新年凌晨");
let s = formatWallClock(2026, 1, 1, 0, 0, 0, "Asia/Shanghai", "%Y-%m-%d %H:%M:%S %Z");
check("墙钟时间保持 00:00:00", s.startsWith("2026-01-01 00:00:00"), s);

console.log("\n[5] formatWallClock - 自定义格式");
s = formatWallClock(2026, 8, 6, 8, 28, 0, "UTC", "%Y/%m/%d %H:%M");
check("格式化为 2026/08/06 08:28", s === "2026/08/06 08:28", s);

console.log("\n[5.1] formatWallClock - 非法日期");
try {
  formatWallClock(2026, 2, 30, 0, 0, 0, "UTC", "%Y");
  check("非法日期应抛错", false);
} catch (e) {
  check("非法日期抛错", true);
}

console.log("\n[5.2] formatWallClock - 星期名称 %A / %a");
s = formatWallClock(2026, 8, 6, 8, 28, 0, "UTC", "%A/%a");
check("长名称 %A == Thursday", s === "Thursday/Thu", s);

// --- time_diff ---
console.log("\n" + "=".repeat(60));
console.log("[6] timeDiffBetween - 天数差");
r = JSON.parse(timeDiffBetween("2026-01-01T00:00:00+08:00", "2026-12-31T00:00:00+08:00", "days"));
check("diff 存在", "diff" in r);
check("diff == 364", Math.abs(r.diff - 364) < 1e-6, r.diff);

console.log("\n[7] timeDiffBetween - 秒数差");
r = JSON.parse(timeDiffBetween("2026-01-01T00:00:00+00:00", "2026-01-01T01:00:00+00:00", "seconds"));
check("diff == 3600", r.diff === 3600, r.diff);

console.log("\n[7.1] timeDiffBetween - 无时区(naive)输入");
r = JSON.parse(timeDiffBetween("2026-01-01 00:00:00", "2026-01-02 00:00:00", "hours"));
check("diff == 24", r.diff === 24, r.diff);

console.log("\n[7.1b] timeDiffBetween - 纯日期(naive)按 UTC 处理");
r = JSON.parse(timeDiffBetween("2026-01-01", "2026-01-02", "hours"));
check("纯日期 diff == 24", r.diff === 24, r.diff);

console.log("\n[7.2] timeDiffBetween - 非法时间格式");
try {
  timeDiffBetween("not-a-time", "2026-01-01T00:00:00+08:00", "seconds");
  check("应抛错", false);
} catch (e) {
  check("抛错含提示", /ISO 8601/.test(e.message), e.message);
}

console.log("\n[7.3] timeDiffBetween - 不支持的单位");
try {
  timeDiffBetween("2026-01-01T00:00:00+00:00", "2026-01-01T01:00:00+00:00", "weeks");
  check("应抛错", false);
} catch (e) {
  check("抛错含可选单位", /seconds, minutes, hours, days/.test(e.message), e.message);
}

// --- list_timezones ---
console.log("\n" + "=".repeat(60));
console.log("[8] listTimezones - 亚洲时区");
r = JSON.parse(listTimezones("Asia"));
check("包含 Asia/Shanghai", r.timezones.includes("Asia/Shanghai"));

console.log("\n[9] listTimezones - 所有时区");
r = JSON.parse(listTimezones());
check("total_matched > 0", r.total_matched > 0, r.total_matched);
check("note 含数量说明", /本次返回/.test(r.note));

// --- 总结 ---
console.log("\n" + "=".repeat(60));
console.log(`✅ ${passed} 项通过，${failed} 项失败`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n全部测试通过！");
  console.log("下一步：");
  console.log("  1. 将 mcp_config_example.json 中的配置写入 ~/.workbuddy/mcp.json");
  console.log("  2. 在 WorkBuddy 连接器管理中信任 local-time");
  console.log("  3. 在对话中试试：'现在几点了？'");
}
