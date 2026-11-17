import { describe, expect, it } from 'vitest'
import { isReportReturnedChainAlive } from '@/features/indicator/lib/reportSubmitGate'

/**
 * 2026-11-17（e2e 缺陷②修复，症状 A）：上报「驳回退回待重报（WITHDRAWN 活链）」判定。
 *
 * 驳回落点 = plan_report→DRAFT + audit_instance→WITHDRAWN（completed_at 为空的重报
 * 复活实例，report.audit_instance_id 保留指向它）。填报页此前只认「IN_REVIEW 且
 * 当前节点=填报人提交」的活链态（isReportReturnedToSubmitter），WITHDRAWN 活链
 * 落进灰色「草稿」——违背 2026-11-13 定案「驳回=退回填报人，退回态要可见」。
 * 本谓词是红横幅（hasReturnedReportChain）与红章（已回退待重报）的单一判定源。
 */
describe('reportSubmitGate · isReportReturnedChainAlive（e2e 缺陷② WITHDRAWN 活链）', () => {
  it('WITHDRAWN 活链（endTime 为空）+ 报告已回 DRAFT → 横幅出现（true）', () => {
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'DRAFT',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: null
      })
    ).toBe(true)
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'DRAFT',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: undefined
      })
    ).toBe(true)
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'DRAFT',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: ''
      })
    ).toBe(true)
  })

  it('归一化：状态大小写与首尾空白不敏感（后端原串直传也命中）', () => {
    expect(
      isReportReturnedChainAlive({
        reportStatus: ' draft ',
        instanceStatus: 'withdrawn',
        instanceEndTime: null
      })
    ).toBe(true)
  })

  it('IN_REVIEW 正常在审 → 不出现退回横幅（false，防误报）', () => {
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'IN_REVIEW',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: null
      })
    ).toBe(false)
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'DRAFT',
        instanceStatus: 'IN_REVIEW',
        instanceEndTime: null
      })
    ).toBe(false)
  })

  it('重报提交后（实例复活 IN_REVIEW / 报告离开 DRAFT）→ 横幅消失（false）', () => {
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'IN_REVIEW',
        instanceStatus: 'IN_REVIEW',
        instanceEndTime: null
      })
    ).toBe(false)
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'SUBMITTED',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: null
      })
    ).toBe(false)
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'APPROVED',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: null
      })
    ).toBe(false)
  })

  it('WITHDRAWN 已终结（endTime 非空 = completed_at 有值）→ false（非活链）', () => {
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'DRAFT',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: '2026-11-17T10:00:00'
      })
    ).toBe(false)
  })

  it('其他终态实例（CANCELLED/APPROVED/REJECTED）→ false', () => {
    for (const status of ['CANCELLED', 'APPROVED', 'REJECTED', 'PENDING', '']) {
      expect(
        isReportReturnedChainAlive({
          reportStatus: 'DRAFT',
          instanceStatus: status,
          instanceEndTime: null
        })
      ).toBe(false)
    }
  })

  it('空值/摘要缺失 → false（保守，宁可灰草稿也不误报退回）', () => {
    expect(
      isReportReturnedChainAlive({
        reportStatus: null,
        instanceStatus: null,
        instanceEndTime: null
      })
    ).toBe(false)
    expect(
      isReportReturnedChainAlive({
        reportStatus: 'DRAFT',
        instanceStatus: null,
        instanceEndTime: null
      })
    ).toBe(false)
    expect(
      isReportReturnedChainAlive({
        reportStatus: '',
        instanceStatus: 'WITHDRAWN',
        instanceEndTime: null
      })
    ).toBe(false)
  })
})
