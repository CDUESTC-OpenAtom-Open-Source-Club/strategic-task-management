## 1.0.2 (2026-03-08)

### Bug Fixes

- **状态管理**: 修复指标生命周期状态与进度审批状态混淆问题 ([#指标状态Bug修复](#))
  - 分离生命周期状态（DRAFT/PENDING/DISTRIBUTED）和进度审批状态（NONE/PENDING/APPROVED/REJECTED）
  - 状态标签只显示生命周期状态，审批状态通过独立徽章显示
  - 有待审批进度时自动禁用下发按钮并显示警告提示
  - 更新后端 `IndicatorStatus` 枚举：移除 ACTIVE/ARCHIVED，新增 PENDING
  - 重构前端状态工具函数，新增 `getApprovalBadgeInfo()` 函数
  - 优化 `StrategicTaskView.vue` 状态计算和下发逻辑

### Technical Improvements

- **类型安全**: 前后端状态枚举完全对齐，消除类型歧义
- **代码质量**: 状态判断逻辑单一职责，提升可维护性
- **用户体验**: 状态显示清晰，操作逻辑合理，防止误操作

---

## 1.0.1 (2026-03-05)

### Bug Fixes

- 彻底删除所有备份文件 ([3234151](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/32341518e2d4b1a82f6f52a61959653e8aecab45))
- 实现前端 Store 层 TODO 项 ([bab47fc](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/bab47fc9701631a4d0b8a206095e9dbc5720dcc7))
- 修复多个指标相关问题（基于最新main） ([f7f7238](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/f7f7238bcb0c5f46d25676b584f8a9ecebe7c3ee))
- 修复多个UI和功能问题 ([d814ef0](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/d814ef0a8b531e6dbb790f0c48371e3b88006a83))
- 修复审批后进度不立即更新的问题，添加自动刷新页面功能 ([3b22957](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/3b2295766f36a5ba205d7d3411564ea4acfb6f33))
- 优化API健康检查功能，修复axios实例配置 ([e2d989b](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/e2d989bf983e9163a41203afd4abaa22c16be2c1))
- Bug [#3](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/issues/3) - implement indicator creation with backend persistence ([6bbbd2c](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/6bbbd2c03f9b221ac235d186ae3d6dcdcb1cd8ed))
- correct API response parsing after interceptor processing ([2cd857d](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/2cd857db957d69a958e8f5876c025505386678fb))
- remove '未分配' department default values ([ba66288](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/ba6628816945b8bf9f45e4311ce50fd65a63bed2))
- replace loadFromApi() with reloadData() in DashboardView ([5a8d5df](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/5a8d5dfdd840aefe3519eeaf94cdc09d03fa9835))
- update getAllDepartments to handle backend response format correctly ([f22588e](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/f22588ea5ca35f0579b043933773d7fb130eaa7c))

### Features

- 创建统一实体类型定义,消除"翻译层" ([2886b78](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/2886b7834493afe006378b9af3fbe3bd68e1c5ea))
- 添加Mock API插件支持 ([b448363](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/b448363af21c38a20a64d4f6baf944a49e153602))
- 修复环境变量配置并优化构建 ([cdd21b8](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/cdd21b8c0725096f3c2c312ba2be22700f034388))
- add approval API and store ([c8b5e52](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/c8b5e52292a44ac620ae2ff436865d0c8c6169bc))
- **approval:** 两级主管审批流程完整实现（前端） ([c0dcb05](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/c0dcb057a498da0f8fa3d3314d54988e3fa78d1d)), closes [#42](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/issues/42)
- change frontend port to 3500 ([7027956](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/70279562decac0ebddde726e40ab30cd1fa82bdc))
- initial commit of Vue 3 frontend application ([f9bc45f](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/f9bc45f3fec681247e6306040cc15ada099b18c8))
- merge refactor/unify-language into main ([8b3bd5c](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/8b3bd5c5b4e519f21d34000e7bba10795879900c))
- update frontend to connect to backend on port 3500 ([fac90eb](https://github.com/CDUESTC-OpenAtom-Club/strategic-task-management/commit/fac90eb4149997422893704366b781ce6f24f056))

### BREAKING CHANGES

- - Plan → StrategicTask

* Task → Milestone
* Indicator → Indicator (保持)

下一步: 迁移 Store 文件
