import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { title: '项目首页 - AI Frontend Lab' },
  },
  {
    path: '/m1',
    name: 'Module1',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块1：AI API 基础 (Vue)', moduleId: 'm1' },
  },
  {
    path: '/m2',
    name: 'Module2',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块2：流式响应 (Vue)', moduleId: 'm2' },
  },
  {
    path: '/m3',
    name: 'Module3',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块3：Prompt 实验室 (Vue)', moduleId: 'm3' },
  },
  {
    path: '/m4',
    name: 'Module4',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块4：Chat UI (Vue)', moduleId: 'm4' },
  },
  {
    path: '/m5',
    name: 'Module5',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块5：Function Calling (Vue)', moduleId: 'm5' },
  },
  {
    path: '/m6',
    name: 'Module6',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块6：RAG 检索增强 (Vue)', moduleId: 'm6' },
  },
  {
    path: '/m7',
    name: 'Module7',
    component: () => import('@/views/ModulePlaceholder.vue'),
    meta: { title: '模块7：AI Agent (Vue)', moduleId: 'm7' },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach((to, _from, next) => {
  if (to.meta?.title) {
    document.title = to.meta.title as string;
  }
  next();
});

export default router;
