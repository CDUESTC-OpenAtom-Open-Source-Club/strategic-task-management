<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '@/features/auth/model/store'
import { useStrategicStore } from '@/features/task/model/strategic'
import { useOrgStore } from '@/features/organization/model/store'
import type { FilterState } from '@/shared/types'
import { isSecondaryCollege } from '@/shared/lib/utils/colors'

interface Props {
  modelValue: FilterState
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: FilterState]
  apply: []
}>()

const authStore = useAuthStore()
const strategicStore = useStrategicStore()
const orgStore = useOrgStore()

const localFilters = ref<FilterState>({ ...props.modelValue })

watch(
  () => props.modelValue,
  newValue => {
    localFilters.value = { ...newValue }
  },
  { deep: true }
)

const functionalDepts = computed(() => {
  const allDepts = orgStore.getAllFunctionalDepartmentNames()

  if (authStore.user?.role === 'strategic_dept') {
    return allDepts
  }

  if (authStore.user?.role === 'functional_dept') {
    const userDept = authStore.user?.department
    return allDepts.filter(dept => dept === userDept)
  }

  return allDepts
})

const collegeOptions = computed(() => {
  const indicators = strategicStore.indicators
  const allColleges = orgStore.getAllCollegeNames()

  if (localFilters.value.department) {
    const relatedColleges = new Set<string>()
    indicators
      .filter(
        i => i.ownerDept === localFilters.value.department && isSecondaryCollege(i.responsibleDept)
      )
      .forEach(i => {
        if (i.responsibleDept) {
          relatedColleges.add(i.responsibleDept)
        }
      })

    if (relatedColleges.size > 0) {
      return allColleges.filter(college => relatedColleges.has(college))
    }
  }

  if (authStore.user?.role === 'functional_dept') {
    const dept = authStore.user?.department
    const relatedColleges = new Set<string>()
    indicators
      .filter(i => i.ownerDept === dept && isSecondaryCollege(i.responsibleDept))
      .forEach(i => {
        if (i.responsibleDept) {
          relatedColleges.add(i.responsibleDept)
        }
      })

    if (relatedColleges.size > 0) {
      return allColleges.filter(college => relatedColleges.has(college))
    }
  }

  return allColleges
})

watch(
  () => localFilters.value.department,
  () => {
    localFilters.value.collegeFilter = undefined
  }
)

const handleApply = () => {
  emit('update:modelValue', localFilters.value)
  emit('apply')
}

const handleReset = () => {
  localFilters.value = {}
  emit('update:modelValue', {})
  emit('apply')
}

const handleCloseTag = (key: keyof typeof localFilters.value) => {
  localFilters.value[key] = undefined
  handleApply()
}

const hasFilters = computed(() => {
  return Object.values(localFilters.value).some(v => v !== undefined && v !== '')
})
</script>

<template>
  <div class="dashboard-filters">
    <el-form :model="localFilters" inline size="default">
      <el-form-item v-if="authStore.user?.role === 'strategic_dept'" label="职能部门">
        <el-select
          v-model="localFilters.department"
          placeholder="全部职能部门"
          clearable
          filterable
          style="width: 200px"
        >
          <el-option v-for="dept in functionalDepts" :key="dept" :label="dept" :value="dept" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="authStore.user?.role !== 'secondary_college'" label="二级学院">
        <el-select
          v-model="localFilters.collegeFilter"
          placeholder="全部学院"
          clearable
          filterable
          style="width: 200px"
          :disabled="
            authStore.user?.role === 'strategic_dept' &&
            !localFilters.department &&
            collegeOptions.length === 0
          "
        >
          <el-option
            v-for="college in collegeOptions"
            :key="college"
            :label="college"
            :value="college"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="指标类型">
        <el-select
          v-model="localFilters.indicatorType"
          placeholder="全部"
          clearable
          style="width: 130px"
        >
          <el-option label="定性" value="定性" />
          <el-option label="定量" value="定量" />
        </el-select>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :icon="hasFilters ? 'Search' : undefined" @click="handleApply">
          {{ hasFilters ? '应用筛选' : '查询' }}
        </el-button>
        <el-button :disabled="!hasFilters" @click="handleReset"> 重置 </el-button>
      </el-form-item>
    </el-form>

    <div v-if="hasFilters" class="filter-tags">
      <el-tag
        v-if="localFilters.department"
        closable
        type="info"
        size="small"
        @close="handleCloseTag('department')"
      >
        职能部门: {{ localFilters.department }}
      </el-tag>
      <el-tag
        v-if="localFilters.collegeFilter"
        closable
        type="info"
        size="small"
        @close="handleCloseTag('collegeFilter')"
      >
        学院: {{ localFilters.collegeFilter }}
      </el-tag>
      <el-tag
        v-if="localFilters.indicatorType"
        closable
        type="info"
        size="small"
        @close="handleCloseTag('indicatorType')"
      >
        类型: {{ localFilters.indicatorType }}
      </el-tag>
      <el-tag
        v-if="localFilters.alertLevel"
        closable
        type="info"
        size="small"
        @close="handleCloseTag('alertLevel')"
      >
        预警: {{ localFilters.alertLevel }}
      </el-tag>
    </div>
  </div>
</template>

<style scoped>
.dashboard-filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
