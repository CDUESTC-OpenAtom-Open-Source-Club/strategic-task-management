import { z } from 'zod'

export const UserRoleSchema = z.enum(['strategic_dept', 'functional_dept', 'secondary_college'])

export const UserSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
  username: z.string().min(1),
  name: z.string().min(1),
  role: UserRoleSchema,
  department: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  avatar: z.string().url().optional()
})

export const MilestoneSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  targetProgress: z.number().min(0).max(100),
  deadline: z.string(),
  status: z.enum(['pending', 'completed', 'overdue']),
  weightPercent: z.number().optional(),
  sortOrder: z.number().optional(),
  indicatorId: z.union([z.string(), z.number()]).optional(),
  isPaired: z.boolean().optional()
})

export const StrategicIndicatorSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  isQualitative: z.boolean(),
  type1: z.enum(['定量', '定性']),
  type2: z.enum(['基础性', '发展性', '其他']),
  progress: z.number().min(0).max(100),
  createTime: z.string(),
  weight: z.number().min(0).max(100),
  targetValue: z.number().optional(),
  actualValue: z.number().optional(),
  unit: z.string().optional(),
  responsibleDept: z.string().min(1),
  responsiblePerson: z.string().min(1),
  status: z.enum(['DRAFT', 'PENDING_REVIEW', 'DISTRIBUTED', 'ACTIVE', 'ARCHIVED']),
  isStrategic: z.boolean(),
  year: z.number(),
  milestones: z.array(MilestoneSchema),
  statusAudit: z.array(z.unknown()),
  manualAlertSeverity: z.enum(['INFO', 'WARNING', 'CRITICAL']).nullable().optional(),
  parentIndicatorId: z.union([z.string(), z.number()]).optional()
})

export const LoginCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8)
})

export type LoginCredentials = z.infer<typeof LoginCredentialsSchema>
export type StrategicIndicator = z.infer<typeof StrategicIndicatorSchema>

function toValidationResult<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value)
  if (result.success) {
    return { success: true as const, data: result.data }
  }
  return {
    success: false as const,
    errors: result.error.issues.map(issue => issue.message)
  }
}

export function validateUser(value: unknown) {
  return toValidationResult(UserSchema, value)
}

export function validateIndicator(value: unknown) {
  return toValidationResult(StrategicIndicatorSchema, value)
}

export function validateMilestone(value: unknown) {
  return toValidationResult(MilestoneSchema, value)
}

export function validateLoginCredentials(value: unknown) {
  return toValidationResult(LoginCredentialsSchema, value)
}
