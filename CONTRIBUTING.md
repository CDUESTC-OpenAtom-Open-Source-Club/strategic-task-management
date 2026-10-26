# 贡献指南 (Contributing Guide)

欢迎为 SISM 前端项目做出贡献！为了保持代码质量和提交历史的清晰，请遵循以下规范。

## 📋 目录

- [开发环境设置](#开发环境设置)
- [分支管理策略](#分支管理策略)
- [提交规范](#提交规范)
- [代码规范](#代码规范)
- [Pull Request 流程](#pull-request-流程)
- [测试要求](#测试要求)
- [常见问题](#常见问题)

---

## 🛠️ 开发环境设置

### 前置要求

- **Node.js**: 推荐 25.x，支持 22.x - 25.x
- **npm**: 9.0 或更高版本
- **Git**: 2.30 或更高版本
- **VS Code**: 推荐使用（配合 Volar 插件）

### 初始设置

```bash
# 1. Fork 项目到你的 GitHub 账号

# 2. 克隆你的 fork
git clone https://github.com/YOUR_USERNAME/strategic-task-management.git
cd strategic-task-management

# 3. 添加上游仓库
git remote add upstream https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management.git

# 4. 安装依赖
npm install

# 5. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置后端 API 地址

# 6. 启动开发服务器
npm run dev

# 7. 验证安装
# 浏览器访问 http://localhost:3000
```

### 推荐的 VS Code 插件

```json
{
  "recommendations": [
    "Vue.volar",
    "Vue.vscode-typescript-vue-plugin",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss"
  ]
}
```

---

## 🌿 分支管理策略

### 分支命名规范

我们使用 **Git Flow** 工作流，分支命名遵循以下规范：

```
feature/功能描述       # 新功能开发
bugfix/问题描述        # Bug 修复
hotfix/紧急修复描述    # 生产环境紧急修复
refactor/重构描述      # 代码重构
docs/文档描述          # 文档更新
test/测试描述          # 测试相关
style/样式描述         # UI/样式调整
chore/杂项描述         # 构建、配置等杂项
```

### 分支命名示例

```bash
feature/add-dashboard-charts
bugfix/fix-login-validation
hotfix/fix-critical-ui-bug
refactor/optimize-api-calls
docs/update-component-guide
test/add-unit-tests
style/improve-mobile-layout
chore/update-dependencies
```

### 工作流程

```bash
# 1. 确保 main 分支是最新的
git checkout main
git pull upstream main

# 2. 创建新分支（从 main 分支）
git checkout -b feature/your-feature-name

# 3. 进行开发工作
# ... 编写代码 ...

# 4. 运行代码检查
npm run lint
npm run type-check
npm run test

# 5. 提交更改（遵循提交规范）
git add .
git commit -m "feat: add dashboard charts"

# 6. 保持分支与上游同步
git fetch upstream
git rebase upstream/main

# 7. 推送到你的 fork
git push origin feature/your-feature-name

# 8. 在 GitHub 上创建 Pull Request
```

### ⚠️ 重要规则

1. **永远不要直接提交到 main 分支**
2. **始终从最新的 main 分支创建新分支**
3. **一个分支只做一件事**（一个功能或一个 bug 修复）
4. **定期同步上游 main 分支**
5. **使用 rebase 而不是 merge 来保持历史清晰**
6. **提交前运行 lint 和测试**

---

## 📝 提交规范

我们使用 **Conventional Commits** 规范，并通过 **commitlint** 强制执行。

### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| Type       | 说明                         | 示例                                      |
| ---------- | ---------------------------- | ----------------------------------------- |
| `feat`     | 新功能                       | `feat: add dashboard charts`              |
| `fix`      | Bug 修复                     | `fix: resolve login validation issue`     |
| `docs`     | 文档更新                     | `docs: update component usage guide`      |
| `style`    | 代码格式或 UI 样式           | `style: improve mobile responsive layout` |
| `refactor` | 重构（不是新功能也不是修复） | `refactor: extract common API logic`      |
| `perf`     | 性能优化                     | `perf: optimize chart rendering`          |
| `test`     | 测试相关                     | `test: add unit tests for auth store`     |
| `build`    | 构建系统或依赖更新           | `build: upgrade Vue to 3.5.1`             |
| `ci`       | CI/CD 配置                   | `ci: add GitHub Actions workflow`         |
| `chore`    | 其他杂项                     | `chore: update .gitignore`                |
| `revert`   | 回滚提交                     | `revert: revert commit abc123`            |

### Scope 范围（可选）

指明提交影响的范围，例如：

- `auth` - 认证相关
- `dashboard` - 仪表板
- `indicator` - 指标管理
- `task` - 任务管理
- `api` - API 调用
- `ui` - UI 组件
- `store` - 状态管理

### Subject 主题

- 使用祈使句，现在时态："add" 而不是 "added" 或 "adds"
- 不要大写首字母
- 结尾不要加句号
- 限制在 50 个字符以内

### 提交示例

#### 简单提交

```bash
git commit -m "feat: add dashboard charts"
```

#### 带 scope 的提交

```bash
git commit -m "fix(auth): resolve token refresh issue"
```

#### 完整提交

```bash
git commit -m "feat(dashboard): add real-time data visualization

- Implement ECharts integration
- Add responsive chart components
- Support multiple chart types
- Add loading states

Closes #45"
```

#### 破坏性变更

```bash
git commit -m "refactor(api)!: change API response structure

BREAKING CHANGE: The API response format has changed.
Old format: { data: {...} }
New format: { result: {...}, meta: {...} }

Migration guide: Update all API calls to use the new response format.

Closes #67"
```

### ✅ 好的提交示例

```bash
feat: add user profile page
fix: resolve chart rendering issue
docs: update README with setup instructions
style: improve mobile navigation layout
test: add integration tests for login flow
refactor: extract validation logic to composable
perf: optimize table rendering performance
```

### ❌ 不好的提交示例

```bash
update code                    # 太模糊
Fixed bug                      # 首字母大写，缺少类型
feat: Added new feature.       # 过去时态，有句号
WIP                           # 不应该提交未完成的工作
misc changes                   # 太模糊，缺少类型
```

---

## 💻 代码规范

### Vue 3 代码风格

我们使用 **Vue 3 Composition API** 和 **`<script setup>`** 语法。

#### 组件命名

```typescript
// 组件文件名：大驼峰（PascalCase）
DashboardView.vue
UserProfile.vue
DataTable.vue

// 组件使用：大驼峰
<template>
  <DashboardView />
  <UserProfile />
</template>
```

#### 变量和函数命名

```typescript
// 变量：小驼峰（camelCase）
const userName = ref('')
const isLoading = ref(false)

// 函数：小驼峰
const fetchUserData = async () => {}
const handleSubmit = () => {}

// 常量：全大写，下划线分隔
const MAX_RETRY_COUNT = 3
const API_BASE_URL = import.meta.env.VITE_API_TARGET

// 类型：大驼峰
interface UserProfile {}
type ApiResponse<T> = {}
```

#### 组件结构

```vue
<script setup lang="ts">
// 1. 导入
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { User } from '@/types'

// 2. Props 和 Emits
interface Props {
  userId: number
  showDetails?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showDetails: true
})

const emit = defineEmits<{
  update: [user: User]
  delete: [id: number]
}>()

// 3. 响应式状态
const user = ref<User | null>(null)
const isLoading = ref(false)

// 4. 计算属性
const fullName = computed(() => {
  return `${user.value?.firstName} ${user.value?.lastName}`
})

// 5. 方法
const fetchUser = async () => {
  isLoading.value = true
  try {
    // API 调用
  } finally {
    isLoading.value = false
  }
}

// 6. 生命周期
onMounted(() => {
  fetchUser()
})
</script>

<template>
  <div class="user-profile">
    <h1>{{ fullName }}</h1>
    <!-- 模板内容 -->
  </div>
</template>

<style scoped>
.user-profile {
  /* 样式 */
}
</style>
```

### TypeScript 规范

```typescript
// 使用接口定义对象类型
interface User {
  id: number
  name: string
  email: string
}

// 使用类型别名定义联合类型
type Status = 'pending' | 'approved' | 'rejected'

// 使用泛型
interface ApiResponse<T> {
  data: T
  message: string
  success: boolean
}

// 避免使用 any
// ❌ 不好
const data: any = fetchData()

// ✅ 好
const data: User = fetchData()
// 或者
const data: unknown = fetchData()
```

### Composables 规范

```typescript
// composables/useAuth.ts
import { ref, computed } from 'vue'
import type { User } from '@/types'

export function useAuth() {
  const user = ref<User | null>(null)
  const isAuthenticated = computed(() => user.value !== null)

  const login = async (username: string, password: string) => {
    // 登录逻辑
  }

  const logout = () => {
    user.value = null
  }

  return {
    user,
    isAuthenticated,
    login,
    logout
  }
}
```

### API 调用规范

```typescript
// api/user.ts
import request from '@/utils/request'
import type { User, ApiResponse } from '@/types'

export const userApi = {
  getUser: (id: number) => request.get<ApiResponse<User>>(`/users/${id}`),

  updateUser: (id: number, data: Partial<User>) =>
    request.put<ApiResponse<User>>(`/users/${id}`, data),

  deleteUser: (id: number) => request.delete<ApiResponse<void>>(`/users/${id}`)
}
```

### 样式规范

```vue
<style scoped>
/* 使用 scoped 避免样式污染 */

/* 使用 BEM 命名规范 */
.user-profile {
}
.user-profile__header {
}
.user-profile__content {
}
.user-profile--active {
}

/* 使用 CSS 变量 */
.button {
  background-color: var(--el-color-primary);
  padding: var(--el-spacing-md);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .user-profile {
    padding: 1rem;
  }
}
</style>
```

---

## 🔀 Pull Request 流程

### 创建 PR 前的检查清单

- [ ] 代码已通过 ESLint 检查：`npm run lint`
- [ ] 代码已通过类型检查：`npm run type-check`
- [ ] 代码已通过测试：`npm run test`
- [ ] 代码已格式化：`npm run format`
- [ ] 已添加必要的单元测试
- [ ] 已更新相关文档
- [ ] 提交消息遵循规范
- [ ] 分支已与上游 main 同步
- [ ] 已解决所有冲突

### PR 标题格式

PR 标题应该遵循提交消息规范：

```
feat: add dashboard charts
fix: resolve login validation issue
docs: update component guide
```

### PR 描述模板

````markdown
## 📝 变更说明

简要描述这个 PR 做了什么。

## 🎯 相关 Issue

Closes #123

## 🔄 变更类型

- [ ] 新功能 (feature)
- [ ] Bug 修复 (bugfix)
- [ ] 重构 (refactor)
- [ ] 文档更新 (docs)
- [ ] 样式调整 (style)
- [ ] 测试 (test)
- [ ] 其他 (chore)

## 📋 变更清单

- 添加了仪表板图表组件
- 实现了 ECharts 集成
- 添加了响应式布局
- 添加了单元测试

## 🧪 测试

描述如何测试这些变更：

```bash
# 运行单元测试
npm run test

# 运行 E2E 测试
npm run test:e2e

# 手动测试步骤
1. 登录系统
2. 访问仪表板页面
3. 验证图表正确显示
```
````

## 📸 截图

如果有 UI 变更，请添加截图：

### 桌面端

### 移动端

## ⚠️ 破坏性变更

如果有破坏性变更，请详细说明：

- 变更内容
- 迁移指南
- 影响范围

## ✅ 检查清单

- [ ] 代码已通过 ESLint 检查
- [ ] 代码已通过类型检查
- [ ] 代码已通过所有测试
- [ ] 已添加必要的单元测试
- [ ] 已更新相关文档
- [ ] 提交消息遵循规范
- [ ] 代码遵循项目规范
- [ ] UI 在桌面端和移动端都正常显示

````

### PR 审查流程

1. **提交 PR** - 创建 Pull Request
2. **自动检查** - CI/CD 自动运行 lint、type-check 和测试
3. **代码审查** - 至少需要 1 位审查者批准
4. **修改反馈** - 根据审查意见修改代码
5. **合并** - 审查通过后由维护者合并

### PR 合并策略

我们使用 **Squash and Merge** 策略：

- 所有提交会被压缩成一个提交
- 保持 main 分支历史清晰
- 合并后自动删除分支

---

## 🧪 测试要求

### 测试覆盖率要求

- **新功能**: 必须有单元测试
- **Bug 修复**: 必须有回归测试
- **重构**: 确保现有测试通过

### 运行测试

```bash
# 运行所有单元测试
npm run test

# 运行测试（watch 模式）
npm run test:watch

# 运行特定测试文件
npm run test -- auth.test.ts

# 生成测试覆盖率报告
npm run test:coverage
````

### 测试命名规范

```typescript
describe('useAuth', () => {
  it('should login successfully with valid credentials', async () => {
    // Arrange
    const { login } = useAuth()

    // Act
    await login('user@example.com', 'password123')

    // Assert
    expect(isAuthenticated.value).toBe(true)
  })

  it('should throw error with invalid credentials', async () => {
    // Arrange
    const { login } = useAuth()

    // Act & Assert
    await expect(login('invalid', 'wrong')).rejects.toThrow()
  })
})
```

### 测试示例

```typescript
// tests/unit/composables/useAuth.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useAuth } from '@/composables/useAuth'

describe('useAuth', () => {
  beforeEach(() => {
    // 重置状态
  })

  it('should initialize with no user', () => {
    const { user, isAuthenticated } = useAuth()

    expect(user.value).toBeNull()
    expect(isAuthenticated.value).toBe(false)
  })

  it('should login successfully', async () => {
    const { login, user, isAuthenticated } = useAuth()

    await login('test@example.com', 'password123')

    expect(user.value).not.toBeNull()
    expect(isAuthenticated.value).toBe(true)
  })
})
```

---

## 🔄 保持同步

### 定期同步上游仓库

```bash
# 1. 获取上游更新
git fetch upstream

# 2. 切换到 main 分支
git checkout main

# 3. 合并上游 main
git merge upstream/main

# 4. 推送到你的 fork
git push origin main

# 5. 更新你的功能分支
git checkout feature/your-feature
git rebase main
```

### 解决冲突

```bash
# 1. 尝试 rebase
git rebase upstream/main

# 2. 如果有冲突，解决冲突
# 编辑冲突文件，解决冲突标记

# 3. 标记冲突已解决
git add .

# 4. 继续 rebase
git rebase --continue

# 5. 强制推送（因为历史已改变）
git push origin feature/your-feature --force-with-lease
```

---

## 🎨 代码质量工具

### ESLint

```bash
# 运行 ESLint 检查
npm run lint

# 自动修复问题
npm run lint:fix
```

### Prettier

```bash
# 格式化代码
npm run format

# 检查格式
npm run format:check
```

### TypeScript

```bash
# 类型检查
npm run type-check

# 构建检查
npm run build:check
```

### Husky Git Hooks

项目配置了 Git hooks 来自动运行检查：

- **pre-commit**: 运行 lint-staged（格式化和 lint）
- **commit-msg**: 验证提交消息格式

---

## ❓ 常见问题

### Q: 我应该使用 merge 还是 rebase？

**A:** 使用 **rebase** 来保持历史清晰。

```bash
# ✅ 推荐
git rebase upstream/main

# ❌ 不推荐（会产生合并提交）
git merge upstream/main
```

### Q: 如何修复 ESLint 错误？

**A:** 运行自动修复：

```bash
npm run lint:fix
```

如果无法自动修复，手动修改代码。

### Q: 如何修复类型错误？

**A:** 运行类型检查查看详细错误：

```bash
npm run type-check
```

根据错误信息修复类型定义。

### Q: 提交时 commitlint 失败怎么办？

**A:** 确保提交消息遵循规范：

```bash
# ❌ 错误
git commit -m "fixed bug"

# ✅ 正确
git commit -m "fix: resolve login validation issue"
```

### Q: 如何处理依赖更新？

**A:** 定期更新依赖：

```bash
# 检查过期的依赖
npm outdated

# 更新依赖
npm update

# 更新主版本（谨慎）
npm install package@latest
```

### Q: 如何调试 Vue 组件？

**A:** 使用 Vue DevTools：

1. 安装 Vue DevTools 浏览器扩展
2. 在开发模式下运行应用
3. 打开浏览器开发者工具
4. 切换到 Vue 标签页

---

## 📞 获取帮助

如果你有任何问题：

1. 查看 [README.md](./README.md) 了解项目概览
2. 查看 [docs/](./docs/) 目录了解详细文档
3. 在 GitHub Issues 中搜索类似问题
4. 创建新的 Issue 提问

---

## 📜 许可证

通过贡献代码，你同意你的贡献将在与项目相同的许可证下发布。

---

## 🙏 感谢

感谢你为 SISM 前端项目做出贡献！每一个贡献都让项目变得更好。
