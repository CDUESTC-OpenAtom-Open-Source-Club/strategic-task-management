/**
 * Mock API 处理器 - 与后端完全对齐
 * 拦截 API 请求并返回模拟数据
 */

import type { InternalAxiosRequestConfig } from 'axios'
import { logger } from '@/shared/lib/utils/logger'
import {
  mockUsers,
  mockAnnouncements,
  mockIndicators,
  mockStrategicTasks,
  mockAssessmentCycles,
  mockDashboardData,
  createMockResponse,
  createMockPageResponse,
  createMockError
} from './data'

const mockAlertStats = {
  totalOpen: 3,
  countBySeverity: {
    CRITICAL: 1,
    MAJOR: 1,
    MINOR: 1
  }
}

const mockUnclosedAlerts = [
  {
    id: 1,
    ruleId: 101,
    ruleName: '进度严重滞后',
    entityType: 'indicator',
    entityId: 1001,
    entityName: '教学质量指标',
    severity: 'CRITICAL',
    message: '指标进度低于预期，需立即处理',
    status: 'OPEN',
    triggeredAt: '2026-03-10T09:00:00Z'
  },
  {
    id: 2,
    ruleId: 102,
    ruleName: '填报超期',
    entityType: 'indicator',
    entityId: 1002,
    entityName: '科研成果指标',
    severity: 'MAJOR',
    message: '填报已超过截止日期',
    status: 'IN_PROGRESS',
    triggeredAt: '2026-03-11T10:30:00Z'
  }
]

const mockPendingApprovals = [
  {
    instanceId: 9001,
    planName: '2026 年重点任务计划',
    year: 2026,
    submitterName: '张三',
    createdAt: '2026-03-15T10:00:00Z',
    currentStepName: '战略发展部审批'
  },
  {
    instanceId: 9002,
    planName: '2026 年学院发展计划',
    year: 2026,
    submitterName: '李四',
    createdAt: '2026-03-14T15:30:00Z',
    currentStepName: '战略发展部审批'
  }
]

const mockWorkflowPreview = {
  workflowCode: 'PLAN_DISPATCH_FUNCDEPT',
  workflowName: '计划下发审批',
  entityType: 'PLAN',
  steps: [
    {
      stepDefId: 1,
      stepOrder: 1,
      stepName: '战略发展部审批',
      selectable: true,
      candidateApprovers: [
        { userId: 4, username: 'jiaowuchu', realName: '王五', orgId: 44, orgName: '教务处' }
      ]
    }
  ]
}

const mockWorkflowTaskPage = {
  items: [
    {
      taskId: '9001',
      instanceId: '9001',
      taskName: '职能部门审批',
      taskKey: 'strategy_approve',
      status: 'PENDING',
      entityType: 'PLAN',
      entityId: 101,
      businessEntityId: 101,
      currentStepName: '职能部门审批',
      assigneeId: 4,
      assigneeName: '王五',
      approverOrgId: 44,
      approverOrgName: '教务处',
      stepNo: 1,
      createdTime: '2026-03-15T10:00:00Z',
      flowCode: 'PLAN_DISPATCH_FUNCDEPT',
      flowName: '计划下发审批',
      planId: 101,
      planName: '2026 计算机学院计划',
      sourceOrgId: 44,
      sourceOrgName: '教务处',
      targetOrgId: 57,
      targetOrgName: '计算机学院'
    }
  ],
  total: 1,
  pageNum: 1,
  pageSize: 10
}

const mockWorkflowInstanceDetail = {
  instanceId: '9001',
  definitionId: 'PLAN_DISPATCH_FUNCDEPT',
  definitionName: '计划下发审批',
  status: 'PENDING',
  flowCode: 'PLAN_DISPATCH_FUNCDEPT',
  flowName: '计划下发审批',
  businessEntityId: 101,
  businessEntityType: 'PLAN',
  planId: 101,
  planName: '2026 计算机学院计划',
  sourceOrgId: 44,
  sourceOrgName: '教务处',
  targetOrgId: 57,
  targetOrgName: '计算机学院',
  startTime: '2026-03-15T10:00:00Z',
  currentTaskId: '9001',
  currentStepName: '职能部门审批',
  currentApproverId: 4,
  currentApproverName: '王五',
  canWithdraw: false,
  tasks: [
    {
      taskId: '9001',
      instanceId: '9001',
      taskName: '职能部门审批',
      taskKey: 'strategy_approve',
      status: 'PENDING',
      entityType: 'PLAN',
      entityId: 101,
      businessEntityId: 101,
      currentStepName: '职能部门审批',
      assigneeId: 4,
      assigneeName: '王五',
      approverOrgId: 44,
      approverOrgName: '教务处',
      stepNo: 1,
      createdTime: '2026-03-15T10:00:00Z'
    }
  ],
  history: []
}

