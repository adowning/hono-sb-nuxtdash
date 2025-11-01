import { asyncRoutes } from '@/router/routes/asyncRoutes'
import { menuDataToRouter } from '@/router/utils/menuToRouter'
import { AppRouteRecord } from '@/types/router'
import request from '@/utils/http'
import { client, getAllUsersWithBalance, getSupabaseAuthHeaders } from '.'

// 获取用户列表
export function xx(params: Api.SystemManage.UserSearchParams)
{
  // return request.get<Api.SystemManage.UserList>({
  //   url: '/users/balances',
  //   params
  // })
  return getAllUsersWithBalance({ page: params.page || 0, perPage: params.pageSize || 20 })
}

// 获取角色列表
export function fetchGetRoleList(params: Api.SystemManage.RoleSearchParams)
{
  return request.get<Api.SystemManage.RoleList>({
    url: '/api/role/list',
    params
  })
}

interface MenuResponse
{
  menuList: AppRouteRecord[]
}

// 获取菜单数据（模拟）
// 当前使用本地模拟路由数据，实际项目中请求接口返回 asyncRoutes.ts 文件的数据
export async function fetchGetMenuList(delay = 300): Promise<MenuResponse>
{
  try {
    // 模拟接口返回的菜单数据
    const menuData = asyncRoutes
    // 处理菜单数据
    const menuList = menuData.map((route) => menuDataToRouter(route))
    // 模拟接口延迟
    await new Promise((resolve) => setTimeout(resolve, delay))

    return { menuList }
  } catch (error) {
    throw error instanceof Error ? error : new Error('获取菜单失败')
  }
}

export async function fetchGetUserList(params: Api.SystemManage.UserSearchParams)
{
  return await client.api.users.balances.$get({
    query: params
  },
    {
      headers: getSupabaseAuthHeaders
    }
  )
}