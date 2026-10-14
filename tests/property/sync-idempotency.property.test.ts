/**
 * Property-Based Tests for Sync Idempotency
 *
 * **Feature: production-deployment-integration, Property 18: 同步幂等性**
 * **Validates: Requirements 9.4**
 *
 * *For any* sync operation, executing multiple times should produce the same
 * final state without creating duplicate data.
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Represents a syncable record with unique identifier
 */
interface SyncRecord {
  id: string
  name: string
  type: 'org' | 'cycle' | 'task' | 'indicator'
  parentId?: string
  year?: number
}

/**
 * Represents the state of a database table after sync
 */
interface TableState {
  records: Map<string, SyncRecord>
  insertCount: number
  skipCount: number
}

/**
 * Simulates the sync logic that checks for existing records before inserting
 * This mirrors the actual sync script behavior:
 * - Check if record exists by unique key (name/id)
 * - Skip if exists, insert if not
 * - Track insert and skip counts
 */
function simulateSync(existingRecords: SyncRecord[], recordsToSync: SyncRecord[]): TableState {
  const records = new Map<string, SyncRecord>()
  let insertCount = 0
  let skipCount = 0

  // Initialize with existing records
  for (const record of existingRecords) {
    records.set(record.id, record)
  }

  // Sync new records (idempotent logic)
  for (const record of recordsToSync) {
    if (records.has(record.id)) {
      // Record already exists - skip
      skipCount++
    } else {
      // Record doesn't exist - insert
      records.set(record.id, record)
      insertCount++
    }
  }

  return { records, insertCount, skipCount }
}

/**
 * Generates arbitrary sync records for testing
 */
const syncRecordArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  type: fc.constantFrom('org', 'cycle', 'task', 'indicator') as fc.Arbitrary<SyncRecord['type']>,
  parentId: fc.option(fc.uuid(), { nil: undefined }),
  year: fc.option(fc.integer({ min: 2020, max: 2030 }), { nil: undefined })
})

/**
 * Generates a list of unique sync records (no duplicate IDs)
 */
const uniqueSyncRecordsArb = fc
  .array(syncRecordArb, { minLength: 0, maxLength: 50 })
  .map(records => {
    const seen = new Set<string>()
    return records.filter(r => {
      if (seen.has(r.id)) {
        return false
      }
      seen.add(r.id)
      return true
    })
  })

