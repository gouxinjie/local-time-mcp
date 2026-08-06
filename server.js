#!/usr/bin/env node

/**
 * Local Time MCP Server (Node.js)
 * ===============================
 * 一个用于学习 MCP (Model Context Protocol) 的入门级 Server（Node 版本）。
 * 提供本地时间、时区时间、时间格式化、时间差计算等工具。
 *
 * 运行方式：
 *     node server.js
 *
 * MCP 通信协议：stdio（标准输入输出）
 *
 * 依赖：@modelcontextprotocol/sdk（见 package.json）
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ============================================================
// 辅助函数
// ============================================================

/**
 * 是否由本模块作为入口直接运行（供测试脚本复用内部函数）。
 * 用 import.meta.url 与 process.argv[1] 比对，并做 realpath 归一化，
 * 避免因 macOS 符号链接（npm bin 软链）或 Windows 路径差异导致误判。
 */
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    const entry = realpathSync(process.argv[1]);
    const self = realpathSync(fileURLToPath(import.meta.url));
    return entry === self;
  } catch {
    return false;
  }
})();

/** 判断传入的时区参数是否表示“本地时间”。 */
function isLocalTz(tz) {
  return tz === undefined || tz === null || String(tz).trim() === "" || String(tz).trim().toLowerCase() === "local";
}

/** 返回统一的结构化错误对象（与正常返回区分）。 */
function errorObj(message) {
  return JSON.stringify({ error: message }, null, 0);
}

/** 校验时区是否合法；非法时抛错。 */
function assertValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(
      `无法识别的时区 '${tz}'。示例：Asia/Shanghai, UTC, America/New_York`
    );
  }
}

/** 格式化当前时刻（返回 JSON 字符串），tz 为空表示本地时间。 */
function currentTimeInTimezone(tz) {
  const local = isLocalTz(tz);
  const timeZone = local ? undefined : String(tz).trim();

  const now = new Date();
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // 手动拼出可读时间（避免不同环境分隔符差异）
  const p = fmt.formatToParts(now);
  const part = (t) => p.find((x) => x.type === t)?.value ?? "";
  const readable = `${part("year")}年${part("month")}月${part("day")}日 ${part("hour")}:${part("minute")}:${part("second")}`;

  const offsetFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const offsetParts = offsetFmt.formatToParts(now);
  const offset = offsetParts.find((x) => x.type === "timeZoneName")?.value || "";
  const utcOffset = offsetToISO(offset);

  return JSON.stringify({
    datetime: now.toISOString(),
    timezone: local ? "local" : String(tz).trim(),
    utc_offset: utcOffset,
    readable,
    unix_timestamp: Math.floor(now.getTime() / 1000),
  });
}

/**
 * 将 Intl 返回的 offset 字符串（如 "GMT+08:00"、"GMT-05:00"、"GMT"）
 * 规范为 ISO 风格，如 "+0800" / "-0500" / "Z"。
 */
function offsetToISO(offset) {
  if (!offset || offset === "GMT") return "+0000";
  const m = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!m) return "+0000";
  return `${m[1]}${m[2]}${m[3]}`;
}

/** 校验年月日时分秒是否在合法范围内，非法抛错。 */
function assertValidDateParts(year, month, day, hour, minute, second) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error("year 必须是 1-9999 的整数");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("month 必须是 1-12 的整数");
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("day 必须是 1-31 的整数");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("hour 必须是 0-23 的整数");
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("minute 必须是 0-59 的整数");
  if (!Number.isInteger(second) || second < 0 || second > 59) throw new Error("second 必须是 0-59 的整数");

  // 校验月与日的组合（如 2 月 30 日应视为非法）
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error("日期非法：当月没有该日");
  }
}

/**
 * 构造指定时区某个“墙钟时间”对应的 Date。
 * 思路：先把墙钟时间当作 UTC 构造一个近似时刻，再计算该时刻在目标时区
 * 显示的墙钟与目标墙钟的差值，用这个差值校正近似时刻，迭代几次即收敛。
 * 对 DST（夏令时）也能正确处理，因为每次都读取真实时区偏移。
 */
function wallClockToDate(year, month, day, hour, minute, second, timeZone) {
  assertValidDateParts(year, month, day, hour, minute, second);
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute, second);

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // 返回某 Date 在目标时区显示的“墙钟毫秒”(当作 UTC 处理)
  const wallMsOf = (d) => {
    const p = dtf.formatToParts(d);
    const g = (t) => p.find((x) => x.type === t)?.value ?? "";
    return Date.UTC(+g("year"), +g("month") - 1, +g("day"), +g("hour"), +g("minute"), +g("second"));
  };

  let approx = targetWallMs; // 第一次近似：假设偏移为 0
  for (let i = 0; i < 5; i++) {
    const cand = new Date(approx);
    const wall = wallMsOf(cand);
    const diff = wall - targetWallMs;
    approx = cand.getTime() - diff;
    if (Math.abs(diff) < 1000) return new Date(approx);
  }
  throw new Error("无法构造该时区的时间，请检查参数是否合法");
}

