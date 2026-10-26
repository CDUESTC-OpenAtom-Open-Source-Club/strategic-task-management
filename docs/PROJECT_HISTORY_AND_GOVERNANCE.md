# Strategic Task Management 项目历史与目录治理手册

## Summary

本文件用于定义前端仓库 `strategic-task-management` 的目录归纳、文档分类、历史归档和验证门禁，确保前端项目结构在持续演进后依然可读、可追踪、可发布。

## 当前目录结构

前端仓库当前主结构：

- `src/1-app`
- `src/2-pages`
- `src/3-features`
- `src/4-entities`
- `src/5-shared`
- `src/6-processes`
- `src/widgets`
- `public`
- `docs`
- `scripts`
- `tests`

## 文档治理模型

### current

定义：

- 当前仍直接服务于开发、环境配置、联调、发布的文档

位置：

- `docs/`

### generated

定义：

- 可由脚本、检查器、审计流程重复生成的文档和索引

位置：

- `docs/generated/`

### archive

定义：

- 历史模块快照
- 一次性设计稿
- 阶段性治理材料
- 不再直接参与当前实现的历史留档

位置：

- `docs/archive/YYYY-MM-topic-slug/`

### delete

定义：

- 无引用、无现行约束力、无历史保留必要性的旧文档

处理方式：

- 直接删除，不保留目录占位

## 项目状态流转

前端治理工作统一使用以下状态：

- `draft`
- `in_progress`
- `ready_for_verification`
- `verified`
- `ready_for_release`

当前本轮状态建议记为：

- `ready_for_verification`

## 当前保留原则

满足以下任一条件的文档应保留：

1. 根 `README.md` 直接引用。
2. 当前环境配置、联调、架构治理仍依赖。
3. 当前页面或模块行为仍需要作为执行说明。

## 当前验证门禁

前端目录治理完成后，固定执行：

- `npm run arch:check`
- `npm run type-check`
- `npm test`
- `npm run build`

此外必须人工检查：

- 根 `README.md` 的文档中心是否与实际 docs 一致
- `docs/archive/` 命名是否统一
- `docs/generated/` 是否与手写文档分离

## 发布前要求

本仓库发布入口为（合并到 `main` 只构建镜像，**不会自动部署**）：

- `main`

推送前必须确认：

1. 目录整理后 README 不含失效链接。
2. 文档入口与真实结构一致。
3. 本地验证通过。
4. 已先向你完成本地汇报，再决定是否推送。
