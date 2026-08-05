<template>
  <div class="joystick-zone" ref="zoneRef" @dragstart.prevent></div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import nipplejs from 'nipplejs';

const props = defineProps({
  lockX: {
    type: Boolean,
    default: false
  },
  lockY: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update', 'end']);
const zoneRef = ref(null);
let manager = null;

onMounted(() => {
  manager = nipplejs.create({
    zone: zoneRef.value,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    size: 100, //稍微调小一点，配合外面的容器
    // 这里颜色设为透明，完全由下方 CSS 接管，这样更灵活
    color: 'rgba(255, 255, 255, 0)',
    threshold: 0.1,
    restOpacity: 1.0, // 保持常亮，不透明
    lockX: props.lockX,
    lockY: props.lockY
  });

  manager.on('move', (evt, data) => {
    if (data && data.vector) {
      emit('update', {
        x: parseFloat(data.vector.x.toFixed(2)),
        y: parseFloat(data.vector.y.toFixed(2))
      });
    }
  });

  manager.on('end', () => emit('end'));

  // 修复：等待父组件动画结束后触发 resize，确保 nipplejs 重新计算坐标
  // 解决 "class=font" (front) 跳动问题
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 600);
});

onUnmounted(() => {
  if (manager) manager.destroy();
});
</script>

<style scoped>
.joystick-zone {
  width: 100%;
  height: 100%;
  position: relative;
  pointer-events: auto;
  touch-action: none; /* 关键：防止触摸滚动干扰 */
  user-select: none;  /* 防止选中 */
}

/* --- 核心修改：自定义 NippleJS 内部样式 --- */

/* 1. 摇杆底座 (.back) */
:deep(.back) {
  background: rgba(255, 255, 255, 0.1) !important; /* 半透明底色 */
  border: 2px solid rgba(255, 255, 255, 0.3) !important; /* 清晰的边框 */
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2) !important;
}

/* 2. 摇杆头 (.front) - 更加突出的拟物风格 */
:deep(.front) {
  /* 加上渐变，模拟球体的光照感 */
  background: radial-gradient(circle at 30% 30%, #ffffff, #aaaaaa) !important;
  /* 加上强阴影，增加悬浮感 */
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.6), inset 0 0 5px rgba(255, 255, 255, 0.8) !important;
  opacity: 1 !important;
  /* 稍微给个边框 */
  border: 1px solid rgba(0,0,0,0.1) !important;
}
</style>