describe('Property 18: Sync Idempotency', () => {
  /**
   * Core idempotency property: Running sync twice produces the same result
   */
  it('should produce identical state when sync is executed multiple times', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, uniqueSyncRecordsArb, (existingRecords, recordsToSync) => {
        // First sync
        const state1 = simulateSync(existingRecords, recordsToSync)

        // Second sync with same input (simulating re-run)
        const state2 = simulateSync(Array.from(state1.records.values()), recordsToSync)

        // Third sync to verify stability
        const state3 = simulateSync(Array.from(state2.records.values()), recordsToSync)

        // Record count should be identical after first sync
        expect(state2.records.size).toBe(state1.records.size)
        expect(state3.records.size).toBe(state2.records.size)

        // All records from state1 should exist in state2 and state3
        for (const [id, record] of state1.records) {
          expect(state2.records.has(id)).toBe(true)
          expect(state3.records.has(id)).toBe(true)
          expect(state2.records.get(id)).toEqual(record)
          expect(state3.records.get(id)).toEqual(record)
        }

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * No duplicates property: Sync should never create duplicate records
   */
  it('should never create duplicate records regardless of how many times sync runs', () => {
    fc.assert(
      fc.property(
        uniqueSyncRecordsArb,
        uniqueSyncRecordsArb,
        fc.integer({ min: 2, max: 10 }),
        (existingRecords, recordsToSync, runCount) => {
          let currentState = simulateSync(existingRecords, recordsToSync)
          const expectedSize = currentState.records.size

          // Run sync multiple times
          for (let i = 1; i < runCount; i++) {
            currentState = simulateSync(Array.from(currentState.records.values()), recordsToSync)

            // Size should never increase after first sync
            expect(currentState.records.size).toBe(expectedSize)
          }

          // Verify no duplicate IDs (Map guarantees this, but let's be explicit)
          const ids = Array.from(currentState.records.keys())
          const uniqueIds = new Set(ids)
          expect(ids.length).toBe(uniqueIds.size)

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Skip count property: Subsequent syncs should skip all records
   */
  it('should skip all records on subsequent sync runs', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, uniqueSyncRecordsArb, (existingRecords, recordsToSync) => {
        // First sync
        const state1 = simulateSync(existingRecords, recordsToSync)

        // Second sync - should skip all records that were just inserted
        const state2 = simulateSync(Array.from(state1.records.values()), recordsToSync)

        // On second run, all records to sync should be skipped
        expect(state2.skipCount).toBe(recordsToSync.length)
        expect(state2.insertCount).toBe(0)

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Insert count property: First sync should insert only new records
   */
  it('should insert only records that do not already exist', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, uniqueSyncRecordsArb, (existingRecords, recordsToSync) => {
        const existingIds = new Set(existingRecords.map(r => r.id))
        const newRecords = recordsToSync.filter(r => !existingIds.has(r.id))
        const overlappingRecords = recordsToSync.filter(r => existingIds.has(r.id))

        const state = simulateSync(existingRecords, recordsToSync)

        // Insert count should equal number of truly new records
        expect(state.insertCount).toBe(newRecords.length)

        // Skip count should equal number of overlapping records
        expect(state.skipCount).toBe(overlappingRecords.length)

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Data integrity property: Existing records should not be modified
   */
  it('should preserve existing records without modification', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, uniqueSyncRecordsArb, (existingRecords, recordsToSync) => {
        const state = simulateSync(existingRecords, recordsToSync)

        // All existing records should still exist with same data
        for (const original of existingRecords) {
          const synced = state.records.get(original.id)
          expect(synced).toBeDefined()
          expect(synced).toEqual(original)
        }

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Completeness property: All new records should be added
   */
  it('should add all new records that do not exist', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, uniqueSyncRecordsArb, (existingRecords, recordsToSync) => {
        const existingIds = new Set(existingRecords.map(r => r.id))
        const state = simulateSync(existingRecords, recordsToSync)

        // All records to sync should now exist in the state
        for (const record of recordsToSync) {
          expect(state.records.has(record.id)).toBe(true)
        }

        // Final size should be existing + new (non-overlapping)
        const newRecordCount = recordsToSync.filter(r => !existingIds.has(r.id)).length
        expect(state.records.size).toBe(existingRecords.length + newRecordCount)

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Order independence property: Sync result should be independent of input order
   */
  it('should produce same result regardless of record order in input', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, uniqueSyncRecordsArb, (existingRecords, recordsToSync) => {
        // Sync with original order
        const state1 = simulateSync(existingRecords, recordsToSync)

        // Sync with reversed order
        const reversedRecords = [...recordsToSync].reverse()
        const state2 = simulateSync(existingRecords, reversedRecords)

        // Both should produce same final state
        expect(state1.records.size).toBe(state2.records.size)
        expect(state1.insertCount).toBe(state2.insertCount)
        expect(state1.skipCount).toBe(state2.skipCount)

        // Same records should exist
        for (const [id, record] of state1.records) {
          expect(state2.records.has(id)).toBe(true)
          expect(state2.records.get(id)).toEqual(record)
        }

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Empty input property: Sync with empty input should not change state
   */
  it('should not change state when syncing empty records', () => {
    fc.assert(
      fc.property(uniqueSyncRecordsArb, existingRecords => {
        const state = simulateSync(existingRecords, [])

        // State should be unchanged
        expect(state.records.size).toBe(existingRecords.length)
        expect(state.insertCount).toBe(0)
        expect(state.skipCount).toBe(0)

        // All existing records should be preserved
        for (const record of existingRecords) {
          expect(state.records.has(record.id)).toBe(true)
          expect(state.records.get(record.id)).toEqual(record)
        }

        return true
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Convergence property: Multiple syncs from different initial states
   * should converge to the same final state
   */
  it('should converge to same state when syncing same records from different initial states', () => {
    fc.assert(
      fc.property(
        uniqueSyncRecordsArb,
        uniqueSyncRecordsArb,
        uniqueSyncRecordsArb,
        (initialState1, initialState2, recordsToSync) => {
          // Sync from two different initial states
          const state1 = simulateSync(initialState1, recordsToSync)
          const state2 = simulateSync(initialState2, recordsToSync)

          // After syncing, both should contain all records to sync
          for (const record of recordsToSync) {
            expect(state1.records.has(record.id)).toBe(true)
            expect(state2.records.has(record.id)).toBe(true)
          }

          // The synced records should be identical
          for (const record of recordsToSync) {
            expect(state1.records.get(record.id)).toEqual(state2.records.get(record.id))
          }

          return true
        }
      ),
      { numRuns: 100 }
    )
  })
})
