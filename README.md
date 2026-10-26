# 战略指标管理系统 (SISM) - 前端

> Strategic Indicator Management System - Vue 3 前端应用

[![Vue 3](https://img.shields.io/badge/Vue-3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7.2-purple)](https://vitejs.dev/)
[![Element Plus](https://img.shields.io/badge/Element_Plus-2.9-409eff)](https://element-plus.org/)

---

## 目录

- [项目简介](#项目简介)
- [技术栈](#技术栈)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
- [联调与测试流程](#联调与测试流程)
- [文档中心](#文档中心)
- [前端分流角色](#前端分流角色)
- [许可证](#许可证)

---

## 项目简介

战略指标管理系统是一个面向组织的战略任务执行监控平台，提供：

- **可视化看板** - 实时展示战略任务完成情况、指标进度、部门对比分析
- **指标全生命周期管理** - 创建、分配、填报、审批、跟踪全流程
- **里程碑跟踪** - 按时间节点追踪指标完成进度，自动预警延期风险
- **多角色权限体系** - 战略发展部、职能部门、二级学院三级管理
- **审计日志** - 完整记录所有操作历史，支持追溯和审计

---

## 技术栈

| 类别        | 技术                | 说明                               |
| ----------- | ------------------- | ---------------------------------- |
| 前端框架    | Vue 3.5             | Composition API + `<script setup>` |
| 开发语言    | TypeScript 5.7      | 类型安全                           |
| 构建工具    | Vite 7.2            | 快速开发体验                       |
| UI 组件库   | Element Plus 2.9    | 企业级组件库                       |
| 图表库      | ECharts 5.6         | 数据可视化                         |
| 状态管理    | Pinia 3.0           | Vue 官方状态管理                   |
| 路由        | Vue Router 4.5      | 客户端路由                         |
| HTTP 客户端 | Axios 1.7           | API 请求                           |
| 测试框架    | Vitest + fast-check | 单元测试 + 属性测试                |
| 代码规范    | ESLint + Prettier   | 代码质量保证                       |

---

## 环境要求

- **Node.js** 22.x - 25.x
- **npm** >= 10.0.0

---

## 快速开始

### 1. 安装依赖

```bash
# 推荐使用 .nvmrc 中锁定的 Node 25，也可使用 Node 22 - 25
nvm use
npm install
```

### 2. 配置环境变量

```bash
# 复制前端环境变量模板
cp .env.example .env
# 统一在 .env 中维护前端配置
# 如需本机临时覆盖，再额外使用 .env.local
```

推荐做法：

- 前端只维护当前目录下的 `.env`
- 后端只维护 `../sism-backend/.env`
- 切换数据库时通常只需要修改后端 `.env`
- 前端只需要保证 `VITE_API_TARGET` 指向正确的后端地址

### 3. 启动开发服务器

```bash
# 推荐使用 .nvmrc 中锁定的 Node 25，也可使用 Node 22 - 25
nvm use
npm run dev
```

访问 http://localhost:3500 即可使用系统。

> **注意**: 需要先启动后端服务 (sism-backend)，前端才能正常工作。
>
> **推荐**: 新环境首次启动前，先阅读后端仓库的 [`../sism-backend/README.md`](../sism-backend/README.md)、[`../sism-backend/docs/` 下的 4 份 PLAN\_\* 前端测试清单](../sism-backend/docs/PLAN_APPROVAL_COLLEGE-前端测试清单.md) 和 [`../sism-backend/docs/用户账号密码文档.md`](../sism-backend/docs/用户账号密码文档.md)。

---

## 项目结构

```
src/
├── 1-app/                  # 应用入口、全局布局、路由和启动配置
├── 2-pages/                # 页面级容器（保留层）
├── 3-features/             # 功能模块（公告、消息中心、审批、计划、任务等）
├── 4-entities/             # 领域实体层
├── 5-shared/               # 共享 UI、API、工具、hooks
├── 6-processes/            # 跨 feature 过程编排
└── widgets/                # 页面级复合组件

tests/                      # Vitest / Playwright 测试
public/                     # 静态资源
scripts/                    # 构建、检查与开发辅助脚本
docs/                       # 文档中心（当前文档 / 生成产物 / 历史归档）
```

---

## 开发指南

### 可用脚本

| 命令                  | 说明                       |
| --------------------- | -------------------------- |
| `npm run dev`         | 启动开发服务器 (端口 3500) |
| `npm run build`       | 构建生产版本               |
| `npm run build:check` | TypeScript 类型检查 + 构建 |
| `npm run preview`     | 预览生产构建               |
| `npm run test`        | 运行所有测试               |
| `npm run test:watch`  | 监听模式运行测试           |
| `npm run lint`        | ESLint 检查并自动修复      |
| `npm run format`      | Prettier 格式化            |

### 代码规范

1. 使用 **Vue 3 Composition API** + `<script setup>` 语法
2. 使用 **TypeScript** 进行类型检查
3. 遵循 **ESLint** 和 **Prettier** 代码规范
4. 组件命名使用 **PascalCase**
5. 使用 **Pinia** 进行状态管理
6. API 调用统一通过 `src/5-shared/api/` 与 feature 自身 `api/` 目录
7. 为新功能编写单元测试

### 使用通用组件

```typescript
import { DataTable, DataForm, EmptyState, SkeletonLoader } from '@/components/common'
```

---

## 联调与测试流程

前端 README 只保留高频入口。真实可用的测试账号、审批链和 clean seed 数据来源以后端仓库为准，不再沿用旧 README 里的泛化账号示例。

### 推荐 smoke 顺序

1. 启动后端后先检查 [`../sism-backend/README.md`](../sism-backend/README.md) 中的健康检查、Swagger 和 OpenAPI 入口是否可访问。
2. 使用 `admin` 或 `zlb_admin` 登录，确认前端能从 `/login` 进入 `/strategic-tasks`，主链页面和核心接口正常。
3. 再按 [`../sism-backend/docs/` 下的 4 份 PLAN\_\* 前端测试清单](../sism-backend/docs/PLAN_APPROVAL_COLLEGE-前端测试清单.md) 和 4 份 `PLAN_*` 前端测试清单跑至少 1 条审批链。
4. 至少补测 1 个职能部门账号和 1 个二级学院账号，确认它们登录后默认进入 `/dashboard`，而不是战略发展部专属页面。

### 推荐审批链速查

| 流程                     | 发起账号          | 审批链                                                    | 备注                                                                 |
| ------------------------ | ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `PLAN_DISPATCH_STRATEGY` | `zlb_admin`       | `zlb_final1` -> `admin`                                   | 战略发展部主链，第三步就是全局 `admin`                               |
| `PLAN_DISPATCH_FUNCDEPT` | `jiaowu_report`   | `jiaowu_audit1` -> `jiaowu_leader`                        | 第三步按发起部门的 `ROLE_VICE_PRESIDENT` seat 解析，不是统一 `admin` |
| `PLAN_APPROVAL_FUNCDEPT` | `keji_report`     | `keji_audit1` -> `keji_leader` -> `zlb_final1`            | 职能部门审批后，先走本部门分管校领导，再走战略发展部终审             |
| `PLAN_APPROVAL_COLLEGE`  | `jisuanji_report` | `jisuanji_audit1` -> `jisuanji_leader` -> `jiaowu_audit1` | 学院终审默认落到上级职能部门审批人                                   |

### 账号和数据从哪里看

- 完整测试账号矩阵：[`../sism-backend/docs/用户账号密码文档.md`](../sism-backend/docs/用户账号密码文档.md)
- 审批流程与步骤预期：[`../sism-backend/docs/` 下的 4 份 PLAN\_\* 前端测试清单](../sism-backend/docs/PLAN_APPROVAL_COLLEGE-前端测试清单.md)
- clean seed 总入口：[`../sism-backend/database/seeds/reset-and-load-clean-seeds.sql`](../sism-backend/database/seeds/reset-and-load-clean-seeds.sql)
- seed 审阅顺序：[`../sism-backend/database/seeds/seed-review-order.md`](../sism-backend/database/seeds/seed-review-order.md)
- 审批人解析规则速记：职能部门流程里的“分管校领导”优先看发起部门自己的 `_leader / _audit2`；学院流程最后一步看 Plan 对应上级职能部门的 `_audit1`

> **注意**: `func_user / func123` 与 `college_user / college123` 已不是当前 clean seed 的有效测试账号，不要再用它们排查前后端联调问题。

---

## 文档中心

| 文档                                                   | 说明                             |
| ------------------------------------------------------ | -------------------------------- |
| [文档目录](docs/README.md)                             | 当前保留文档、归档规则与阅读顺序 |
| [项目治理手册](docs/PROJECT_HISTORY_AND_GOVERNANCE.md) | 前端目录规范、历史归档与验证门禁 |
| [环境配置指南](docs/ENV_CONFIG_GUIDE.md)               | 当前环境变量与联调配置说明       |

---

## 前端分流角色

| 前端代码值          | 归一化来源                                            | 页面行为                    | 说明                                            |
| ------------------- | ----------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| `strategic_dept`    | 登录响应里的 `orgType` / `orgName` 被前端归一化后得到 | 默认进入 `/strategic-tasks` | 表示战略发展部视图角色，不等同于某一个审批 seat |
| `functional_dept`   | 登录响应里的 `orgType` / `orgName` 被前端归一化后得到 | 默认进入 `/dashboard`       | 表示职能部门视图角色                            |
| `secondary_college` | 登录响应里的 `orgType` / `orgName` 被前端归一化后得到 | 默认进入 `/dashboard`       | 表示二级学院视图角色                            |

> **说明**: 上表是前端页面分流用的归一化角色，不是后端 clean seed 里的审批角色代码。后端当前审批角色以 `ROLE_REPORTER`、`ROLE_APPROVER`、`ROLE_STRATEGY_DEPT_HEAD`、`ROLE_VICE_PRESIDENT` 为准；具体账号与审批链请查看后端账号文档和 workflow 测试文档。

---

## 测试

```bash
# 运行所有测试
npm run test

# 运行特定测试文件
npx vitest tests/unit/formatters.spec.ts

# 监听模式
npm run test:watch
```

---

## 部署

```bash
# 构建
npm run build

# 输出目录: dist/
# 部署 dist/ 目录到静态文件服务器
```

---

## License

Private - All Rights Reserved

---

## 相关项目

- **后端项目**: [sism-backend](https://github.com/CDUESTC-OpenAtom-Club/sism-backend)
- **Vue 3 文档**: https://vuejs.org/
- **Element Plus 文档**: https://element-plus.org/
- **ECharts 文档**: https://echarts.apache.org/
