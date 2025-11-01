<!-- 用户管理 -->
<!-- art-full-height 自动计算出页面剩余高度 -->
<!-- art-table-card 一个符合系统样式的 class，同时自动撑满剩余高度 -->
<!-- 更多 useTable 使用示例请移步至 功能示例 下面的 高级表格示例 -->
<template>
  <div class="user-page art-full-height">
    <!-- 搜索栏 -->
    <UserSearch v-model="searchForm" @search="handleSearch" @reset="resetSearchParams"></UserSearch>

    <ElCard class="art-table-card" shadow="never">
      <!-- 表格头部 -->
      <ArtTableHeader v-model:columns="columnChecks" :loading="loading" @refresh="refreshData">
        <template #left>
          <ElSpace wrap>
            <ElButton @click="showDialog('add')" v-ripple>新增用户</ElButton>
          </ElSpace>
        </template>
      </ArtTableHeader>

      <!-- 表格 -->
      <ArtTable :loading="loading" :data="data" :columns="columns" :pagination="pagination"
        @selection-change="handleSelectionChange" @pagination:size-change="handleSizeChange"
        @pagination:current-change="handleCurrentChange">
      </ArtTable>

      <!-- 用户弹窗 -->
      <UserDialog v-model:visible="dialogVisible" :type="dialogType" :user-data="currentUserData"
        @submit="handleDialogSubmit" />
    </ElCard>
  </div>
</template>

<script setup lang="ts">
import { getAllUsersWithBalance } from '@/api'
import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
import { useTable } from '@/composables/useTable'
import { ACCOUNT_TABLE_DATA } from '@/mock/temp/formData'
import UserDialog from './modules/user-dialog.vue'
import UserSearch from './modules/user-search.vue'

defineOptions({ name: 'User' })

type UserListItem = Api.SystemManage.UserListItem

// 弹窗相关
const dialogType = ref<Form.DialogType>('add')
const dialogVisible = ref(false)
const currentUserData = ref<Partial<UserListItem>>({})

// 选中行
const selectedRows = ref<UserListItem[]>([])
const dollarFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
// 搜索表单
const searchForm = ref({
  userName: undefined,
  userGender: undefined,
  userPhone: undefined,
  userEmail: undefined,
  status: '1'
})

// 用户状态配置
const USER_STATUS_CONFIG = {
  'ONLINE': { type: 'success' as const, text: 'ONLINE' },
  'OFFLINE': { type: 'info' as const, text: 'OFFLINE' },
  // '3': { type: 'warning' as const, text: 'abnormal' },
  'BANNED': { type: 'danger' as const, text: 'BANNED' }
} as const

/**
 * 获取用户状态配置
 */
const getUserStatusConfig = (status: string) =>
{
  return (
    USER_STATUS_CONFIG[status as keyof typeof USER_STATUS_CONFIG] || {
      type: 'info' as const,
      text: 'unknown'
    }
  )
}

const {
  columns,
  columnChecks,
  data,
  loading,
  pagination,
  getData,
  searchParams,
  resetSearchParams,
  handleSizeChange,
  handleCurrentChange,
  refreshData
} = useTable({
  // 核心配置
  core: {
    apiFn: getAllUsersWithBalance,
    apiParams: {
      page: 1,
      perPage: 20,
      ...searchForm.value
    },
    // 排除 apiParams 中的属性
    excludeParams: [],
    columnsFactory: () => [
      { type: 'selection' }, // 勾选列
      // { type: 'index', width: 60, label: '序号' }, // 序号
      {
        prop: 'avatar',
        label: '',
        width: 280,
        formatter: (row) =>
        {
          return h('div', { class: 'user', style: 'display: flex; align-items: center' }, [
            h(ElImage, {
              class: 'avatar',
              src: row.avatarUrl,
              previewSrcList: [row.avatarUrl],
              // 图片预览是否插入至 body 元素上，用于解决表格内部图片预览样式异常
              previewTeleported: true
            }),
            h('div', {}, [
              h('p', { class: 'user-name' }, row.username),
              h('p', { class: 'email' }, row.phone)
            ])
          ])
        }
      },
      {
        prop: 'userBalances.realBalance',
        label: 'real',
        sortable: true,
        // checked: false, // 隐藏列
        formatter: (row) => dollarFormatter.format(row.userBalances[0].realBalance / 100)
      },
      {
        prop: 'userBalances.bonusBalance',
        label: 'bonus',
        sortable: true,
        // checked: false, // 隐藏列
        formatter: (row) => dollarFormatter.format(row.userBalances[0].bonusBalance / 100)
      },
      // { prop: 'userPhone', label: '手机号' },
      {
        prop: 'status',
        label: 'status',
        formatter: (row) =>
        {
          const statusConfig = getUserStatusConfig(row.status)
          return h(ElTag, { type: statusConfig.type }, () => statusConfig.text)
        }
      },
      {
        prop: 'createdAt',
        label: 'created',
        sortable: true
      },
      {
        prop: 'operation',
        label: '操作',
        width: 120,
        fixed: 'right', // 固定列
        formatter: (row) =>
          h('div', [
            h(ArtButtonTable, {
              type: 'edit',
              onClick: () => showDialog('edit', row)
            }),
            h(ArtButtonTable, {
              type: 'delete',
              onClick: () => deleteUser(row)
            })
          ])
      }
    ]
  },
  // 数据处理
  transform: {
    // 数据转换器 - 替换头像
    dataTransformer: (records) =>
    {
      // 类型守卫检查
      if (!Array.isArray(records)) {
        console.warn('数据转换器: 期望数组类型，实际收到:', typeof records)
        return []
      }

      // 使用本地头像替换接口返回的头像
      return records.map((item, index: number) =>
      {
        return {
          ...item,
          avatar: ACCOUNT_TABLE_DATA[index % ACCOUNT_TABLE_DATA.length].avatar
        }
      })
    }
  }
})

/**
 * 搜索处理
 * @param params 参数
 */
const handleSearch = (params: Record<string, any>) =>
{
  console.log(params)
  // 搜索参数赋值
  Object.assign(searchParams, params)
  getData()
}

/**
 * 显示用户弹窗
 */
const showDialog = (type: Form.DialogType, row?: UserListItem): void =>
{
  console.log('打开弹窗:', { type, row })
  dialogType.value = type
  currentUserData.value = row || {}
  nextTick(() =>
  {
    dialogVisible.value = true
  })
}

/**
 * 删除用户
 */
const deleteUser = (row: UserListItem): void =>
{
  console.log('删除用户:', row)
  ElMessageBox.confirm(`确定要注销该用户吗？`, '注销用户', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'error'
  }).then(() =>
  {
    ElMessage.success('注销成功')
  })
}

/**
 * 处理弹窗提交事件
 */
const handleDialogSubmit = async () =>
{
  try {
    dialogVisible.value = false
    currentUserData.value = {}
  } catch (error) {
    console.error('提交失败:', error)
  }
}

/**
 * 处理表格行选择变化
 */
const handleSelectionChange = (selection: UserListItem[]): void =>
{
  selectedRows.value = selection
  console.log('选中行数据:', selectedRows.value)
}
</script>

<style lang="scss" scoped>
.user-page {
  :deep(.user) {
    .avatar {
      width: 40px;
      height: 40px;
      margin-left: 0;
      border-radius: 6px;
    }

    >div {
      margin-left: 10px;

      .user-name {
        font-weight: 500;
        color: var(--art-text-gray-800);
      }
    }
  }
}
</style>
