/**
 * 外键完整性检测属性测试
 *
 * **Feature: github-delivery-prep, Property 5: 外键完整性检测**
 * **Validates: Requirements 7.2, 7.5**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

interface OrgRecord {
  org_id: number
  org_name: string
  parent_org_id: number | null
}

interface IndicatorRecord {
  indicator_id: number
  indicator_desc: string
  task_id: number
  owner_org_id: number
  target_org_id: number
  parent_indicator_id: number | null
}

interface TaskRecord {
  task_id: number
  task_name: string
  cycle_id: number
  org_id: number
  created_by_org_id: number
}

interface CycleRecord {
  cycle_id: number
  cycle_name: string
}

interface DatabaseState {
  orgs: OrgRecord[]
  cycles: CycleRecord[]
  tasks: TaskRecord[]
  indicators: IndicatorRecord[]
}

interface ValidationResult {
  isValid: boolean
  orphanRecords: {
    table: string
    recordId: number
    foreignKey: string
    invalidValue: number
  }[]
}

function validateForeignKeyIntegrity(state: DatabaseState): ValidationResult {
  const orphanRecords: ValidationResult['orphanRecords'] = []

  const validOrgIds = new Set(state.orgs.map(o => o.org_id))
  const validCycleIds = new Set(state.cycles.map(c => c.cycle_id))
  const validTaskIds = new Set(state.tasks.map(t => t.task_id))
  const validIndicatorIds = new Set(state.indicators.map(i => i.indicator_id))

  for (const org of state.orgs) {
    if (org.parent_org_id !== null && !validOrgIds.has(org.parent_org_id)) {
      orphanRecords.push({
        table: 'org',
        recordId: org.org_id,
        foreignKey: 'parent_org_id',
        invalidValue: org.parent_org_id
      })
    }
  }

  for (const task of state.tasks) {
    if (!validCycleIds.has(task.cycle_id)) {
      orphanRecords.push({
        table: 'strategic_task',
        recordId: task.task_id,
        foreignKey: 'cycle_id',
        invalidValue: task.cycle_id
      })
    }
    if (!validOrgIds.has(task.org_id)) {
      orphanRecords.push({
        table: 'strategic_task',
        recordId: task.task_id,
        foreignKey: 'org_id',
        invalidValue: task.org_id
      })
    }
    if (!validOrgIds.has(task.created_by_org_id)) {
      orphanRecords.push({
        table: 'strategic_task',
        recordId: task.task_id,
        foreignKey: 'created_by_org_id',
        invalidValue: task.created_by_org_id
      })
    }
  }

  for (const indicator of state.indicators) {
    if (!validTaskIds.has(indicator.task_id)) {
      orphanRecords.push({
        table: 'indicator',
        recordId: indicator.indicator_id,
        foreignKey: 'task_id',
        invalidValue: indicator.task_id
      })
    }
    if (!validOrgIds.has(indicator.owner_org_id)) {
      orphanRecords.push({
        table: 'indicator',
        recordId: indicator.indicator_id,
        foreignKey: 'owner_org_id',
        invalidValue: indicator.owner_org_id
      })
    }
    if (!validOrgIds.has(indicator.target_org_id)) {
      orphanRecords.push({
        table: 'indicator',
        recordId: indicator.indicator_id,
        foreignKey: 'target_org_id',
        invalidValue: indicator.target_org_id
      })
    }
    if (
      indicator.parent_indicator_id !== null &&
      !validIndicatorIds.has(indicator.parent_indicator_id)
    ) {
      orphanRecords.push({
        table: 'indicator',
        recordId: indicator.indicator_id,
        foreignKey: 'parent_indicator_id',
        invalidValue: indicator.parent_indicator_id
      })
    }
  }

  return { isValid: orphanRecords.length === 0, orphanRecords }
}

function injectOrphanRecord(
  state: DatabaseState,
  targetTable: 'indicator',
  foreignKey: string
): {
  state: DatabaseState
  injectedOrphan: { table: string; recordId: number; foreignKey: string; invalidValue: number }
} {
  const invalidId = 99999
  const newState = JSON.parse(JSON.stringify(state)) as DatabaseState

  if (targetTable === 'indicator') {
    if (newState.indicators.length === 0) {
      const orphanIndicator: IndicatorRecord = {
        indicator_id: 1000,
        indicator_desc: 'Orphan_Indicator',
        task_id: foreignKey === 'task_id' ? invalidId : newState.tasks[0]?.task_id || invalidId,
        owner_org_id:
          foreignKey === 'owner_org_id' ? invalidId : newState.orgs[0]?.org_id || invalidId,
        target_org_id:
          foreignKey === 'target_org_id' ? invalidId : newState.orgs[0]?.org_id || invalidId,
        parent_indicator_id: foreignKey === 'parent_indicator_id' ? invalidId : null
      }
      newState.indicators.push(orphanIndicator)
      return {
        state: newState,
        injectedOrphan: { table: 'indicator', recordId: 1000, foreignKey, invalidValue: invalidId }
      }
    } else {
      const target = newState.indicators[0]!
      if (foreignKey === 'owner_org_id') {
        target.owner_org_id = invalidId
      } else if (foreignKey === 'target_org_id') {
        target.target_org_id = invalidId
      } else if (foreignKey === 'task_id') {
        target.task_id = invalidId
      } else if (foreignKey === 'parent_indicator_id') {
        target.parent_indicator_id = invalidId
      }
      return {
        state: newState,
        injectedOrphan: {
          table: 'indicator',
          recordId: target.indicator_id,
          foreignKey,
          invalidValue: invalidId
        }
      }
    }
  }
}

describe('Property 5: 外键完整性检测', () => {
  describe('检测 indicator 的 owner_org_id 孤儿记录', () => {
    it('should detect orphan indicator.owner_org_id for any valid database state', () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 5 }), orgCount => {
          const validState: DatabaseState = {
            orgs: Array.from({ length: orgCount }, (_, i) => ({
              org_id: i + 1,
              org_name: `Org_${i + 1}`,
              parent_org_id: null
            })),
            cycles: [{ cycle_id: 1, cycle_name: 'Cycle_2025' }],
            tasks: [
              { task_id: 1, task_name: 'Task_1', cycle_id: 1, org_id: 1, created_by_org_id: 1 }
            ],
            indicators: [
              {
                indicator_id: 1,
                indicator_desc: 'Indicator_1',
                task_id: 1,
                owner_org_id: 1,
                target_org_id: 2,
                parent_indicator_id: null
              }
            ]
          }
          expect(validateForeignKeyIntegrity(validState).isValid).toBe(true)
          const { state: corruptedState, injectedOrphan } = injectOrphanRecord(
            validState,
            'indicator',
            'owner_org_id'
          )
          const result = validateForeignKeyIntegrity(corruptedState)
          expect(result.isValid).toBe(false)
          const foundOrphan = result.orphanRecords.find(
            r => r.table === injectedOrphan.table && r.foreignKey === injectedOrphan.foreignKey
          )
          expect(foundOrphan).toBeDefined()
          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('有效数据库状态应通过校验', () => {
    it('should pass validation for any valid database state without orphans', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.integer({ min: 0, max: 3 }),
          (orgCount, taskCount) => {
            const orgs = Array.from({ length: orgCount }, (_, i) => ({
              org_id: i + 1,
              org_name: `Org_${i + 1}`,
              parent_org_id: null
            }))
            const cycles = [{ cycle_id: 1, cycle_name: 'Cycle_2025' }]
            const tasks = Array.from({ length: taskCount }, (_, i) => ({
              task_id: i + 1,
              task_name: `Task_${i + 1}`,
              cycle_id: 1,
              org_id: 1,
              created_by_org_id: 1
            }))
            const indicators =
              tasks.length > 0
                ? [
                    {
                      indicator_id: 1,
                      indicator_desc: 'Indicator_1',
                      task_id: 1,
                      owner_org_id: 1,
                      target_org_id: Math.min(2, orgCount),
                      parent_indicator_id: null
                    }
                  ]
                : []
            const state: DatabaseState = { orgs, cycles, tasks, indicators }
            const result = validateForeignKeyIntegrity(state)
            expect(result.isValid).toBe(true)
            expect(result.orphanRecords).toHaveLength(0)
            return true
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
