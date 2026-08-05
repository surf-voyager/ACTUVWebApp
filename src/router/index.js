import { createRouter, createWebHistory } from 'vue-router'
// 先把组件 import 进来，虽然现在文件是空的，下一步会创建
import DashboardView from '../views/DashboardView.vue'
import PlannerView from '../views/PlannerView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/dashboard' // 默认进主控台
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView
    },
    {
      path: '/planner',
      name: 'planner',
      component: PlannerView
    }
  ]
})

export default router