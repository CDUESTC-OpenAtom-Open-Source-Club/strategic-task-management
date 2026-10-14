# 2026-05 前端目录治理整理报告

## 当前状态

- 状态：`verified`
- 范围：`strategic-task-management` 仓库内目录与文档治理

## 本轮保留

- `docs/ENV_CONFIG_GUIDE.md`
- `docs/README.md`
- `docs/PROJECT_HISTORY_AND_GOVERNANCE.md`
- `docs/generated/README.md`

## 本轮归档

- `docs/archive/2026-05-legacy-indicator-retired/`
  - 历史 `legacy-indicator` 模块只读快照

## 本轮修正

- 根 `README.md` 的项目结构说明已改为当前编号式前端目录结构
- 根 `README.md` 的文档中心入口已改为真实存在的文档
- `docs/README.md` 从静态说明升级为当前文档中心

## 删除说明

- 本轮未直接删除前端仓库内文档文件。
- 现有历史材料均已收口到归档目录，优先保留追溯能力。
- 失效的是旧 README 中的文档链接，而不是仓库内仍需保留的文件实体。

## 验证结果

- `npm run arch:check` 通过
- `npm run type-check` 通过
- `npm test` 通过
- `npm run build` 通过

## 备注

- 当前自动部署入口仍为 `main`。
- 前端 `main` 推送后仍会触发镜像构建并 dispatch 后端部署流。
