# Strategic Task Management 文档中心

本目录只保留前端当前仍有持续维护价值的执行文档，并将历史代码留档、阶段性材料与未来可再生成产物按统一规则分层。

## 当前状态

- 当前仓库文档治理状态：`ready_for_verification`
- 文档已按 `current / generated / archive` 三层模型整理
- 前端仓库后续新增文档必须先分类，再决定落点

## 文档分类规则

### 1. 当前执行文档

满足以下任一条件的文档，保留在 `docs/` 根目录：

- 当前仍直接服务于开发、联调、环境配置
- 当前仍直接约束前端架构、页面行为或发布流程
- 当前 README 会直接引导阅读

当前保留文档：

- `ENV_CONFIG_GUIDE.md`
  - 当前前端环境变量配置与使用说明
- `approval-center-product-draft.md`
  - 审批中心产品稿（含状态标注：已落地部分与后续迭代项）
- `测试报告/SISM-全流程功能验证报告-2026-09-22.md`
  - 2026-09-22 全流程验证记录与截图（历史证据，反映当时状态）

### 2. 可再生成文档

未来若有前端审计报告、分类台账、结构扫描结果、测试结果索引，统一放：

- `docs/generated/`

当前入口：

- `generated/README.md`

### 3. 历史归档文档

历史代码留档、一次性迁移材料、旧模块只读快照统一进入：

- `docs/archive/YYYY-MM-topic-slug/`

当前归档目录：

- `archive/2026-05-legacy-indicator-retired/`
  - 历史 `legacy-indicator` 模块只读归档

## 项目历史与治理

完整治理规则、状态流转、保留/归档/删除标准见：

- `PROJECT_HISTORY_AND_GOVERNANCE.md`

## 删除标准

以下文档默认删除，而不是继续保留：

1. 已被现行 README 或治理手册替代的旧说明。
2. 已不再约束当前代码和发布流程的阶段性设计稿。
3. 仅作为历史快照存在、但没有保留必要的散装文档。
4. 与当前目录结构不一致、并且无引用的旧入口文档。

## 验证门禁

前端文档治理完成后，固定验证：

- `npm run arch:check`
- `npm run type-check`
- `npm test`
- `npm run build`

另外必须人工检查：

- 根 `README.md` 的文档入口是否仍指向真实文件
- `docs/README.md` 与归档目录命名是否一致

## 维护规则

1. 新文档默认先判断是 `current`、`generated` 还是 `archive`。
2. 不再在 `docs/` 根目录堆放阶段性报告。
3. 历史代码留档只能放在 `archive/YYYY-MM-topic-slug/`。
4. 若删除或归档文档会影响 README，引文必须同步修正。