const mockWorkflowHistoryCards = [
  {
    instanceId: '8001',
    instanceNo: 'HIS-8001',
    entityType: 'PLAN',
    entityId: 101,
    planId: 101,
    planName: '2026 计算机学院计划',
    flowCode: 'PLAN_DISPATCH_FUNCDEPT',
    flowName: '计划下发审批',
    sourceOrgId: 44,
    sourceOrgName: '教务处',
    targetOrgId: 57,
    targetOrgName: '计算机学院',
    status: 'APPROVED',
    startedAt: '2026-03-01T09:00:00Z',
    completedAt: '2026-03-02T10:00:00Z',
    requesterId: 4,
    requesterName: '王五'
  }
]

const mockPlanReports = [
  {
    id: 201,
    planId: 101,
    reportOrgId: 5,
    reportMonth: '2026-03',
    status: 'SUBMITTED',
    workflowStatus: 'PENDING',
    workflowInstanceId: 9001,
    currentTaskId: 9001,
    currentStepName: '战略发展部审批',
    currentApproverId: 4,
    currentApproverName: '王五',
    canWithdraw: false,
    title: '2026 计算机学院计划月报'
  }
]

const mockAdminUsers = mockUsers.map((user, index) => ({
  id: user.userId,
  username: user.username,
  realName: user.name,
  email: user.email || '',
  phone: user.phone || '',
  orgId: index + 1,
  orgName: user.department || '',
  roles: [{ roleCode: user.role }],
  status: user.isActive ? 'active' : 'disabled',
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
}))

// 模拟延迟（ms）
const MOCK_DELAY = 300

/**
 * 模拟网络延迟
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 解析 URL 路径
 */
function parsePath(url: string): { path: string; query: Record<string, string> } {
  const [path, queryString] = url.split('?')
  const query: Record<string, string> = {}

  if (queryString) {
    queryString.split('&').forEach(param => {
      const [key, value] = param.split('=')
      query[key] = decodeURIComponent(value)
    })
  }

  return { path, query }
}

function normalizeMockPath(path: string): string {
  if (path.startsWith('/api/v1/')) {
    return path.replace('/api/v1', '/api')
  }

  if (path.startsWith('/auth/')) {
    return path
  }

  if (path.startsWith('/api/')) {
    return path
  }

  if (path.startsWith('/')) {
    return `/api${path}`
  }

  return `/api/${path}`
}

/**
 * Mock API 路由处理器
 */
