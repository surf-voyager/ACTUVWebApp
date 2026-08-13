# ACTUV WebApp

基于 Vue 3 与 Vite 的 ACTUV 地面站前端。差分定位和 SSH 后端运维使用 Vite 开发服务器桥接，因此日常运行应使用下述启动脚本或 `npm run dev`，不能用静态文件服务器替代。

## 推荐启动方式

Linux / WSL：

```bash
./start-frontend.sh
```

Windows：双击 `start-frontend.bat`，或在终端中执行：

```bat
start-frontend.bat
```

启动器会自动完成以下检查：

1. 检查 Node.js 与 npm；
2. 检查固定端口 `5173`；
3. 检查依赖，必要时执行 `npm ci`；
4. 根据源码、配置、依赖锁文件和 `dist/` 摘要判断是否需要重新编译；
5. 必要时执行 `npm run build`；
6. 前台启动监听 `0.0.0.0:5173` 的 Vite 服务。

启动器不会自动安装或升级 Node.js。当前 Vite 7 要求 Node.js `^20.19.0` 或 `>=22.12.0`。服务器以前台方式运行，通过 `Ctrl+C` 停止，不会自动打开浏览器。

固定访问地址为 `http://localhost:5173/`；局域网设备可以通过运行前端的计算机 IP 和端口 `5173` 访问。若该端口已运行本项目，启动器不会创建第二个实例；若被其他程序占用，启动器会报错退出。

编译状态保存在被 Git 忽略的 `dist/.actuv-build-state.json`，依赖状态保存在 `node_modules/.cache/actuv-launcher/dependency-state.json`。状态文件只有在对应操作成功后才会更新。

## 手动命令

```bash
npm ci
npm run build
npm run dev
```

启动器单元测试：

```bash
npm run test:startup
```
