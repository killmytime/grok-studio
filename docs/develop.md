# 给开发者

用户怎么用，看 [用户手册](./user-guide.md)。这里是仓库、运行时和 CI。

## 技术栈

Next.js 16（App Router，standalone）、React 19、SQLite（`better-sqlite3`）、pnpm、Vitest。Node **22+**（`better-sqlite3@13` 在 20 上会直接崩）。

## 数据目录

运行时数据默认 `./data`，**不入库**。

截图和手册用的是 `docs/demo-data/`，和 `./data` 分开：

```bash
pnpm docs:demo    # 只写 docs/demo-data，再在 :3010 截图
```

`scripts/seed-demo.mjs` / `scripts/screenshot-docs.mjs` 会拒绝指向 `./data`。不要改这两个路径去打生产库。

## 本地

```bash
pnpm install
cp .env.example .env.local
pnpm dev          # next dev -H ::
pnpm test
pnpm build
```

国内可先 `pnpm config set registry https://registry.npmmirror.com`。

`pnpm.onlyBuiltDependencies` 已迁到 `pnpm-workspace.yaml` 的 `allowBuilds`（pnpm 10+ 拦 native 脚本）。Docker 构建必须拷这个文件。

## Docker

```bash
docker compose up -d --build
```

- 基础镜像 `node:22-slim`
- 挂载 `./data:/app/data`（继承本机会话和图片）
- 进程监听 `HOSTNAME=0.0.0.0`（OrbStack 才能转 localhost）
- compose 里 `user: "0:0"`，否则 Mac 上的 SQLite/WAL 可能写不进去
- 不要和 `pnpm dev` 同时开同一个 `data/`

`next.config.ts` 里 `serverExternalPackages: ['better-sqlite3']`，standalone 才能带上 native 模块。

## CI

`.github/workflows/ci.yml`：push / PR 到 `main` 会跑测试、`next build`，并推 `ghcr.io/killmytime/grok-studio`。

仓库 Settings → Actions → Workflow permissions 需要 **Read and write**，否则镜像推不上。

## 聊天里的生图

聊天供应商是 Grok 时，`POST /api/chat` 走 `/v1/responses`，带上 `image_generation` 工具，`store` 为 false。流里的图落到 `data/images/`，库里记模型写出的提示词和标量参数，不存 base64。接着聊时，最近几张会按文件再送回去，所以模型能改刚才的图。

中转返回 404、405 或 501 时，这一次退回 `/v1/chat/completions`。Ollama 不走 Responses。

`images.conversation_id` 可空，外键是 `ON DELETE SET NULL`。删会话后画廊把这些图放在「未归类」。旧库启动时会改这张表。`GET /api/images` 在每个进程里扫一次 `data/images/`，把没有记录的文件补登记进来。

## 目录

```
app/api/           路由
app/lib/           db、供应商、生图/改图/朗读
app/components/    界面（含 GalleryView）
app/gallery/       画廊页
gateway/           Imagen 占位服务（pnpm gateway）
scripts/           样例数据 & 手册截图
docs/screenshots/  手册用图（已入库）
docs/demo-data/    截图用库（不入库）
data/              你自己的运行时数据（不入库）
```

## 手册截图怎么重拍

需要本机有 Playwright Chromium（`pnpm exec playwright install chromium`）。样例图从 Lorem Picsum 拉到 `/tmp/grok-demo-imgs`（`scripts/seed-demo.mjs` 读这个目录）。然后：

```bash
pnpm docs:demo
```

只动 `docs/demo-data` 和 `docs/screenshots`，不动 `data/`。
