> **[历史标注 2026-10-26]** 2026-05 架构重构期迁移记录（历史留档）。

# Utility Functions Migration Guide

This guide helps you migrate from the old `src/utils/formatters.ts` to the new FSD `shared/lib` structure.

## Overview

Utility functions have been reorganized into the following modules:

- `shared/lib/format/` - Date, number, and string formatting
- `shared/lib/storage/` - localStorage and sessionStorage utilities
- `shared/lib/permissions/` - Permission checking functions
- `shared/lib/validation/` - Data validation utilities

## Migration Examples

### Date Formatting

**Before:**

```typescript
import { formatDate, formatDateTime, formatDateChinese } from '@/utils/formatters'

const date = formatDate(new Date())
const datetime = formatDateTime(new Date())
const chinese = formatDateChinese(new Date())
```

**After:**

```typescript
import { formatDate, formatDateTime, formatDateChinese } from '@/shared/lib/format'

const date = formatDate(new Date())
const datetime = formatDateTime(new Date())
const chinese = formatDateChinese(new Date())
```

### Number Formatting

**Before:**

```typescript
import { formatNumber, formatCurrency, formatPercentage } from '@/utils/formatters'

const num = formatNumber(1234.56)
const currency = formatCurrency(1234.56)
const percent = formatPercentage(75.5)
```

**After:**

```typescript
import { formatNumber, formatCurrency, formatPercentage } from '@/shared/lib/format'

const num = formatNumber(1234.56)
const currency = formatCurrency(1234.56)
const percent = formatPercentage(75.5)
```

### String Formatting

**Before:**

```typescript
import { truncateText, highlightText } from '@/utils/formatters'

const short = truncateText('Long text...', 10)
const highlighted = highlightText('text', 'search')
```

**After:**

```typescript
import { truncate, highlightText } from '@/shared/lib/format'

const short = truncate('Long text...', 10)
const highlighted = highlightText('text', 'search')
```

### Storage Utilities

**Before:**

```typescript
import { storage } from '@/utils/formatters'

storage.set('key', value)
const data = storage.get('key')
storage.remove('key')
```

**After:**

```typescript
import { localStorage } from '@/shared/lib/storage'

localStorage.setItem('key', value)
const data = localStorage.getItem('key')
localStorage.removeItem('key')
```

### Permission Checking

**Before:**

```typescript
// From composables or stores
const hasPermission = (permission: string) => {
  return userPermissions.includes(permission)
}
```

**After:**

```typescript
import { hasPermission, hasAnyPermission, canAccess } from '@/shared/lib/permissions'

const canEdit = hasPermission(userPermissions, 'edit')
const canModify = hasAnyPermission(userPermissions, ['edit', 'update'])
const hasAccess = canAccess(userPermissions, userRoles, ['view'], ['admin'])
```

## Function Name Changes

Some functions have been renamed for consistency:

| Old Name         | New Name                  | Module          |
| ---------------- | ------------------------- | --------------- |
| `truncateText`   | `truncate`                | `format/string` |
| `storage.get`    | `localStorage.getItem`    | `storage`       |
| `storage.set`    | `localStorage.setItem`    | `storage`       |
| `storage.remove` | `localStorage.removeItem` | `storage`       |

## Import Path Changes

All imports should now use the `@/shared/lib` path:

```typescript
// ❌ Old
import { formatDate } from '@/utils/formatters'

// ✅ New
import { formatDate } from '@/shared/lib/format'
```

## Available Functions

### Date Formatting (`shared/lib/format`)

- `formatDate(date, format?)` - Format date with custom format
- `formatDateShort(date)` - Format as YYYY-MM-DD
- `formatDateTime(date, format?)` - Format datetime
- `formatTime(date, format?)` - Format time only
- `formatDateChinese(date)` - Format as Chinese date (2024年01月15日)
- `safeFormatDate(date, format?, defaultValue?)` - Safe format with fallback
- `getRelativeTime(date)` - Get relative time (e.g., "2小时前")
- `parseDate(dateString, format?)` - Parse date string
- `isValidDate(date)` - Check if date is valid
- `getDateRange(start, end)` - Get array of dates between range

### Number Formatting (`shared/lib/format`)

- `formatNumber(value, decimals?)` - Format with thousand separators
- `formatCurrency(value, currency?)` - Format as currency
- `formatPercentage(value, decimals?)` - Format as percentage
- `formatFileSize(bytes)` - Format file size (e.g., "1.5 MB")
- `parseNumber(value)` - Parse number from string
- `clamp(value, min, max)` - Clamp number between min and max
- `roundTo(value, decimals)` - Round to decimal places

### String Formatting (`shared/lib/format`)

- `capitalize(str)` - Capitalize first letter
- `toTitleCase(str)` - Convert to Title Case
- `truncate(str, maxLength, suffix?)` - Truncate with ellipsis
- `highlightText(text, highlight)` - Wrap matches in <mark> tags
- `stripHtml(html)` - Remove HTML tags
- `toKebabCase(str)` - Convert to kebab-case
- `toCamelCase(str)` - Convert to camelCase
- `toSnakeCase(str)` - Convert to snake_case
- `escapeHtml(str)` - Escape HTML special characters
- `randomString(length)` - Generate random string

### Storage (`shared/lib/storage`)

- `localStorage.getItem<T>(key)` - Get from localStorage
- `localStorage.setItem<T>(key, value)` - Set in localStorage
- `localStorage.removeItem(key)` - Remove from localStorage
- `localStorage.clear()` - Clear all localStorage
- `sessionStorage.getItem<T>(key)` - Get from sessionStorage
- `sessionStorage.setItem<T>(key, value)` - Set in sessionStorage
- `sessionStorage.removeItem(key)` - Remove from sessionStorage
- `sessionStorage.clear()` - Clear all sessionStorage

### Permissions (`shared/lib/permissions`)

- `hasPermission(userPermissions, permission)` - Check single permission
- `hasAnyPermission(userPermissions, permissions)` - Check any permission
- `hasAllPermissions(userPermissions, permissions)` - Check all permissions
- `hasRole(userRoles, role)` - Check single role
- `hasAnyRole(userRoles, roles)` - Check any role
- `hasAllRoles(userRoles, roles)` - Check all roles
- `isAdmin(userRoles)` - Check if user is admin
- `canAccess(permissions, roles, requiredPermissions?, requiredRoles?)` - Check access

## TypeScript Support

All functions are fully typed with TypeScript:

```typescript
import { formatDate, formatNumber } from '@/shared/lib/format'
import { localStorage } from '@/shared/lib/storage'

// Type inference works automatically
const date: string = formatDate(new Date())
const num: string = formatNumber(123.45)

// Generic types for storage
interface User {
  id: number
  name: string
}

localStorage.setItem<User>('user', { id: 1, name: 'John' })
const user = localStorage.getItem<User>('user') // User | null
```

## Backward Compatibility

The old `src/utils/formatters.ts` file is still available but deprecated. It will be removed in a future version. Please migrate to the new structure as soon as possible.

## Testing

All utility functions have comprehensive unit tests. When migrating, ensure your code still works by running:

```bash
npm run test
```

## Questions?

If you have questions about the migration, please refer to:

- [Shared Library README](./README.md)
- ~~Format Module Documentation~~（目标已不存在）
- ~~Architecture Design Document~~（目标已不存在）