/** 格式化一个墙钟时间点（返回字符串）。 */
function formatWallClock(year, month, day, hour, minute, second, tz, fmt) {
  const local = isLocalTz(tz);
  assertValidDateParts(year, month, day, hour, minute, second);
  let date;
  if (local) {
    // 本地时间：直接把年月日时分秒当作本地墙钟时间
    date = new Date(year, month - 1, day, hour, minute, second);
  } else {
    const timeZone = String(tz).trim();
    assertValidTimezone(timeZone);
    date = wallClockToDate(year, month, day, hour, minute, second, timeZone);
  }
  return strftime(date, fmt, local ? undefined : String(tz).trim());
}

/**
 * 简易 strftime：支持 %Y %m %d %H %M %S %Z %z %A %a %B %b %%
 * 其余未知指令原样保留。
 */
function strftime(date, fmt, timeZone) {
  const opts = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
    monthName: "long",
    timeZone,
  };
  const dtf = new Intl.DateTimeFormat("en-US", opts);
  const parts = dtf.formatToParts(date);
  const part = (t) => parts.find((x) => x.type === t)?.value ?? "";

  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");
  const weekday = part("weekday");
  const monthLong = part("monthName");

  // 星期几的缩写（如 "Mon"），直接交给 Intl 生成，避免手写映射表。
  // 与 %A 的"长名称"（如 "Monday"）分开获取，互不依赖。
  const weekdayShort =
    new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).formatToParts(date).find(
      (x) => x.type === "weekday"
    )?.value ?? "";

  // 时区缩写与偏移
  let tzAbbr = "";
  let tzOffset = "";
  if (timeZone) {
    const tzFmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    });
    tzAbbr = tzFmt.formatToParts(date).find((x) => x.type === "timeZoneName")?.value || "";
    const offFmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const off = offFmt.formatToParts(date).find((x) => x.type === "timeZoneName")?.value || "";
    tzOffset = offsetToISO(off);
  } else {
    const tzAbbrFmt = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" });
    tzAbbr = tzAbbrFmt.formatToParts(date).find((x) => x.type === "timeZoneName")?.value || "";
    const offFmt = new Intl.DateTimeFormat("en-US", { timeZoneName: "longOffset" });
    const off = offFmt.formatToParts(date).find((x) => x.type === "timeZoneName")?.value || "";
    tzOffset = offsetToISO(off);
  }

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const monthIndex = Number(month) - 1;
  const monthName = monthNames[monthIndex] || monthLong;

  // 用占位符避免误替换，再逐项替换
  let out = fmt;
  const map = {
    "%%": "%",
    "%Y": year,
    "%y": String(year).slice(-2),
    "%m": month,
    "%d": day,
    "%H": hour,
    "%M": minute,
    "%S": second,
    "%A": weekday,
    "%a": weekdayShort,
    "%B": monthName,
    "%b": monthName.slice(0, 3),
    "%Z": tzAbbr,
    "%z": tzOffset,
  };
  // 先替换 %%，避免二次替换问题
  out = out.split("%%").join("\u0000");
  for (const [k, v] of Object.entries(map)) {
    if (k === "%%") continue;
    out = out.split(k).join(v);
  }
  return out.split("\u0000").join("%");
}

/**
 * 将输入解析为 UTC 毫秒时间戳。
 * - 带时区的 ISO 8601（如 '2026-01-01T00:00:00+08:00'）：按实际偏移解析；
 * - 不带时区的输入（如 '2026-01-01' 或 '2026-01-01 00:00:00'）：统一按 UTC 解析，
 *   避免因运行机器本机时区不同导致结果不一致。
 */
function parseTimeInput(s) {
  const str = String(s).trim();
  // 纯日期（YYYY-MM-DD）或日期+时间但无时区/偏移 → 视为 UTC，补 Z
  const naiveDate = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const naiveDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str);
  const input = naiveDate || naiveDateTime ? `${str}Z` : str;

  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `时间格式非法：'${s}'，请使用 ISO 8601 格式，如 '2026-01-01T00:00:00+08:00'`
    );
  }
  return d.getTime();
}

