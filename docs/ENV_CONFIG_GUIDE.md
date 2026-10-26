# 环境配置指南

## 概述

本项目使用 Vite 的环境变量系统来管理不同环境的配置。所有环境变量都必须以 `VITE_` 前缀开头才能在客户端代码中访问。

## 文件说明

### 环境文件优先级

Vite 按以下优先级加载环境文件（后者覆盖前者）：

1. `.env` - 所有环境通用的基础配置
2. `.env.[mode]` - 特定环境的配置（如 `.env.development`, `.env.production`）
3. `.env.local` - 本地覆盖配置（不提交到 Git）
4. `.env.[mode].local` - 特定环境的本地覆盖配置

### 文件列表

| 文件                     | 用途                   | 是否提交到 Git |
| ------------------------ | ---------------------- | -------------- |
| `.env`                   | 基础配置，所有环境共享 | ✅ 是          |
| `.env.example`           | 配置模板，供参考       | ✅ 是          |
| `.env.development`       | 开发环境配置           | ✅ 是          |
| `.env.production`        | 生产环境配置           | ✅ 是          |
| `.env.local`             | 本地覆盖配置           | ❌ 否          |
| `.env.development.local` | 开发环境本地覆盖       | ❌ 否          |
| `.env.production.local`  | 生产环境本地覆盖       | ❌ 否          |

## 快速开始

### 开发环境

```bash
# 1. 复制配置模板
cp .env.example .env

# 2. 根据需要修改 .env
# 默认配置即可用于本地开发

# 3. 启动开发服务器
npm run dev
```

### 生产环境

```bash
# 1. 使用同一个 .env 作为前端主配置
# 2. 修改必须修改的配置项（见下方说明）
# 3. 构建生产版本
npm run build
```

### 推荐管理方式

默认建议只维护一个前端 `.env` 文件。

- 前端目录：
  - `.env`
- 后端目录：
  - `../sism-backend/.env`

这样用户体验最简单：

- 切后端数据库时，修改后端 `.env`
- 切前端联调目标时，修改前端 `.env` 中的 `VITE_API_TARGET`
- 只有本机临时覆盖时，才额外创建 `.env.local`

## 配置项说明

### API 配置

| 变量                | 说明           | 默认值                  | 必须修改     |
| ------------------- | -------------- | ----------------------- | ------------ |
| `VITE_API_BASE_URL` | API 基础路径   | `/api/v1`               | 否           |
| `VITE_API_TARGET`   | 后端服务地址   | `http://localhost:8080` | 生产环境必须 |
| `VITE_WS_BASE_URL`  | WebSocket 地址 | 自动推导                | 视情况       |

### 安全配置

| 变量               | 说明             | 默认值     | 必须修改        |
| ------------------ | ---------------- | ---------- | --------------- |
| `VITE_API_SECRET`  | API 签名密钥     | 开发默认值 | ⚠️ 生产环境必须 |
| `VITE_STORAGE_KEY` | 本地存储加密密钥 | 开发默认值 | ⚠️ 生产环境必须 |

**生成安全密钥：**

```bash
openssl rand -base64 32
```

### 功能开关

| 变量                                  | 说明           | 默认值  | 生产环境建议 |
| ------------------------------------- | -------------- | ------- | ------------ |
| `VITE_USE_MOCK`                       | Mock 模式      | `false` | 必须 `false` |
| `VITE_ENABLE_WEBSOCKET_NOTIFICATIONS` | WebSocket 通知 | `false` | 视情况       |
| `VITE_ENABLE_DEVTOOLS`                | 开发工具       | `true`  | 必须 `false` |
| `VITE_ENABLE_API_HEALTH_CHECK`        | API 健康检查   | `false` | 建议 `true`  |
| `VITE_ENABLE_ALERTS_API`              | 告警 API       | `false` | 视情况       |

### 日志配置

| 变量                     | 说明     | 开发环境 | 生产环境 |
| ------------------------ | -------- | -------- | -------- |
| `VITE_LOG_LEVEL`         | 日志级别 | `debug`  | `warn`   |
| `VITE_LOG_API_REQUESTS`  | 请求日志 | `true`   | `false`  |
| `VITE_LOG_API_RESPONSES` | 响应日志 | `true`   | `false`  |

**日志级别说明：**

- `debug` - 详细调试信息
- `info` - 一般信息
- `warn` - 警告信息
- `error` - 仅错误信息

### 请求配置

| 变量                       | 说明                 | 默认值  |
| -------------------------- | -------------------- | ------- |
| `VITE_REQUEST_TIMEOUT`     | 请求超时时间（毫秒） | `30000` |
| `VITE_REQUEST_RETRY_COUNT` | 重试次数             | `3`     |
| `VITE_REQUEST_RETRY_DELAY` | 重试延迟（毫秒）     | `1000`  |

### UI 配置

| 变量                     | 说明         | 默认值  |
| ------------------------ | ------------ | ------- |
| `VITE_DEFAULT_LOCALE`    | 默认语言     | `zh-CN` |
| `VITE_DEFAULT_THEME`     | 默认主题     | `light` |
| `VITE_DEFAULT_PAGE_SIZE` | 默认分页大小 | `20`    |

### 应用信息

| 变量                   | 说明     | 默认值                                  |
| ---------------------- | -------- | --------------------------------------- |
| `VITE_APP_TITLE`       | 应用标题 | `战略指标管理系统`                      |
| `VITE_APP_VERSION`     | 应用版本 | `1.0.0`                                 |
| `VITE_APP_DESCRIPTION` | 应用描述 | `Strategic Indicator Management System` |

## 安全注意事项

### 敏感信息处理

1. **绝对不要**将真实的密钥、密码等敏感信息提交到代码仓库
2. 使用 `.env.local` 文件存储本地敏感配置（已在 `.gitignore` 中排除）
3. 生产环境密钥应通过 CI/CD 环境变量注入

### 生产环境部署检查清单

部署前请确认以下配置项已正确设置：

- [ ] `VITE_API_TARGET` 已修改为生产环境 API 地址
- [ ] `VITE_API_SECRET` 已使用随机生成的密钥
- [ ] `VITE_STORAGE_KEY` 已使用随机生成的密钥
- [ ] `VITE_USE_MOCK` 设置为 `false`
- [ ] `VITE_ENABLE_DEVTOOLS` 设置为 `false`
- [ ] `VITE_LOG_LEVEL` 设置为 `warn` 或 `error`

## 常见问题

### Q: 如何切换到 Mock 模式？

修改 `.env.development` 中的 `VITE_USE_MOCK=true`，然后重启开发服务器。

### Q: 如何在本地连接不同的后端服务？

创建 `.env.local` 文件，覆盖 `VITE_API_TARGET`：

```bash
VITE_API_TARGET=http://192.168.1.100:8080
```

### Q: 环境变量没有生效怎么办？

1. 确认变量名以 `VITE_` 开头
2. 重启开发服务器（修改环境变量后必须重启）
3. 检查是否有更高优先级的 `.env.local` 文件覆盖了配置

### Q: 如何查看当前生效的环境变量？

启动开发服务器时，Vite 会在控制台输出当前的配置信息。也可以在代码中使用 `import.meta.env` 查看。

## 相关文档

- [Vite 环境变量文档](https://vitejs.dev/guide/env-and-mode.html)
- [项目治理文档](PROJECT_HISTORY_AND_GOVERNANCE.md)
