<script setup lang="ts">
import {
  Download,
  Warning,
  Aim,
  Refresh,
  QuestionFilled,
  Top,
  Close
} from '@element-plus/icons-vue'
import BreadcrumbNav from '@/shared/ui/layout/BreadcrumbNav.vue'
import ScoreCompositionChart from '@/shared/ui/charts/ScoreCompositionChart.vue'
import AlertDistributionChart from '@/shared/ui/charts/AlertDistributionChart.vue'
import DepartmentProgressChart from './DepartmentProgressChart.vue'
import TaskSankeyChart from '@/shared/ui/charts/TaskSankeyChart.vue'
import SourcePieChart from '@/shared/ui/charts/SourcePieChart.vue'
import {
  useDashboardView,
  type DashboardViewProps
} from '@/features/dashboard/model/useDashboardView'

const props = defineProps<DashboardViewProps>()

const {
  _benchmarkChartHeight,
  _benchmarkViewMode,
  _departmentOptions,
  _getBenchmarkTitle,
  _getDepartmentCardTitle,
  _getDeptStats,
  _handleBenchmarkClick,
  _handleFilterApply,
  _hasActiveFilters,
  _kpiCards,
  _radarStats,
  _resetFilters,
  _showFilterFeature,
  applyFilters,
  authStore,
  availableFunctionalDepts,
  baseDelayedTasks,
  benchmarkChartRef,
  benchmarkData,
  canViewAllDepartments,
  collegeBarData,
  collegeChartRef,
  collegeMonthIndicatorStats,
  collegeMonthIndicators,
  collegeMonthlyStackedData,
  collegeRankingChartRef,
  collegeRankingMonth,
  collegeSelectedMonth,
  createChartInstance,
  currentDepartment,
  currentRole,
  dashboardData,
  dashboardStore,
  delayedTasks,
  drilledCollege,
  drilledDept,
  filterForm,
  filteredCollegeMonthIndicators,
  filteredDeptIndicators,
  filteredMonthIndicators,
  getCollegeRankingData,
  getCollegeStatsForFunctionalDept,
  getCurrentMilestoneIndex,
  getCurrentTargetProgress,
  getDeptStatsAtMonth,
  getIndicatorStatus,
  getStatusClass,
  getStatusText,
  handleAlertClick,
  handleBackToColleges,
  handleBackToDepts,
  handleBreadcrumbNavigate,
  handleCloseCollegeMonthIndicatorCard,
  handleCloseIndicatorCard,
  handleCloseMonthIndicatorCard,
  handleCollegeMonthChange,
  handleCollegeRankingMonthChange,
  handleExport,
  handleMonthChange,
  handleOwnerDeptFilterChange,
  handleResize,
  handleSankeyLinkClick,
  handleSankeyNodeClick,
  handleSourceClick,
  handleStatusFilterClick,
  handleUrge,
  helpTexts,
  initBenchmarkChart,
  initCollegeChart,
  initCollegeRankingChart,
  initRadarChart,
  isChartContainerReady,
  isCollegeDrillDown,
  isDataEmpty,
  isDataLoading,
  isDrillDown,
  isFallbackMode,
  loadEcharts,
  loadReminderStatuses,
  messageStore,
  monthIndicatorStats,
  monthIndicators,
  monthlyStackedData,
  orgStore,
  radarChartRef,
  radarData,
  reloadData,
  reminderStatuses,
  remindingMap,
  selectedBenchmarkDept,
  selectedDeptIndicators,
  selectedDeptStats,
  selectedMonth,
  selectedMonthInCollegeDrillDown,
  selectedMonthInDrillDown,
  selectedOwnerDeptFilter,
  selectedStatusFilter,
  pageHasError,
  showSkeleton,
  showCollegeMonthIndicatorCard,
  showFilterPanel,
  showIndicatorCard,
  showMonthIndicatorCard,
  stackedBarData,
  statusColors,
  strategicStore,
  timeContext
} = useDashboardView(props)
</script>