export class MockApiHandler {
  /**
   * 处理 API 请求
   */
  static async handleRequest(config: InternalAxiosRequestConfig): Promise<unknown> {
    const { method, url, data } = config
    const { path, query } = parsePath(url || '')
    const normalizedPath = normalizeMockPath(path)
    const normalizedMethod = method?.toUpperCase()

    logger.debug('🎭 [Mock API] 请求拦截:', {
      method: normalizedMethod,
      path: normalizedPath,
      query,
      hasData: !!data
    })

    // 模拟网络延迟
    await delay(MOCK_DELAY)

    try {
      let response: unknown

      // ============================================
      // 认证相关 API
      // ============================================
      if (normalizedPath === '/auth/login' && normalizedMethod === 'POST') {
        response = await this.handleLogin(data)
      } else if (normalizedPath === '/auth/permissions' && normalizedMethod === 'GET') {
        response = createMockResponse(
          [
            'BTN_STRATEGY_TASK_DISPATCH_APPROVE',
            'BTN_INDICATOR_DISPATCH_APPROVE',
            'BTN_STRATEGY_TASK_REPORT_APPROVE',
            'BTN_INDICATOR_REPORT_APPROVE'
          ],
          '获取权限成功'
        )
      } else if (normalizedPath === '/auth/info' && normalizedMethod === 'GET') {
        response = await this.handleAuthInfo()
      } else if (normalizedPath === '/auth/logout' && normalizedMethod === 'POST') {
        response = await this.handleLogout()
      } else if (normalizedPath === '/api/cycles/list' && normalizedMethod === 'GET') {
        response = createMockResponse(mockAssessmentCycles, '获取周期列表成功')
      } else if (normalizedPath === '/api/message-center/summary' && normalizedMethod === 'GET') {
        response = createMockResponse(
          { unreadCount: 0, todoCount: 0, riskCount: 0 },
          '获取消息概览成功'
        )
      } else if (normalizedPath === '/api/message-center/messages' && normalizedMethod === 'GET') {
        response = createMockResponse(
          { items: [], total: 0, pageNum: 1, pageSize: 100 },
          '获取消息列表成功'
        )
      }
      // ============================================
      // 评估周期 API
      // ============================================
      else if (normalizedPath === '/api/assessment-cycles' && normalizedMethod === 'GET') {
        response = await this.handleGetAssessmentCycles(query)
      } else if (
        normalizedPath.startsWith('/api/assessment-cycles/') &&
        normalizedMethod === 'GET'
      ) {
        const id = normalizedPath.split('/').pop()
        response = await this.handleGetAssessmentCycle(id ?? '0')
      }
      // ============================================
      // 战略任务 API
      // ============================================
      else if (normalizedPath === '/api/strategic-tasks' && normalizedMethod === 'GET') {
        response = await this.handleGetStrategicTasks(query)
      } else if (normalizedPath.startsWith('/api/strategic-tasks/') && normalizedMethod === 'GET') {
        const id = normalizedPath.split('/').pop()
        response = await this.handleGetStrategicTask(id ?? '0')
      } else if (normalizedPath === '/api/strategic-tasks' && normalizedMethod === 'POST') {
        response = await this.handleCreateStrategicTask(data)
      } else if (normalizedPath.startsWith('/api/strategic-tasks/') && normalizedMethod === 'PUT') {
        const id = normalizedPath.split('/').pop()
        response = await this.handleUpdateStrategicTask(id ?? '0', data)
      } else if (
        normalizedPath.startsWith('/api/strategic-tasks/') &&
        normalizedMethod === 'DELETE'
      ) {
        const id = normalizedPath.split('/').pop()
        response = await this.handleDeleteStrategicTask(id ?? '0')
      }
      // ============================================
      // 指标 API（与后端对齐）
      // ============================================
      else if (normalizedPath === '/api/indicators' && normalizedMethod === 'GET') {
        response = await this.handleGetIndicators(query)
      } else if (
        /^\/api\/tasks\/by-plan\/\d+$/.test(normalizedPath) &&
        normalizedMethod === 'GET'
      ) {
        const planId = Number(normalizedPath.split('/').pop() || 0)
        response = createMockResponse(
          planId === 101
            ? [
                {
                  taskId: 10101,
                  planId: 101,
                  taskName: '教学质量提升',
                  taskType: 'QUANTITATIVE',
                  createdAt: '2026-03-15T10:00:00Z'
                }
              ]
            : [],
          '获取计划任务成功'
        )
      } else if (/^\/api\/reports\/plan\/\d+$/.test(normalizedPath) && normalizedMethod === 'GET') {
        response = createMockResponse(mockPlanReports, '获取计划报告成功')
      } else if (/^\/api\/reports\/\d+$/.test(normalizedPath) && normalizedMethod === 'GET') {
        response = createMockResponse(mockPlanReports[0], '获取报告详情成功')
      } else if (normalizedPath.startsWith('/api/indicators/') && normalizedMethod === 'GET') {
        const id = normalizedPath.split('/').pop()
        response = await this.handleGetIndicator(id ?? '0')
      } else if (normalizedPath === '/api/indicators' && normalizedMethod === 'POST') {
        response = await this.handleCreateIndicator(data)
      } else if (normalizedPath.startsWith('/api/indicators/') && normalizedMethod === 'PUT') {
        const id = normalizedPath.split('/').pop()
        response = await this.handleUpdateIndicator(id ?? '0', data)
      } else if (normalizedPath.startsWith('/api/indicators/') && normalizedMethod === 'DELETE') {
        const id = normalizedPath.split('/').pop()
        response = await this.handleDeleteIndicator(id ?? '0')
      }
      // ============================================
      // 里程碑 API
      // ============================================
      // ============================================
      // 组织架构 API
      // ============================================
      else if (
        (normalizedPath === '/api/orgs' || normalizedPath === '/api/organizations') &&
        normalizedMethod === 'GET'
      ) {
        response = await this.handleGetOrgs()
      } else if (normalizedPath === '/api/cycles' && normalizedMethod === 'GET') {
        response = createMockResponse(
          {
            items: mockAssessmentCycles,
            total: mockAssessmentCycles.length,
            pageNum: 1,
            pageSize: mockAssessmentCycles.length
          },
          '获取周期分页成功'
        )
      }
      // ============================================
      // 系统公告 API
      // ============================================
      else if (normalizedPath === '/api/system/announcement' && normalizedMethod === 'GET') {
        response = await this.handleGetAnnouncements()
      }
      // ============================================
      // 仪表板 API
      // ============================================
      else if (normalizedPath === '/api/analytics/dashboard' && normalizedMethod === 'POST') {
        response = await this.handleGetDashboard()
      } else if (normalizedPath === '/api/alerts/stats' && normalizedMethod === 'GET') {
        response = createMockResponse(mockAlertStats, '获取告警统计成功')
      } else if (
        (normalizedPath === '/api/alerts/unresolved' ||
          normalizedPath === '/api/alerts/events/unclosed') &&
        normalizedMethod === 'GET'
      ) {
        response = createMockResponse(mockUnclosedAlerts, '获取未关闭告警成功')
      } else if (normalizedPath === '/api/plans/approval/pending' && normalizedMethod === 'GET') {
        response = createMockResponse(mockPendingApprovals, '获取待审批计划成功')
      } else if (
        normalizedPath === '/api/plans/approval/pending/count' &&
        normalizedMethod === 'GET'
      ) {
        response = createMockResponse(mockPendingApprovals.length, '获取待审批数量成功')
      } else if (
        /^\/api\/plans\/approval\/instances\/\d+\/approve$/.test(normalizedPath) &&
        normalizedMethod === 'POST'
      ) {
        response = createMockResponse('审批通过', '审批通过成功')
      } else if (
        /^\/api\/plans\/approval\/instances\/\d+\/reject$/.test(normalizedPath) &&
        normalizedMethod === 'POST'
      ) {
        response = createMockResponse('审批驳回', '审批驳回成功')
      } else if (normalizedPath === '/api/workflows/my-tasks' && normalizedMethod === 'GET') {
        response = createMockResponse(mockWorkflowTaskPage, '获取待办任务成功')
      } else if (
        /^\/api\/workflows\/definitions\/code\/[^/]+\/preview$/.test(normalizedPath) &&
        normalizedMethod === 'GET'
      ) {
        response = createMockResponse(mockWorkflowPreview, '获取流程预览成功')
      } else if (
        /^\/api\/workflows\/instances\/entity\/[^/]+\/[^/]+\/list$/.test(normalizedPath) &&
        normalizedMethod === 'GET'
      ) {
        response = createMockResponse(mockWorkflowHistoryCards, '获取审批历史成功')
      } else if (
        /^\/api\/workflows\/instances\/entity\/[^/]+\/[^/]+$/.test(normalizedPath) &&
        normalizedMethod === 'GET'
      ) {
        response = createMockResponse(mockWorkflowInstanceDetail, '获取流程详情成功')
      } else if (
        /^\/api\/workflows\/instances\/\d+$/.test(normalizedPath) &&
        normalizedMethod === 'GET'
      ) {
        response = createMockResponse(mockWorkflowInstanceDetail, '获取流程详情成功')
      } else if (
        /^\/api\/workflows\/tasks\/\d+\/approve$/.test(normalizedPath) &&
        normalizedMethod === 'POST'
      ) {
        response = createMockResponse(
          {
            ...mockWorkflowInstanceDetail,
            status: 'APPROVED',
            currentTaskId: undefined,
            currentStepName: '审批完成'
          },
          '审批通过成功'
        )
      } else if (
        /^\/api\/workflows\/tasks\/\d+\/reject$/.test(normalizedPath) &&
        normalizedMethod === 'POST'
      ) {
        response = createMockResponse(
          {
            ...mockWorkflowInstanceDetail,
            status: 'REJECTED',
            currentTaskId: undefined,
            currentStepName: '已驳回'
          },
          '审批驳回成功'
        )
      } else if (normalizedPath === '/api/auth/users' && normalizedMethod === 'GET') {
        response = createMockResponse(
          {
            content: mockAdminUsers,
            pageNumber: 0,
            pageSize: mockAdminUsers.length,
            totalElements: mockAdminUsers.length,
            totalPages: 1,
            hasNext: false,
            hasPrevious: false
          },
          '获取用户列表成功'
        )
      } else if (normalizedPath === '/api/auth/users' && normalizedMethod === 'POST') {
        response = await this.handleCreateAdminUser(data)
      } else if (/^\/api\/auth\/users\/\d+$/.test(normalizedPath) && normalizedMethod === 'PUT') {
        const id = normalizedPath.split('/').pop()
        response = await this.handleUpdateAdminUser(id ?? '0', data)
      } else if (
        /^\/api\/auth\/users\/\d+\/lock$/.test(normalizedPath) &&
        normalizedMethod === 'POST'
      ) {
        const id = normalizedPath.split('/')[4]
        response = await this.handleUpdateAdminUserStatus(
          id ?? '0',
          new URLSearchParams('isActive=false')
        )
      } else if (
        /^\/api\/auth\/users\/\d+\/unlock$/.test(normalizedPath) &&
        normalizedMethod === 'POST'
      ) {
        const id = normalizedPath.split('/')[4]
        response = await this.handleUpdateAdminUserStatus(
          id ?? '0',
          new URLSearchParams('isActive=true')
        )
      } else if (
        /^\/api\/auth\/users\/\d+$/.test(normalizedPath) &&
        normalizedMethod === 'DELETE'
      ) {
        const id = normalizedPath.split('/').pop()
        response = await this.handleDeleteAdminUser(id ?? '0')
      }
      // ============================================
      // 未匹配的路由
      // ============================================
      else {
        logger.warn(`🎭 [Mock API] 未实现的路由: ${normalizedMethod} ${normalizedPath}`)
        response = createMockError('NOT_IMPLEMENTED', `Mock API 未实现: ${normalizedPath}`)
      }

      logger.debug('🎭 [Mock API] 响应:', response)
      return response
    } catch (error) {
      logger.error('🎭 [Mock API] 错误:', error)
      throw error
    }
  }

