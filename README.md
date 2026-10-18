# 诗册 · 悬浮古籍

一本可以在网页里翻开、逐叶翻动、逐首收录诗作的**三维古籍书册**。诗页、绢面封面、书口毛边、霉斑水渍全部是程序即时生成，没有一张位图贴图；翻页带有真实的纸张弯曲、层叠换位与书脊沟槽效果。

## 线上地址

| 用途 | 地址 | 说明 |
| --- | --- | --- |
| 诗册主页（3D 古籍） | <https://poem.mokelin.cn/> | Cloudflare Pages 项目 `poem-book` |
| 诗页浏览 / 排版打印 | <https://poem.mokelin.cn/poems.html> | |
| 诗册编辑台 | <https://poem.mokelin.cn/studio.html> | 可视化增删改，写入 Cloudflare D1 |
| 内容 API | <https://poem-api.mokelin.cn> | Worker `ancient-poetry-api` + D1；workers.dev 为自动回退通道 |

原 GitHub Pages 地址 `https://molelung.github.io/PoemCard/` 已于 2026-10-18 停止服务。

## 目录结构

```
├── index.html          # 三维古籍书册主页面
├── poems.html          # 诗页浏览 / 排版打印
├── studio.html         # 诗册编辑台
├── content.js          # 诗作与装帧数据（改这个文件即可换诗）
├── css/site.css        # 站点样式
├── js/                 # 渲染、排版、印章、API 客户端等模块
├── fonts/              # 仲春仿宋字体
├── libs/three.min.js   # Three.js
├── assets/             # 绢面、印章图片与诗笺素材
└── backend/            # Cloudflare Worker + D1 后端源码（不参与前端部署）
```

## 本地运行

双击 `index.html` 即可打开（无需服务器、无需联网）。详细使用说明见 [说明.md](说明.md)。

## 部署

- 前端：Cloudflare Pages 项目 `poem-book`，直接上传仓库根目录的静态文件（不含 `backend/`）。
- 后端：`backend/` 内的 Worker 部署到 Cloudflare 并绑定 D1，自定义域名为 `poem-api.mokelin.cn`。
- 前端接口地址在 `js/api.js` 的 `CUSTOM_DOMAIN` 中配置，`WORKERS_DEV` 为自动回退通道。

## 迁移记录

- 2026-10-18：由 GitHub Pages 迁移至 Cloudflare Pages；`js/api.js` 与 `studio.html` 中的 API 域名由 `poem.molan.cc.cd` 更新为 `poem-api.mokelin.cn`（workers.dev 备用保留）。