<template>
  <div class="dashboard-view">
    <!-- 顶部工具栏 -->
    <div class="dashboard-toolbar">
      <div class="toolbar-right">
        <el-button type="primary" :icon="Download" @click="handleExport">导出报表</el-button>
      </div>
    </div>

    <!-- 降级模式提示 - Requirements 1.4, 10.5 -->
    <el-alert
      v-if="isFallbackMode"
      title="降级模式"
      type="warning"
      show-icon
      :closable="false"
      class="fallback-mode-alert"
    >
      <template #default>
        <span class="fallback-alert-content">
          当前使用离线数据，部分功能可能受限。
          <el-button link type="primary" size="small" @click="reloadData()">
            <el-icon><Refresh /></el-icon>
            重新连接
          </el-button>
        </span>
      </template>
    </el-alert>

    <!-- 加载状态骨架屏 - Requirement 1.5 -->
    <template v-if="isDataLoading || showSkeleton">
      <!-- AI 摘要骨架屏 -->
      <section class="ai-summary-card skeleton-card">
        <div class="summary-icon">
          <el-skeleton-item variant="circle" style="width: 48px; height: 48px" />
        </div>
        <div class="summary-content" style="flex: 1">
          <el-skeleton :rows="2" animated />
        </div>
        <div class="summary-stats">
          <el-skeleton-item variant="rect" style="width: 80px; height: 40px" />
        </div>
      </section>

      <!-- 图表区域骨架屏 -->
      <el-row :gutter="16" class="chart-section">
        <el-col v-for="i in 3" :key="i" :xs="24" :md="8">
          <el-card shadow="hover" class="chart-card">
            <template #header>
              <el-skeleton-item variant="text" style="width: 120px" />
            </template>
            <el-skeleton :rows="6" animated />
          </el-card>
        </el-col>
      </el-row>

      <!-- 部门排名骨架屏 -->
      <div class="chart-section deep-charts benchmark-section">
        <div class="benchmark-col">
          <el-card shadow="hover" class="chart-card glass-card">
            <template #header>
              <el-skeleton-item variant="text" style="width: 200px" />
            </template>
            <el-skeleton :rows="8" animated />
          </el-card>
        </div>
      </div>
    </template>

    <!-- 数据为空状态 - Requirement 1.6 -->
    <template v-else-if="isDataEmpty">
      <section class="empty-state-container">
        <el-empty description="暂无数据" :image-size="200">
          <template #description>
            <div class="empty-description">
              <p>当前没有可显示的指标数据</p>
              <p class="empty-hint">请检查数据源或联系管理员</p>
            </div>
          </template>
          <el-button type="primary" @click="reloadData()">
            <el-icon><Refresh /></el-icon>
            重新加载
          </el-button>
        </el-empty>
      </section>
    </template>

    <!-- 错误状态提示 -->
    <template v-else-if="pageHasError">
      <section class="error-state-container">
        <el-alert
          :title="pageErrorMessage || '数据加载失败'"
          type="error"
          show-icon
          :closable="false"
        >
          <template #default>
            <div class="error-actions">
              <el-button type="primary" size="small" @click="reloadData()">
                <el-icon><Refresh /></el-icon>
                重试
              </el-button>
            </div>
          </template>
        </el-alert>
      </section>
    </template>

    <!-- 正常数据展示 -->
    <template v-else>
      <!-- AI 智能摘要卡片 -->
      <section class="ai-summary-card">
        <div class="summary-icon">
          <el-icon :size="28"><Aim /></el-icon>
        </div>
        <div class="summary-content">
          <div class="summary-header">
            <span class="summary-tag">AI Intelligence Briefing</span>
            <span class="summary-time">| UPDATE: {{ new Date().toLocaleDateString() }}</span>
          </div>
          <p class="summary-text">
            全校战略执行总分 <span class="highlight-primary">{{ dashboardData.totalScore }}</span
            >。
            <template v-if="dashboardData.alertIndicators.severe > 0">
              {{ selectedMonth }}月存在
              <span class="highlight-danger"
                >{{ dashboardData.alertIndicators.severe }} 项严重预警</span
              >
              任务需重点关注。
            </template>
            <template v-else>
              {{ selectedMonth }}月整体执行状态良好，<span class="highlight-success"
                >无严重预警</span
              >。
            </template>
            完成率达 <span class="highlight-success">{{ dashboardData.completionRate }}%</span>，
            {{ dashboardData.completionRate >= 80 ? '进度符合预期' : '建议加快推进滞后任务' }}。
            <button type="button" class="drill-btn">立即下钻诊断 →</button>
          </p>
        </div>
        <div class="summary-stats">
          <div class="mini-stat">
            <div class="mini-label">健康度</div>
            <div
              class="mini-value"
              :class="dashboardData.completionRate >= 70 ? 'success' : 'warning'"
            >
              {{ Math.min(100, dashboardData.completionRate + 10) }}%
            </div>
          </div>
          <div class="mini-stat">
            <div class="mini-label">响应率</div>
            <div class="mini-value primary">
              {{ (2.4 - dashboardData.alertIndicators.severe * 0.1).toFixed(1) }}h
            </div>
          </div>
        </div>
      </section>
      <!-- 面包屑导航 -->
      <BreadcrumbNav
        v-if="dashboardStore.breadcrumbs.length > 1"
        :items="dashboardStore.breadcrumbs"
        @navigate="handleBreadcrumbNavigate"
      />

      <!-- KPI 核心矩阵（升级版）- 暂时隐藏 -->
      <!--
    <el-row :gutter="16" class="stat-cards">
      <el-col v-for="(kpi, idx) in kpiCards" :key="idx" :xs="24" :sm="12" :md="6">
        <div class="kpi-card" :class="'kpi-' + kpi.gradient">
          <div class="kpi-header">
            <div class="header-left" style="display: flex; align-items: center; gap: 4px;">
              <span class="kpi-label">{{ kpi.label }}</span>
              <el-tooltip :content="kpi.helpText" placement="top" effect="light">
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </div>
            <div class="kpi-trend" :class="kpi.isUp ? 'up' : 'down'">
              <el-icon v-if="kpi.isUp"><Top /></el-icon>
              <el-icon v-else><Bottom /></el-icon>
              {{ kpi.trend }}%
            </div>
          </div>
          <div class="kpi-body">
            <span class="kpi-value">{{ kpi.value }}</span>
            <span class="kpi-unit">{{ kpi.unit }}</span>
          </div>
          <div class="kpi-footer">
            <span class="kpi-predict">预测: {{ kpi.predict }}{{ kpi.unit }}</span>
            <span class="kpi-desc">{{ kpi.desc }}</span>
          </div>
          <div class="kpi-progress">
            <div class="kpi-progress-bar" :style="{ width: kpi.percent + '%' }"></div>
          </div>
        </div>
      </el-col>
    </el-row>
    -->

      <!-- 中间深度图表层 -->
      <div
        class="chart-section deep-charts benchmark-section"
        :class="{ 'has-detail': showIndicatorCard || showMonthIndicatorCard }"
      >
        <!-- 部门排名对标（仅战略发展部显示） -->
        <div v-if="currentRole === 'strategic_dept'" class="benchmark-col">
          <el-card shadow="hover" class="chart-card glass-card benchmark-card">
            <template #header>
              <div class="card-header benchmark-header">
                <div class="header-left">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title benchmark-title">
                      {{ isDrillDown ? `${drilledDept} - 月度趋势` : '指标完成情况分布' }}
                      <span class="title-tag-italic">{{
                        isDrillDown ? 'TREND' : 'DISTRIBUTION'
                      }}</span>
                    </span>
                    <el-tooltip
                      :content="
                        isDrillDown
                          ? '显示该部门每月的指标完成情况'
                          : '显示各职能部门的指标完成情况分布'
                      "
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                  <span class="card-subtitle">
                    {{
                      isDrillDown
                        ? '1月 - 当前月度趋势分析'
                        : `${selectedMonth}月 · 按状态统计 · 点击柱形查看趋势`
                    }}
                  </span>
                </div>
                <div class="header-right">
                  <!-- 下钻状态显示返回按钮 -->
                  <el-button
                    v-if="isDrillDown"
                    type="primary"
                    size="small"
                    class="back-btn"
                    @click="handleBackToDepts"
                  >
                    <el-icon><Top /></el-icon>
                    返回部门视图
                  </el-button>
                  <!-- 月份筛选器 -->
                  <div v-else class="month-filter">
                    <span class="filter-label">月份:</span>
                    <el-select
                      v-model="selectedMonth"
                      size="small"
                      class="month-select"
                      @change="handleMonthChange"
                    >
                      <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
                    </el-select>
                  </div>
                </div>
              </div>
            </template>
            <div ref="benchmarkChartRef" class="benchmark-chart"></div>
          </el-card>
        </div>

        <!-- 指标完成情况卡片（选中部门后显示，下钻时隐藏） -->
        <div
          v-if="currentRole !== 'secondary_college' && !isDrillDown"
          class="indicator-col"
          :class="{ visible: showIndicatorCard }"
        >
          <div class="indicator-card-wrapper">
            <el-card
              v-show="selectedBenchmarkDept"
              shadow="hover"
              class="chart-card glass-card indicator-status-card"
            >
              <template #header>
                <div class="card-header benchmark-header">
                  <div class="header-left">
                    <div style="display: flex; align-items: center; gap: 4px">
                      <span class="card-title benchmark-title"
                        >指标完成情况 <span class="title-tag-italic">STATUS</span></span
                      >
                      <el-tooltip
                        content="展示选中部门接收的各项指标及其完成状态"
                        placement="top"
                        effect="light"
                      >
                        <el-icon class="help-icon"><QuestionFilled /></el-icon>
                      </el-tooltip>
                    </div>
                    <span class="card-subtitle"
                      >{{ selectedBenchmarkDept }} ·
                      {{ selectedDeptIndicators.length }} 项指标</span
                    >
                  </div>
                  <div class="header-right">
                    <el-button link type="primary" size="small" @click="handleCloseIndicatorCard">
                      <el-icon><Close /></el-icon>
                      关闭
                    </el-button>
                  </div>
                </div>
              </template>
              <div class="indicator-status-list">
                <!-- 状态统计摘要 -->
                <div v-if="selectedDeptIndicators.length > 0" class="status-summary">
                  <span
                    class="status-summary-item ahead"
                    :class="{ active: selectedStatusFilter === 'ahead' }"
                    @click="handleStatusFilterClick('ahead')"
                  >
                    <span class="status-dot"></span>超前 {{ selectedDeptStats.ahead }}
                  </span>
                  <span
                    class="status-summary-item normal"
                    :class="{ active: selectedStatusFilter === 'normal' }"
                    @click="handleStatusFilterClick('normal')"
                  >
                    <span class="status-dot"></span>正常 {{ selectedDeptStats.normal }}
                  </span>
                  <span
                    class="status-summary-item warning"
                    :class="{ active: selectedStatusFilter === 'warning' }"
                    @click="handleStatusFilterClick('warning')"
                  >
                    <span class="status-dot"></span>预警 {{ selectedDeptStats.warning }}
                  </span>
                  <span
                    class="status-summary-item delayed"
                    :class="{ active: selectedStatusFilter === 'delayed' }"
                    @click="handleStatusFilterClick('delayed')"
                  >
                    <span class="status-dot"></span>延期 {{ selectedDeptStats.delayed }}
                  </span>
                </div>
                <div v-if="selectedDeptIndicators.length === 0" class="empty-indicator-list">
                  <el-empty description="该部门暂无接收的指标" :image-size="80" />
                </div>
                <div v-else-if="filteredDeptIndicators.length === 0" class="empty-indicator-list">
                  <el-empty description="没有符合筛选条件的指标" :image-size="80" />
                </div>
                <div v-else class="indicator-scroll-container">
                  <el-popover
                    v-for="indicator in filteredDeptIndicators"
                    :key="indicator.id"
                    placement="left"
                    :width="320"
                    trigger="hover"
                    popper-class="indicator-detail-popover"
                  >
                    <template #reference>
                      <div class="indicator-status-item" :class="getStatusClass(indicator.status)">
                        <div class="indicator-info">
                          <div class="indicator-name" :title="indicator.name">
                            {{ indicator.name }}
                          </div>
                          <div class="indicator-meta">
                            <span
                              class="indicator-type-tag"
                              :class="
                                indicator.type1 === '定性'
                                  ? 'type-qualitative'
                                  : 'type-quantitative'
                              "
                              >{{ indicator.type1 }}</span
                            >
                            <span class="indicator-progress">进度: {{ indicator.progress }}%</span>
                          </div>
                        </div>
                        <div
                          class="indicator-status-badge"
                          :class="getStatusClass(indicator.status)"
                        >
                          {{ getStatusText(indicator.status) }}
                        </div>
                      </div>
                    </template>
                    <div class="indicator-detail-content">
                      <h4 class="detail-title">{{ indicator.name }}</h4>
                      <div class="detail-row">
                        <span class="detail-label">指标类型</span>
                        <span class="detail-value">{{ indicator.type1 }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">当前进度</span>
                        <span class="detail-value">
                          <el-progress
                            :percentage="indicator.progress"
                            :stroke-width="8"
                            :color="
                              indicator.progress >= 80
                                ? '#67c23a'
                                : indicator.progress >= 50
                                  ? '#e6a23c'
                                  : '#f56c6c'
                            "
                            style="width: 120px; display: inline-flex"
                          />
                        </span>
                      </div>
                      <div
                        v-if="indicator.targetProgress !== null || indicator.milestoneIndex"
                        class="detail-row"
                      >
                        <span class="detail-label">目标进度</span>
                        <span class="detail-value"
                          >{{
                            indicator.targetProgress !== null
                              ? indicator.targetProgress + '%'
                              : '-'
                          }}{{
                            indicator.milestoneIndex ? ' (' + indicator.milestoneIndex + ')' : ''
                          }}</span
                        >
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">权重</span>
                        <span class="detail-value">{{ indicator.weight }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">所属战略任务</span>
                        <span class="detail-value task-content">{{
                          indicator.taskContent || '未关联'
                        }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">完成状态</span>
                        <span class="detail-value">
                          <span class="status-tag" :class="getStatusClass(indicator.status)">
                            {{ getStatusText(indicator.status) }}
                          </span>
                        </span>
                      </div>
                    </div>
                  </el-popover>
                </div>
              </div>
            </el-card>
          </div>
        </div>

        <!-- 下钻后月份指标卡片（点击月份柱子后显示） -->
        <div
          v-if="currentRole === 'strategic_dept' && isDrillDown"
          class="indicator-col"
          :class="{ visible: showMonthIndicatorCard }"
        >
          <div class="indicator-card-wrapper">
            <el-card
              v-show="selectedMonthInDrillDown !== null"
              shadow="hover"
              class="chart-card glass-card indicator-status-card"
            >
              <template #header>
                <div class="card-header benchmark-header">
                  <div class="header-left">
                    <div style="display: flex; align-items: center; gap: 4px">
                      <span class="card-title benchmark-title">
                        {{ drilledDept }} - {{ selectedMonthInDrillDown }}月指标
                        <span class="title-tag-italic">DETAIL</span>
                      </span>
                      <el-tooltip
                        content="展示选中部门在该月份的各项指标及其完成状态"
                        placement="top"
                        effect="light"
                      >
                        <el-icon class="help-icon"><QuestionFilled /></el-icon>
                      </el-tooltip>
                    </div>
                    <span class="card-subtitle">
                      {{ selectedMonthInDrillDown }}月完成情况 · {{ monthIndicators.length }} 项指标
                    </span>
                  </div>
                  <div class="header-right">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      @click="handleCloseMonthIndicatorCard"
                    >
                      <el-icon><Close /></el-icon>
                      关闭
                    </el-button>
                  </div>
                </div>
              </template>
              <div class="indicator-status-list">
                <!-- 状态统计摘要 -->
                <div v-if="monthIndicators.length > 0" class="status-summary">
                  <span
                    class="status-summary-item ahead"
                    :class="{ active: selectedStatusFilter === 'ahead' }"
                    @click="handleStatusFilterClick('ahead')"
                  >
                    <span class="status-dot"></span>超前 {{ monthIndicatorStats.ahead }}
                  </span>
                  <span
                    class="status-summary-item normal"
                    :class="{ active: selectedStatusFilter === 'normal' }"
                    @click="handleStatusFilterClick('normal')"
                  >
                    <span class="status-dot"></span>正常 {{ monthIndicatorStats.normal }}
                  </span>
                  <span
                    class="status-summary-item warning"
                    :class="{ active: selectedStatusFilter === 'warning' }"
                    @click="handleStatusFilterClick('warning')"
                  >
                    <span class="status-dot"></span>预警 {{ monthIndicatorStats.warning }}
                  </span>
                  <span
                    class="status-summary-item delayed"
                    :class="{ active: selectedStatusFilter === 'delayed' }"
                    @click="handleStatusFilterClick('delayed')"
                  >
                    <span class="status-dot"></span>延期 {{ monthIndicatorStats.delayed }}
                  </span>
                </div>
                <div v-if="monthIndicators.length === 0" class="empty-indicator-list">
                  <el-empty description="该月份暂无指标数据" :image-size="80" />
                </div>
                <div v-else-if="filteredMonthIndicators.length === 0" class="empty-indicator-list">
                  <el-empty description="没有符合筛选条件的指标" :image-size="80" />
                </div>
                <div v-else class="indicator-scroll-container">
                  <el-popover
                    v-for="indicator in filteredMonthIndicators"
                    :key="indicator.id"
                    placement="left"
                    :width="320"
                    trigger="hover"
                    popper-class="indicator-detail-popover"
                  >
                    <template #reference>
                      <div class="indicator-status-item" :class="getStatusClass(indicator.status)">
                        <div class="indicator-info">
                          <div class="indicator-name" :title="indicator.name">
                            {{ indicator.name }}
                          </div>
                          <div class="indicator-meta">
                            <span
                              class="indicator-type-tag"
                              :class="
                                indicator.type1 === '定性'
                                  ? 'type-qualitative'
                                  : 'type-quantitative'
                              "
                              >{{ indicator.type1 }}</span
                            >
                            <span class="indicator-progress">进度: {{ indicator.progress }}%</span>
                          </div>
                        </div>
                        <div
                          class="indicator-status-badge"
                          :class="getStatusClass(indicator.status)"
                        >
                          {{ getStatusText(indicator.status) }}
                        </div>
                      </div>
                    </template>
                    <div class="indicator-detail-content">
                      <h4 class="detail-title">{{ indicator.name }}</h4>
                      <div class="detail-row">
                        <span class="detail-label">指标类型</span>
                        <span class="detail-value">{{ indicator.type1 }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">当前进度</span>
                        <span class="detail-value">
                          <el-progress
                            :percentage="indicator.progress"
                            :stroke-width="8"
                            :color="
                              indicator.progress >= 80
                                ? '#67c23a'
                                : indicator.progress >= 50
                                  ? '#e6a23c'
                                  : '#f56c6c'
                            "
                            style="width: 120px; display: inline-flex"
                          />
                        </span>
                      </div>
                      <div
                        v-if="indicator.targetProgress !== null || indicator.milestoneIndex"
                        class="detail-row"
                      >
                        <span class="detail-label">目标进度</span>
                        <span class="detail-value"
                          >{{
                            indicator.targetProgress !== null
                              ? indicator.targetProgress + '%'
                              : '-'
                          }}{{
                            indicator.milestoneIndex ? ' (' + indicator.milestoneIndex + ')' : ''
                          }}</span
                        >
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">权重</span>
                        <span class="detail-value">{{ indicator.weight }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">所属战略任务</span>
                        <span class="detail-value task-content">{{
                          indicator.taskContent || '未关联'
                        }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">完成状态</span>
                        <span class="detail-value">
                          <span class="status-tag" :class="getStatusClass(indicator.status)">
                            {{ getStatusText(indicator.status) }}
                          </span>
                        </span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">统计月份</span>
                        <span class="detail-value">{{ selectedMonthInDrillDown }}月</span>
                      </div>
                    </div>
                  </el-popover>
                </div>
              </div>
            </el-card>
          </div>
        </div>
      </div>

      <!-- 学院看板（职能部门 + 战略发展部视角） -->
      <div
        v-if="currentRole === 'functional_dept' || currentRole === 'strategic_dept'"
        class="chart-section deep-charts college-section"
        :class="{ 'has-detail': showCollegeMonthIndicatorCard }"
      >
        <div class="college-col">
          <el-card shadow="hover" class="chart-card glass-card college-card">
            <template #header>
              <div class="card-header college-header">
                <div class="header-left">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title college-title">
                      {{ isCollegeDrillDown ? `${drilledCollege} - 月度趋势` : '学院指标完成情况' }}
                      <span class="title-tag-italic">{{
                        isCollegeDrillDown ? 'TREND' : 'COLLEGE'
                      }}</span>
                    </span>
                    <el-tooltip
                      :content="
                        isCollegeDrillDown
                          ? '显示该学院每月的指标完成情况'
                          : '显示各学院的指标完成情况分布'
                      "
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                  <span class="card-subtitle">
                    {{
                      isCollegeDrillDown
                        ? '1月 - 当前月度趋势分析'
                        : `${collegeSelectedMonth}月 · 按状态统计 · 点击柱形查看趋势`
                    }}
                  </span>
                </div>
                <div class="header-right">
                  <!-- 下钻状态显示返回按钮 -->
                  <el-button
                    v-if="isCollegeDrillDown"
                    type="primary"
                    size="small"
                    class="back-btn"
                    @click="handleBackToColleges"
                  >
                    <el-icon><Top /></el-icon>
                    返回学院视图
                  </el-button>
                  <!-- 月份筛选器 -->
                  <div v-else class="month-filter">
                    <span class="filter-label">月份:</span>
                    <el-select
                      v-model="collegeSelectedMonth"
                      size="small"
                      class="month-select"
                      @change="handleCollegeMonthChange"
                    >
                      <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
                    </el-select>
                  </div>
                </div>
              </div>
            </template>
            <div ref="collegeChartRef" class="college-chart"></div>
          </el-card>
        </div>

        <!-- 学院月份指标卡片（点击月份柱子后显示） -->
        <div
          v-if="isCollegeDrillDown"
          class="indicator-col"
          :class="{ visible: showCollegeMonthIndicatorCard }"
        >
          <div class="indicator-card-wrapper">
            <el-card
              v-show="selectedMonthInCollegeDrillDown !== null"
              shadow="hover"
              class="chart-card glass-card indicator-status-card"
            >
              <template #header>
                <div class="card-header benchmark-header">
                  <div class="header-left">
                    <div style="display: flex; align-items: center; gap: 4px">
                      <span class="card-title benchmark-title">
                        {{ drilledCollege }} - {{ selectedMonthInCollegeDrillDown }}月指标
                        <span class="title-tag-italic">DETAIL</span>
                      </span>
                      <el-tooltip
                        content="展示选中学院在该月份的各项指标及其完成状态"
                        placement="top"
                        effect="light"
                      >
                        <el-icon class="help-icon"><QuestionFilled /></el-icon>
                      </el-tooltip>
                    </div>
                    <span class="card-subtitle">
                      {{ selectedMonthInCollegeDrillDown }}月完成情况 ·
                      {{ collegeMonthIndicators.length }} 项指标
                    </span>
                  </div>
                  <div class="header-right">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      @click="handleCloseCollegeMonthIndicatorCard"
                    >
                      <el-icon><Close /></el-icon>
                      关闭
                    </el-button>
                  </div>
                </div>
              </template>
              <div class="indicator-status-list">
                <!-- 状态统计摘要 -->
                <div v-if="collegeMonthIndicators.length > 0" class="status-summary">
                  <span
                    class="status-summary-item ahead"
                    :class="{ active: selectedStatusFilter === 'ahead' }"
                    @click="handleStatusFilterClick('ahead')"
                  >
                    <span class="status-dot"></span>超前 {{ collegeMonthIndicatorStats.ahead }}
                  </span>
                  <span
                    class="status-summary-item normal"
                    :class="{ active: selectedStatusFilter === 'normal' }"
                    @click="handleStatusFilterClick('normal')"
                  >
                    <span class="status-dot"></span>正常 {{ collegeMonthIndicatorStats.normal }}
                  </span>
                  <span
                    class="status-summary-item warning"
                    :class="{ active: selectedStatusFilter === 'warning' }"
                    @click="handleStatusFilterClick('warning')"
                  >
                    <span class="status-dot"></span>预警 {{ collegeMonthIndicatorStats.warning }}
                  </span>
                  <span
                    class="status-summary-item delayed"
                    :class="{ active: selectedStatusFilter === 'delayed' }"
                    @click="handleStatusFilterClick('delayed')"
                  >
                    <span class="status-dot"></span>延期 {{ collegeMonthIndicatorStats.delayed }}
                  </span>
                </div>
                <div v-if="collegeMonthIndicators.length === 0" class="empty-indicator-list">
                  <el-empty description="该月份暂无指标数据" :image-size="80" />
                </div>
                <div
                  v-else-if="filteredCollegeMonthIndicators.length === 0"
                  class="empty-indicator-list"
                >
                  <el-empty description="没有符合筛选条件的指标" :image-size="80" />
                </div>
                <div v-else class="indicator-scroll-container">
                  <el-popover
                    v-for="indicator in filteredCollegeMonthIndicators"
                    :key="indicator.id"
                    placement="left"
                    :width="320"
                    trigger="hover"
                    popper-class="indicator-detail-popover"
                  >
                    <template #reference>
                      <div class="indicator-status-item" :class="getStatusClass(indicator.status)">
                        <div class="indicator-info">
                          <div class="indicator-name" :title="indicator.name">
                            {{ indicator.name }}
                          </div>
                          <div class="indicator-meta">
                            <span
                              class="indicator-type-tag"
                              :class="
                                indicator.type1 === '定性'
                                  ? 'type-qualitative'
                                  : 'type-quantitative'
                              "
                              >{{ indicator.type1 }}</span
                            >
                            <span class="indicator-progress">进度: {{ indicator.progress }}%</span>
                          </div>
                        </div>
                        <div
                          class="indicator-status-badge"
                          :class="getStatusClass(indicator.status)"
                        >
                          {{ getStatusText(indicator.status) }}
                        </div>
                      </div>
                    </template>
                    <div class="indicator-detail-content">
                      <h4 class="detail-title">{{ indicator.name }}</h4>
                      <div class="detail-row">
                        <span class="detail-label">指标类型</span>
                        <span class="detail-value">{{ indicator.type1 }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">当前进度</span>
                        <span class="detail-value">
                          <el-progress
                            :percentage="indicator.progress"
                            :stroke-width="8"
                            :color="
                              indicator.progress >= 80
                                ? '#67c23a'
                                : indicator.progress >= 50
                                  ? '#e6a23c'
                                  : '#f56c6c'
                            "
                            style="width: 120px; display: inline-flex"
                          />
                        </span>
                      </div>
                      <div
                        v-if="indicator.targetProgress !== null || indicator.milestoneIndex"
                        class="detail-row"
                      >
                        <span class="detail-label">目标进度</span>
                        <span class="detail-value"
                          >{{
                            indicator.targetProgress !== null
                              ? indicator.targetProgress + '%'
                              : '-'
                          }}{{
                            indicator.milestoneIndex ? ' (' + indicator.milestoneIndex + ')' : ''
                          }}</span
                        >
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">权重</span>
                        <span class="detail-value">{{ indicator.weight }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">来源部门</span>
                        <span class="detail-value">{{ indicator.ownerDept }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">完成状态</span>
                        <span class="detail-value">
                          <span class="status-tag" :class="getStatusClass(indicator.status)">
                            {{ getStatusText(indicator.status) }}
                          </span>
                        </span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">统计月份</span>
                        <span class="detail-value">{{ selectedMonthInCollegeDrillDown }}月</span>
                      </div>
                    </div>
                  </el-popover>
                </div>
              </div>
            </el-card>
          </div>
        </div>
      </div>

      <!-- 分院排名看板（战略发展部 + 职能部门） -->
      <div
        v-if="currentRole !== 'secondary_college'"
        class="chart-section deep-charts college-ranking-section"
      >
        <el-col :span="24">
          <el-card shadow="hover" class="chart-card glass-card">
            <template #header>
              <div class="card-header">
                <div class="header-left">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title">
                      分院排名
                      <span class="title-tag-italic">RANKING</span>
                    </span>
                    <el-tooltip
                      content="展示各二级学院的指标完成分数排名，分数 = Σ(权重 × 进度)"
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                  <span class="card-subtitle">{{ collegeRankingMonth }}月 · 按分数排名</span>
                </div>
                <div class="header-right">
                  <div class="filter-group">
                    <!-- 月份筛选 -->
                    <div class="month-filter">
                      <span class="filter-label">月份:</span>
                      <el-select
                        v-model="collegeRankingMonth"
                        size="small"
                        class="month-select"
                        @change="handleCollegeRankingMonthChange"
                      >
                        <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
                      </el-select>
                    </div>
                    <!-- 职能部门筛选（仅战略发展部可见） -->
                    <div v-if="currentRole === 'strategic_dept'" class="dept-filter">
                      <span class="filter-label">来源部门:</span>
                      <el-select
                        v-model="selectedOwnerDeptFilter"
                        size="small"
                        class="dept-select"
                        @change="handleOwnerDeptFilterChange"
                      >
                        <el-option label="全部" value="all" />
                        <el-option
                          v-for="dept in availableFunctionalDepts"
                          :key="dept"
                          :label="dept"
                          :value="dept"
                        />
                      </el-select>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <div ref="collegeRankingChartRef" class="college-ranking-chart"></div>
          </el-card>
        </el-col>
      </div>

      <!-- 图表区域 -->
      <el-row :gutter="16" class="chart-section">
        <!-- 得分构成 -->
        <el-col :xs="24" :md="8">
          <el-card shadow="hover" class="chart-card card-animate">
            <template #header>
              <div class="card-header">
                <div style="display: flex; align-items: center; gap: 4px">
                  <span class="card-title">得分构成</span>
                  <el-tooltip :content="helpTexts.scoreComposition" placement="top" effect="light">
                    <el-icon class="help-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </div>
              </div>
            </template>
            <ScoreCompositionChart
              :basic-score="dashboardData.basicScore"
              :development-score="dashboardData.developmentScore"
            />
          </el-card>
        </el-col>

        <!-- 预警分布 -->
        <el-col :xs="24" :md="8">
          <el-card shadow="hover" class="chart-card card-animate">
            <template #header>
              <div class="card-header">
                <div style="display: flex; align-items: center; gap: 4px">
                  <span class="card-title">预警分布</span>
                  <el-tooltip :content="helpTexts.alertDistribution" placement="top" effect="light">
                    <el-icon class="help-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </div>
              </div>
            </template>
            <AlertDistributionChart
              :severe="dashboardData.alertIndicators.severe"
              :moderate="dashboardData.alertIndicators.moderate"
              :normal="dashboardData.alertIndicators.normal"
              @click="handleAlertClick"
            />
          </el-card>
        </el-col>

        <!-- 完成率统计 -->
        <el-col :xs="24" :md="8">
          <el-card shadow="hover" class="chart-card card-animate">
            <template #header>
              <div class="card-header">
                <div style="display: flex; align-items: center; gap: 4px">
                  <span class="card-title">完成情况</span>
                  <el-tooltip :content="helpTexts.completionRate" placement="top" effect="light">
                    <el-icon class="help-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </div>
              </div>
            </template>
            <div class="completion-stats">
              <div class="completion-ring">
                <el-progress
                  type="circle"
                  :percentage="dashboardData.completionRate"
                  :width="140"
                  :stroke-width="12"
                >
                  <template #default="{ percentage }">
                    <div class="completion-text">
                      <span class="percentage">{{ percentage }}%</span>
                      <span class="label">完成率</span>
                    </div>
                  </template>
                </el-progress>
              </div>
              <div class="completion-detail">
                <div class="detail-item">
                  <span class="detail-label">总指标数</span>
                  <span class="detail-value">{{ dashboardData.totalIndicators }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">已完成</span>
                  <span class="detail-value success">{{ dashboardData.completedIndicators }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">进行中</span>
                  <span class="detail-value">{{
                    dashboardData.totalIndicators - dashboardData.completedIndicators
                  }}</span>
                </div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 滞后任务响应清单（二级学院不显示） -->
      <el-card
        v-if="currentRole !== 'secondary_college'"
        shadow="hover"
        class="task-list-card glass-card"
      >
        <template #header>
          <div class="card-header task-card-header">
            <div class="header-left">
              <div class="header-icon danger">
                <el-icon><Warning /></el-icon>
              </div>
              <div class="header-title-group">
                <div style="display: flex; align-items: center; gap: 4px">
                  <span class="card-title task-title">TOP 滞后任务响应清单</span>
                  <el-tooltip :content="helpTexts.delayedTasks" placement="top" effect="light">
                    <el-icon class="help-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </div>
                <span class="card-subtitle">HIGH PRIORITY PENDING ACTIONS</span>
              </div>
            </div>
            <el-button link type="primary" size="small" class="view-all-btn"
              >VIEW ALL ISSUES →</el-button
            >
          </div>
        </template>
        <el-table :data="delayedTasks" style="width: 100%" :show-header="true" class="task-table">
          <el-table-column label="战略任务内容" min-width="240">
            <template #default="{ row }">
              <div class="task-name-primary">{{ row.name }}</div>
              <div class="task-ref-id">REF_ID: {{ row.id }}</div>
            </template>
          </el-table-column>
          <el-table-column label="责任主体" width="140" align="center">
            <template #default="{ row }">
              <span class="dept-badge">{{ row.dept }}</span>
            </template>
          </el-table-column>
          <el-table-column label="当前进度" width="160" align="center">
            <template #default="{ row }">
              <div class="progress-cell-new">
                <div class="progress-bar-wrapper">
                  <div class="progress-bar-fill" :style="{ width: row.progress + '%' }"></div>
                </div>
                <span class="delayed-tag">DELAYED {{ row.days }}D</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="闭环管理" width="130" align="center">
            <template #default="{ row }">
              <button
                class="urge-btn"
                :class="{ disabled: row.reminded || row.reminding }"
                :disabled="row.reminded || row.reminding"
                @click="handleUrge(row)"
              >
                {{ row.reminding ? '发送中...' : row.reminded ? '已催办' : '一键催办' }}
              </button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="delayedTasks.length === 0" description="暂无滞后任务，执行状态良好！" />
      </el-card>

      <!-- 三级联动图表区域 -->

      <!-- 战略发展部 - 组织级视图 -->
      <template
        v-if="currentRole === 'strategic_dept' && dashboardStore.currentOrgLevel === 'strategy'"
      >
        <el-row :gutter="16" style="margin-top: 16px">
          <!-- 全校任务流转图 -->
          <el-col :span="24">
            <el-card shadow="hover" class="chart-card card-animate">
              <template #header>
                <div class="card-header">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title">全校任务流转图</span>
                    <el-tooltip
                      content="显示战略处到职能部门到学院的任务分发情况，点击节点可下钻"
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </div>
              </template>
              <TaskSankeyChart
                :data="dashboardStore.sankeyData"
                title=""
                @node-click="handleSankeyNodeClick"
                @link-click="handleSankeyLinkClick"
              />
            </el-card>
          </el-col>
        </el-row>
      </template>

      <!-- 职能部门视图 -->
      <template v-if="currentRole === 'functional_dept'">
        <el-row :gutter="16" style="margin-top: 16px">
          <!-- 本部门任务下发流向 -->
          <el-col :span="24">
            <el-card shadow="hover" class="chart-card card-animate">
              <template #header>
                <div class="card-header">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title">本部门任务下发流向</span>
                    <el-tooltip
                      content="显示本部门向各学院分发的任务情况，双击对应看板进入对应视图"
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </div>
              </template>
              <TaskSankeyChart
                :data="dashboardStore.sankeyData"
                title=""
                @node-click="handleSankeyNodeClick"
              />
            </el-card>
          </el-col>
        </el-row>
      </template>

      <!-- 二级学院视图 -->
      <template v-if="currentRole === 'secondary_college'">
        <el-row :gutter="16" style="margin-top: 16px">
          <!-- 任务来源分布 -->
          <el-col :xs="24" :md="10">
            <el-card shadow="hover" class="chart-card card-animate">
              <template #header>
                <div class="card-header">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title">任务来源分布</span>
                    <el-tooltip
                      content="显示本学院承接的任务来自哪些职能部门，点击可筛选"
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </div>
              </template>
              <SourcePieChart
                :data="dashboardStore.taskSourceDistribution"
                title=""
                @click="handleSourceClick"
              />
            </el-card>
          </el-col>

          <!-- 承接任务汇总 -->
          <el-col :xs="24" :md="14">
            <el-card shadow="hover" class="chart-card card-animate">
              <template #header>
                <div class="card-header">
                  <div style="display: flex; align-items: center; gap: 4px">
                    <span class="card-title">承接任务汇总</span>
                    <el-tooltip
                      content="本学院承接的所有任务进度汇总"
                      placement="top"
                      effect="light"
                    >
                      <el-icon class="help-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </div>
              </template>
              <DepartmentProgressChart :departments="dashboardStore.departmentSummary" />
            </el-card>
          </el-col>
        </el-row>
      </template> </template
    ><!-- 结束 v-else 正常数据展示 -->
  </div>
</template>

<style scoped src="./DashboardView.css"></style>