  // ============================================
  // 认证处理器
  // ============================================

  private static async handleLogin(data: Record<string, unknown>) {
    const { username, password: _password } = data as { username: string; password: string }

    // Mock 登录：任意用户名密码都可以登录
    let user = mockUsers[0] // 默认返回第一个用户
    if (username === 'admin') {
      user = mockUsers[0]
    } else if (username === 'kychu') {
      user = mockUsers[1]
    } else if (username === 'jsxy') {
      user = mockUsers[2]
    } else if (username === 'jiaowuchu') {
      user = mockUsers[3]
    } else if (username === 'xueshengchu') {
      user = mockUsers[4]
    }

    logger.info('🎭 [Mock Login] 用户登录:', user.name)

    return createMockResponse(
      {
        token: 'mock_token_' + Date.now(),
        refreshToken: 'mock_refresh_token_' + Date.now(),
        user,
        expiresIn: 7200
      },
      '登录成功'
    )
  }

  private static async handleAuthInfo() {
    return createMockResponse(mockUsers[0], '获取用户信息成功')
  }

  private static async handleLogout() {
    return createMockResponse(null, '退出登录成功')
  }

  // ============================================
  // 评估周期处理器
  // ============================================

  private static async handleGetAssessmentCycles(query: Record<string, string>) {
    let cycles = [...mockAssessmentCycles]

    // 支持按状态过滤
    if (query.status) {
      cycles = cycles.filter(cycle => cycle.status === query.status)
    }

    logger.debug('🎭 [Mock API] 获取评估周期列表:', {
      query,
      count: cycles.length
    })

    return createMockPageResponse(cycles, Number(query.page) || 1, Number(query.pageSize) || 10)
  }

