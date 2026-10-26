> **[历史标注 2026-10-26]** 2026-05 架构重构期产物。文中引用的 .kiro 目录已不存在；分层说明以当前实际代码为准。

# Shared Layer (FSD Architecture)

This directory contains the shared layer following Feature-Sliced Design (FSD) architecture principles.

## Directory Structure

```
shared/
├── ui/                 # Reusable UI components
│   ├── form/          # Form components (FormField, FormSelect, FormDatePicker)
│   ├── table/         # Table components (DataTable, TablePagination, TableFilters)
│   ├── feedback/      # Feedback components (ConfirmDialog, AlertDialog, LoadingSpinner)
│   ├── display/       # Display components (StatusBadge, UserAvatar, OrgTreeSelect)
│   └── layout/        # Layout components (PageHeader, ContentCard, EmptyState)
├── lib/               # Utility libraries
│   ├── api/          # API client and error handling
│   ├── storage/      # localStorage and sessionStorage wrappers
│   ├── validation/   # Validation utilities and Zod helpers
│   ├── format/       # Formatting utilities (date, number, string)
│   └── permissions/  # Permission checking utilities
├── types/            # TypeScript type definitions
│   ├── api.ts       # API-related types
│   └── common.ts    # Common shared types
├── config/           # Configuration files
│   ├── api.ts       # API endpoints and configuration
│   └── app.ts       # Application settings
├── components/       # Legacy components (to be migrated to ui/)
├── api/             # Legacy API client (to be migrated to lib/api/)
└── services/        # Shared services (websocket, etc.)
```

## Usage

### Importing UI Components

```typescript
import { DataTable, StatusBadge, PageHeader } from '@/shared/ui'
```

### Using API Client

```typescript
import { apiClient, handleApiError } from '@/shared/lib/api'

try {
  const response = await apiClient.get('/indicators')
  console.log(response.data)
} catch (error) {
  const apiError = handleApiError(error)
  console.error(apiError.message)
}
```

### Using Storage Utilities

```typescript
import { localStorage, sessionStorage } from '@/shared/lib/storage'

// Save data
localStorage.setItem('user', { id: 1, name: 'John' })

// Retrieve data
const user = localStorage.getItem<User>('user')
```

### Using Validation

```typescript
import { isValidEmail, stringSchemas } from '@/shared/lib/validation'

// Simple validation
if (!isValidEmail(email)) {
  console.error('Invalid email')
}

// Zod validation
const emailSchema = stringSchemas.email
const result = emailSchema.safeParse(email)
```

### Using Formatters

```typescript
import { dateFormat, numberFormat, stringFormat } from '@/shared/lib/format'

// Format date
const formatted = dateFormat.formatDate(new Date(), 'YYYY-MM-DD')

// Format number
const price = numberFormat.formatCurrency(1234.56)

// Format string
const truncated = stringFormat.truncate('Long text...', 10)
```

### Using Permissions

```typescript
import { hasPermission, canAccess } from '@/shared/lib/permissions'

if (hasPermission(userPermissions, 'indicator:edit')) {
  // Allow editing
}

if (canAccess(userPermissions, userRoles, ['indicator:view'], ['admin', 'manager'])) {
  // Allow access
}
```

### Using Configuration

```typescript
import { API_ENDPOINTS, APP_NAME, DEFAULT_PAGE_SIZE } from '@/shared/config'

// API endpoints
const url = API_ENDPOINTS.indicators.list

// App settings
console.log(APP_NAME) // '战略任务管理系统'
```

### Using Types

```typescript
import type { ApiResponse, PaginatedResponse, BaseEntity } from '@/shared/types'

interface Indicator extends BaseEntity {
  name: string
  code: string
}

const response: ApiResponse<PaginatedResponse<Indicator>> = await api.get('/indicators')
```

## Migration Notes

### Legacy Structure

The following directories contain legacy code that will be gradually migrated:

- `components/` → Will be migrated to `ui/` with proper categorization
- `api/client.ts` → Already exists, new structure in `lib/api/`
- `services/` → Will remain for specialized services like WebSocket

### Migration Strategy

1. **Phase 1** (Current): Create new FSD structure with placeholder files
2. **Phase 2**: Migrate existing components to appropriate `ui/` subdirectories
3. **Phase 3**: Update imports across the application
4. **Phase 4**: Remove legacy structure once migration is complete

## Best Practices

1. **Keep it Simple**: Shared layer should contain only truly reusable code
2. **No Business Logic**: Business logic belongs in features, not shared
3. **Type Safety**: Always provide TypeScript types for better DX
4. **Documentation**: Document complex utilities with JSDoc comments
5. **Testing**: Write unit tests for all utility functions

## Related Documentation

- [FSD Architecture Guide](https://feature-sliced.design/)
- ~~Frontend Development Standards~~（目标已不存在）
- ~~Architecture Refactoring Spec~~（目标已不存在）
