/**
 * 本地时区日期标签工具
 *
 * 背景：导出文件名里的日期标签（`xxx_2026-10-30.zip`）此前统一用
 * `new Date().toISOString().slice(0, 10)` 取值，而 `toISOString()` 返回的是 **UTC** 时间。
 * 东八区（UTC+8）在本地当天 00:00~08:00 之间，UTC 还停在前一天，于是导出的文件名
 * 会出现「日期差一天」。
 *
 * 这里统一按**本地时区**取年月日；仅用于文件名/日期标签这类「给人看的日期」，
 * 时间戳场景仍然照常用 `toISOString()`（那是 UTC 的绝对时刻，语义不同，不要替换）。
 */

/** 把数值补齐到指定位数，不足前面补 0 */
function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

/**
 * 按本地时区把日期格式化成 `YYYY-MM-DD`。
 *
 * - 月/日不足两位自动补 0（`2026-1-5` → `2026-01-05`）
 * - 跨月/跨年/闰年由 Date 自身语义保证（`2026-12-31` → `2026-12-31`，`2028-02-29` → `2028-02-29`）
 *
 * @param date 目标日期，默认当前时刻
 * @returns 本地时区的 `YYYY-MM-DD` 字符串
 */
export function formatLocalDateTag(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/**
 * 按本地时区把日期格式化成上报月份 `YYYYMM`（例：`202610`）。
 *
 * 与 `formatLocalDateTag` 同源问题：`toISOString().slice(0, 7)` 取的是 UTC 月份，
 * 东八区每月 1 日 00:00~08:00 之间会算出**上个月**——上报月份决定这份月报归属哪一期，
 * 算错就是业务数据错位，因此这里同样按本地时区取月份。
 */
export function formatLocalMonthTag(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1

  return `${pad(year, 4)}${pad(month, 2)}`
}