  private static async handleGetAssessmentCycle(id: string) {
    const cycleId = Number(id)
    const cycle = mockAssessmentCycles.find(item => item.cycleId === cycleId)

    if (!cycle) {
      return createMockError('NOT_FOUND', `评估周期 ${id} 不存在`)
    }

    return createMockResponse(cycle, '获取评估周期成功')
  }

  // ============================================
  // 战略任务处理器
  // ============================================

  private static async handleGetStrategicTasks(query: Record<string, string>) {
    let tasks = [...mockStrategicTasks]

    // 支持按评估周期过滤
    if (query.cycleId) {
      const taskId = Number(query.cycleId)
      tasks = tasks.filter(task => task.cycleId === taskId)
    }

    // 支持按部门过滤
    if (query.responsibleDept) {
      tasks = tasks.filter(task => task.responsibleDept.includes(query.responsibleDept))
    }

    logger.debug('🎭 [Mock API] 获取战略任务列表:', {
      query,
      count: tasks.length
    })

    return createMockPageResponse(tasks, Number(query.page) || 1, Number(query.pageSize) || 10)
  }

  private static async handleGetStrategicTask(id: string) {
    const taskId = Number(id)
    const task = mockStrategicTasks.find(item => item.taskId === taskId)

    if (!task) {
      return createMockError('NOT_FOUND', `战略任务 ${id} 不存在`)
    }

    return createMockResponse(task, '获取战略任务成功')
  }

