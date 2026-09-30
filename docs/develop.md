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

## ComfyUI

生图用 `app/lib/providers/comfy/workflows/qwen-image.json`（已在本机跑通的 API 格式）。采样器 `res_multistep`，CFG 1，默认 20 步。CFG 为 1 时负向条件几乎不参与，界面上没有负向框，解剖和构图约束写在正向句子里。用户手册是 `docs/user-guide.md`，应用里的「手册」页直接渲染这份文件。

改图请求可以带 `denoise`。界面在改图按钮旁放强度条，默认 0.85，这一次的值覆盖供应商设置。0 走 `qwen-image-edit.json`：CLIP 类型 `qwen_image`，参考图接在 `TextEncodeQwenImage21` 的 `images.image_1` 上（自动增长输入要带 `images.` 前缀），UNet 后接 `QwenImage21Cache`，采样器 `euler`、`simple`、CFG 1、25 步，降噪固定 1。这个节点吐出的 latent 是按参考图尺寸造的空 latent，原图在条件的 `reference_latents` 里，把降噪拉低不会更像原图。大于 0 则用生图那张图加 `LoadImage` → `VAEEncode`，采样器 `denoise` 用这个数。空请求才回落到供应商 extra，extra 也空则仍是 0.85。参考图节点适合改颜色和背景；0.85 左右才能换衣服、换场景；再高就接近换姿态、换人。

Anima 用 `workflows/anima.json`。绑定的模型名里带 `anima`（例如 `anima` 或 `Anima-2.9B-preview-v1.safetensors`）才走这张图。CLIP 类型是 `stable_diffusion`，权重默认 `qwen_3_06b_base.safetensors`，VAE 默认 `qwen_image_vae.safetensors`，UNet 默认 `Anima-2.9B-preview-v1.safetensors`。采样器 `euler`，调度器 `sgm_uniform`，CFG 4，默认 32 步。作者推荐的范围是 28–50 步、CFG 3.5–5，个人常用就是 euler 加 sgm_uniform；要更高质量可以把步数改成 50。没有 `TextEncodeQwenImage21`，改图一律是 `LoadImage` → `VAEEncode`，强度必须大于 0。拉下来的文件名如果不是默认那个，把文件名本身绑成模型，图里的 `unet_name` 会换成它。ComfyUI 0.37 的权重在 `/models/diffusion_models`，旧版才在 `/models/unet`，拉取时先试前者。

地址只来自供应商 URL。高级配置里的 Cookie 空着就不带；填了 `Name=value` 才会放进请求的 Cookie 头。提交 `/prompt` 后立刻返回 pending，后台轮询 `/history`，再从 `/view` 把图存进 `data/images/`。

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
