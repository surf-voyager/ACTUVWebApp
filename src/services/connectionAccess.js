export function isOperationalConnectionReady(wsConnected, px4Connected) {
  return wsConnected === true && px4Connected === true;
}

export function connectionUnavailableCopy(wsConnected, px4Connected) {
  if (wsConnected !== true) {
    return {
      title: '后端服务连接已断开',
      description: '正在尝试自动重连后端服务...'
    };
  }

  if (px4Connected !== true) {
    return {
      title: 'PX4 飞控连接已断开',
      description: '后端服务已连接，正在等待 PX4 飞控恢复连接...'
    };
  }

  return null;
}