  private static async handleCreateStrategicTask(data: Record<string, unknown>) {
    logger.info('🎭 [Mock API] 创建战略任务:', data)

    const newTask = {
      taskId: Date.now(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    return createMockResponse(newTask, '创建战略任务成功')
  }

  private static async handleUpdateStrategicTask(id: string, data: Record<string, unknown>) {
    logger.info('🎭 [Mock API] 更新战略任务:', id, data)

    return createMockResponse(
      {
        taskId: Number(id),
        ...data,
        updatedAt: new Date().toISOString()
      },
      '更新战略任务成功'
    )
  }

  private static async handleDeleteStrategicTask(id: string) {
    logger.info('🎭 [Mock API] 删除战略任务:', id)

    return createMockResponse({ taskId: Number(id) }, '删除战略任务成功')
  }

  // ============================================
  // 指标处理器
  // ============================================

  private static async handleGetIndicators(query: Record<string, string>) {
    let indicators = [...mockIndicators]

    // 支持按任务过滤
    if (query.taskId) {
      const taskId = Number(query.taskId)
      indicators = indicators.filter(indicator => indicator.taskId === taskId)
    }

    // 支持按状态过滤
    if (query.status) {
      indicators = indicators.filter(indicator => indicator.status === query.status)
    }

    // 支持按部门过滤
    if (query.responsibleDept) {
      indicators = indicators.filter(indicator =>
        indicator.responsibleDept.includes(query.responsibleDept)
      )
    }

    logger.debug('🎭 [Mock API] 获取指标列表:', {
      query,
      count: indicators.length
    })

    return createMockPageResponse(indicators, Number(query.page) || 1, Number(query.pageSize) || 10)
  }

  private static async handleGetIndicator(id: string) {
    const indicatorId = Number(id)
    const indicator = mockIndicators.find(item => item.indicatorId === indicatorId)

    if (!indicator) {
      return createMockError('NOT_FOUND', `指标 ${id} 不存在`)
    }

    return createMockResponse(indicator, '获取指标成功')
  }

  private static async handleCreateIndicator(data: Record<string, unknown>) {
    logger.info('🎭 [Mock API] 创建指标:', data)

    const newIndicator = {
      indicatorId: Date.now(),
      ...data,
      status: 'DRAFT',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusAudit: []
    }

    return createMockResponse(newIndicator, '创建指标成功')
  }

  private static async handleUpdateIndicator(id: string, data: Record<string, unknown>) {
    logger.info('🎭 [Mock API] 更新指标:', id, data)

    return createMockResponse(
      {
        indicatorId: Number(id),
        ...data,
        updatedAt: new Date().toISOString()
      },
      '更新指标成功'
    )
  }

  private static async handleDeleteIndicator(id: string) {
    logger.info('🎭 [Mock API] 删除指标:', id)

    return createMockResponse({ indicatorId: Number(id) }, '删除指标成功')
  }

  // ============================================
  // 里程碑处理器
  // ============================================

  // ============================================
  // 组织架构处理器
  // ============================================

  private static async handleGetOrgs() {
    const mockOrgs = [
      { id: 1, name: '战略发展部', code: 'STRATEGY', parentId: null },
      { id: 2, name: '科研处', code: 'RESEARCH', parentId: null },
      { id: 3, name: '教务处', code: 'EDUCATION', parentId: null },
      { id: 4, name: '人事处', code: 'HR', parentId: null },
      { id: 5, name: '财务处', code: 'FINANCE', parentId: null },
      { id: 6, name: '学生处', code: 'STUDENT', parentId: null },
      { id: 7, name: '计算机学院', code: 'COMPUTER', parentId: null },
      { id: 8, name: '电子工程学院', code: 'ELECTRONIC', parentId: null }
    ]
    return createMockResponse(mockOrgs, '获取组织架构成功')
  }

  // ============================================
  // 系统公告处理器
  // ============================================

  private static async handleGetAnnouncements() {
    return createMockResponse(mockAnnouncements, '获取公告成功')
  }

  // ============================================
  // 仪表板处理器
  // ============================================

  /**
   * 处理获取仪表板数据
   */
  private static async handleGetDashboard() {
    return createMockResponse(mockDashboardData, '获取仪表板数据成功')
  }

  /**
   * 处理获取部门进度数据
   */
  private static async handleGetDepartmentProgress() {
    return createMockResponse(mockDashboardData.departmentProgress, '获取部门进度成功')
  }

  /**
   * 处理获取最近活动数据
   */
  private static async handleGetRecentActivities() {
    return createMockResponse(mockDashboardData.recentActivities, '获取最近活动成功')
  }

  private static async handleCreateAdminUser(data: Record<string, unknown>) {
    const orgMap = new Map<number, string>([
      [1, '战略发展部'],
      [2, '科研处'],
      [3, '教务处'],
      [4, '学生处'],
      [5, '计算机学院']
    ])

    const newUser = {
      id: Date.now(),
      username: String(data.username || `user_${Date.now()}`),
      realName: String(data.realName || '新用户'),
      email: String(data.email || ''),
      phone: String(data.phone || ''),
      orgId: Number(data.orgId || 1),
      orgName: orgMap.get(Number(data.orgId || 1)) || '战略发展部',
      roles: Array.isArray(data.roleIds)
        ? (data.roleIds as string[]).map(roleCode => ({ roleCode }))
        : [{ roleCode: 'secondary_college' }],
      status: data.status === 'disabled' ? 'disabled' : 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    mockAdminUsers.unshift(newUser)
    return createMockResponse(newUser, '创建用户成功')
  }

  private static async handleUpdateAdminUser(id: string, data: Record<string, unknown>) {
    const userIndex = mockAdminUsers.findIndex(user => user.id === Number(id))
    if (userIndex === -1) {
      return createMockError('NOT_FOUND', `用户 ${id} 不存在`)
    }

    const existingUser = mockAdminUsers[userIndex]
    const updatedUser = {
      ...existingUser,
      username: String(data.username || existingUser.username),
      realName: String(data.realName || existingUser.realName),
      email: String(data.email || existingUser.email),
      phone: String(data.phone || existingUser.phone),
      orgId: Number(data.orgId || existingUser.orgId),
      roles: Array.isArray(data.roleIds)
        ? (data.roleIds as string[]).map(roleCode => ({ roleCode }))
        : existingUser.roles,
      status: data.status === 'disabled' ? 'disabled' : existingUser.status,
      updatedAt: new Date().toISOString()
    }

    mockAdminUsers[userIndex] = updatedUser
    return createMockResponse(updatedUser, '更新用户成功')
  }

  private static async handleUpdateAdminUserStatus(id: string, query: Record<string, string>) {
    const user = mockAdminUsers.find(item => item.id === Number(id))
    if (!user) {
      return createMockError('NOT_FOUND', `用户 ${id} 不存在`)
    }

    user.status = query.isActive === 'true' ? 'active' : 'disabled'
    user.updatedAt = new Date().toISOString()

    return createMockResponse(user, '更新用户状态成功')
  }

  private static async handleDeleteAdminUser(id: string) {
    const userIndex = mockAdminUsers.findIndex(user => user.id === Number(id))
    if (userIndex !== -1) {
      mockAdminUsers.splice(userIndex, 1)
    }

    return createMockResponse({ deleted: true }, '删除用户成功')
  }
}
