> **[历史标注 2026-10-26]** 2026-05 架构重构期产物。文中 .kiro 引用与部分迁移链接已失效；迁移记录见同目录 MIGRATION.md。

# Shared Library Module

The `shared/lib` module contains reusable utility functions and helpers following the Feature-Sliced Design (FSD) architecture.

## Structure

```
shared/lib/
├── api/              # HTTP client and API utilities
├── format/           # Formatting utilities (date, number, string)
├── permissions/      # Permission checking functions
├── storage/          # localStorage and sessionStorage wrappers
├── validation/       # Data validation utilities
├── index.ts          # Main exports
├── MIGRATION.md      # Migration guide from old utils
└── README.md         # This file
```

## Modules

### API (`shared/lib/api`)

HTTP client configuration, interceptors, and error handling.

```typescript
import { apiClient } from '@/shared/lib/api'

const response = await apiClient.get('/users')
```

See [API README](./api/README.md) for details.

### Format (`shared/lib/format`)

Date, number, and string formatting utilities.

```typescript
import { formatDate, formatNumber, truncate } from '@/shared/lib/format'

const date = formatDate(new Date(), 'YYYY-MM-DD')
const price = formatNumber(1234.56, 2)
const short = truncate('Long text...', 10)
```

**Available functions:**

- Date: `formatDate`, `formatDateTime`, `formatDateChinese`, `getRelativeTime`, etc.
- Number: `formatNumber`, `formatCurrency`, `formatPercentage`, `formatFileSize`
- String: `capitalize`, `truncate`, `toKebabCase`, `toCamelCase`, etc.

### Permissions (`shared/lib/permissions`)

Permission and role checking utilities.

```typescript
import { hasPermission, canAccess } from '@/shared/lib/permissions'

const canEdit = hasPermission(userPermissions, 'edit')
const hasAccess = canAccess(permissions, roles, ['view'], ['admin'])
```

**Available functions:**

- `hasPermission` - Check single permission
- `hasAnyPermission` - Check any of multiple permissions
- `hasAllPermissions` - Check all permissions
- `hasRole` - Check single role
- `hasAnyRole` - Check any role
- `isAdmin` - Check if user is admin
- `canAccess` - Comprehensive access check

### Storage (`shared/lib/storage`)

Type-safe wrappers for localStorage and sessionStorage.

```typescript
import { localStorage, sessionStorage } from '@/shared/lib/storage'

// localStorage
localStorage.setItem('user', { id: 1, name: 'John' })
const user = localStorage.getItem<User>('user')
localStorage.removeItem('user')

// sessionStorage
sessionStorage.setItem('token', 'abc123')
const token = sessionStorage.getItem<string>('token')
```

**Features:**

- Type-safe with generics
- Automatic JSON serialization/deserialization
- Error handling with console warnings
- Consistent API for both storage types

### Validation (`shared/lib/validation`)

Data validation utilities using Zod.

```typescript
import { validators } from '@/shared/lib/validation'

const isValid = validators.email('test@example.com')
const isPhone = validators.phone('13800138000')
```

## Usage Guidelines

### 1. Import from Module Root

Always import from the module root, not individual files:

```typescript
// ✅ Good
import { formatDate, formatNumber } from '@/shared/lib/format'

// ❌ Bad
import { formatDate } from '@/shared/lib/format/date'
import { formatNumber } from '@/shared/lib/format/number'
```

### 2. Use TypeScript Types

All functions are fully typed. Use type inference:

```typescript
import { formatDate } from '@/shared/lib/format'

const date: string = formatDate(new Date()) // Type is inferred
```

### 3. Pure Functions

All utility functions are pure (no side effects) and can be safely used anywhere:

```typescript
// Safe to use in computed properties
const formattedDate = computed(() => formatDate(date.value))

// Safe to use in templates
<template>
  <div>{{ formatNumber(price) }}</div>
</template>
```

### 4. Tree-Shaking

The module is optimized for tree-shaking. Only imported functions are included in the bundle:

```typescript
// Only formatDate is bundled
import { formatDate } from '@/shared/lib/format'
```

## Design Principles

### 1. Single Responsibility

Each function does one thing well:

```typescript
// ✅ Good - Single purpose
formatDate(date, 'YYYY-MM-DD')
formatNumber(1234.56, 2)

// ❌ Bad - Multiple purposes
format(date, 'date', 'YYYY-MM-DD')
format(1234.56, 'number', 2)
```

### 2. Immutability

Functions don't mutate input parameters:

```typescript
const original = [1, 2, 3]
const sorted = sortBy(original, 'asc') // original is unchanged
```

### 3. Composability

Functions can be easily composed:

```typescript
const formatted = formatCurrency(roundTo(calculateTotal(items), 2))
```

### 4. Type Safety

All functions have proper TypeScript types:

```typescript
// Type errors are caught at compile time
formatDate(123) // ✅ OK - number is valid
formatDate('invalid') // ✅ OK - string is valid
formatDate(null) // ❌ Error - null not allowed
```

## Testing

All utility functions have comprehensive unit tests:

```bash
# Run all tests
npm run test

# Run specific module tests
npm run test -- src/shared/lib/format
npm run test -- src/shared/lib/storage
npm run test -- src/shared/lib/permissions
```

## Migration

If you're migrating from the old `src/utils/formatters.ts`, see [MIGRATION.md](./MIGRATION.md) for a complete guide.

## Contributing

When adding new utility functions:

1. **Choose the right module** - Date formatting goes in `format/date.ts`, not `format/number.ts`
2. **Write tests** - All functions must have unit tests
3. **Document with JSDoc** - Add clear documentation comments
4. **Export from index** - Add exports to the module's `index.ts`
5. **Update README** - Document the new function here

Example:

```typescript
/**
 * Format duration in milliseconds to human-readable string
 * @param ms - Duration in milliseconds
 * @returns Formatted duration (e.g., "2h 30m")
 */
export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}
```

## Related Documentation

- ~~FSD Architecture Design~~（目标已不存在）
- ~~Frontend Development Guide~~（目标已不存在）
- [API Documentation](./api/README.md)
- [Migration Guide](./MIGRATION.md)
