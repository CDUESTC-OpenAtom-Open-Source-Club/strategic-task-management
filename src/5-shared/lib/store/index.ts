/**
 * Shared Store Utilities
 *
 * Reusable store patterns and utilities for Pinia stores.
 */

export { createCrudStore } from './createCrudStore'
export type {
  PaginationFilters,
  PaginatedResponse,
  ListState,
  CrudStoreConfig
} from './createCrudStore'
export {
  identityStateResetPlugin,
  resetIdentityScopedStores,
  resetIdentityStateResetRegistryForTests
} from './identityStateReset'