/** 计算两个时间差，支持带/不带时区。 */
function timeDiffBetween(start, end, unit) {
  const s = parseTimeInput(start);
  const e = parseTimeInput(end);
  const totalMs = e - s;
  const totalSeconds = totalMs / 1000;

  const units = {
    seconds: totalSeconds,
    minutes: totalSeconds / 60,
    hours: totalSeconds / 3600,
    days: totalSeconds / 86400,
  };
  if (!(unit in units)) {
    throw new Error(`不支持的单位 '${unit}'。可选：seconds, minutes, hours, days`);
  }

  // 人类可读描述
  const sign = totalMs < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const d = Math.floor(abs / 86400);
  const h = Math.floor((abs % 86400) / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = Math.floor(abs % 60);
  let human;
  if (d > 0) human = `${sign}${d} days, ${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  else human = `${sign}${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;

  return JSON.stringify({
    start,
    end,
    diff: units[unit],
    unit,
    human_readable: human,
  });
}

// ============================================================
// 1. 创建 MCP Server 实例
// ============================================================
const server = new McpServer({ name: "local-time-server", version: "1.0.4" });

// ============================================================
// 2. 注册 Tool
// ============================================================

server.tool(
  "get_current_time",
  "获取当前时间。传 'local' 获取本地时间，或传 IANA 时区名如 'Asia/Shanghai'、'America/New_York'、'UTC'。返回 ISO 8601 时间、时区、偏移、可读时间和 Unix 时间戳。",
  {
    tz: z.string().optional().describe("时区名称，默认 'local'"),
  },
  async ({ tz }) => {
    try {
      if (!isLocalTz(tz)) assertValidTimezone(String(tz).trim());
      return { content: [{ type: "text", text: currentTimeInTimezone(tz) }] };
    } catch (e) {
      return { content: [{ type: "text", text: errorObj(e.message) }] };
    }
  }
);

server.tool(
  "format_time",
  "按指定格式格式化一个时间点。year/month/day 必填，hour/minute/second/tz/fmt 可省略。",
  {
    year: z.number().int().describe("年，如 2026"),
    month: z.number().int().describe("月 (1-12)"),
    day: z.number().int().describe("日 (1-31)"),
    hour: z.number().int().optional().default(0).describe("小时 (0-23)，默认 0"),
    minute: z.number().int().optional().default(0).describe("分钟 (0-59)，默认 0"),
    second: z.number().int().optional().default(0).describe("秒 (0-59)，默认 0"),
    tz: z.string().optional().default("UTC").describe("时区，默认 'UTC'"),
    fmt: z.string().optional().default("%Y-%m-%d %H:%M:%S %Z").describe("strftime 格式字符串"),
  },
  async (args) => {
    const { year, month, day, hour = 0, minute = 0, second = 0, tz = "UTC", fmt = "%Y-%m-%d %H:%M:%S %Z" } = args;
    try {
      const out = formatWallClock(year, month, day, hour, minute, second, tz, fmt);
      return { content: [{ type: "text", text: out }] };
    } catch (e) {
      return { content: [{ type: "text", text: errorObj(e.message) }] };
    }
  }
);

server.tool(
  "time_diff",
  "计算两个 ISO 8601 时间点之间的差值，可按单位返回。",
  {
    start: z.string().describe("起始时间，如 '2026-01-01T00:00:00+08:00'"),
    end: z.string().describe("结束时间，ISO 8601 格式"),
    unit: z.string().optional().default("seconds").describe("单位：seconds/minutes/hours/days"),
  },
  async ({ start, end, unit = "seconds" }) => {
    try {
      return { content: [{ type: "text", text: timeDiffBetween(start, end, unit) }] };
    } catch (e) {
      return { content: [{ type: "text", text: errorObj(e.message) }] };
    }
  }
);

/** 列出时区（返回 JSON 字符串）。 */
function listTimezones(region = "") {
  const allZones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf("timeZone")
    : [];
  const sorted = [...allZones].sort();
  const r = String(region).trim();
  const filtered = r ? sorted.filter((z) => z.startsWith(r)) : sorted;
  const returned = filtered.slice(0, 200);

  let note = `共 ${sorted.length} 个时区`;
  if (r) note += `，筛选 '${r}' 后 ${filtered.length} 个，本次返回前 ${returned.length} 个`;
  else note += `，本次返回前 ${returned.length} 个（共 ${filtered.length} 个）`;

  return JSON.stringify({
    total: returned.length,
    total_matched: filtered.length,
    timezones: returned,
    note,
  });
}

server.tool(
  "list_timezones",
  "列出可用的时区名称，可按区域前缀筛选（如 'Asia'、'America'）。",
  {
    region: z.string().optional().default("").describe("区域前缀筛选，留空返回全部"),
  },
  async ({ region = "" }) => {
    return { content: [{ type: "text", text: listTimezones(region) }] };
  }
);

// ============================================================
// 3. 启动 Server（stdio 模式）
//    仅当直接以 node server.js 运行时才连接，便于测试脚本 import 内部函数。
// ============================================================
if (isMain) {
  async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // 保持进程存活，直到客户端断开
  }

  main().catch((err) => {
    console.error(`[local-time-mcp] 启动失败: ${err.message}`);
    process.exit(1);
  });
}

// 导出内部函数，供测试脚本复用（运行时无副作用）
export {
  isLocalTz,
  assertValidTimezone,
  currentTimeInTimezone,
  formatWallClock,
  timeDiffBetween,
  listTimezones,
};
