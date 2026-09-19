# Grok Studio

自己用的本地工作室：聊天、生图、改图。想到哪做到哪，功能能用就行，不做平台。

现在能做的：

- 会话聊天（Grok 或 Ollama）
- 文生图（Grok，或 LazyCat Imagen / Z-Image-Turbo）
- 改图（只走 Grok；Imagen 不能改图）
- 图片落在本机 `data/`，会话和供应商配置在 SQLite
- 设置里添加供应商、从 `/v1/models` 或 `/v1/audio/voices` 拉列表、按能力绑定聊天/生图/改图/朗读
- 朗读：Qwen3TTS（`wav` 边收边播）；播完存到 `data/audio/`，同一条消息再点就重播缓存
- 可选整站密码（IPv4 / IPv6 / 局域网同一道门）

下一阶段：移动端输入区和顶栏收一收。

## 跑起来

Node 20。国内镜像：

```bash
pnpm config set registry https://registry.npmmirror.com
pnpm install
cp .env.example .env.local   # 填 Grok 地址和 Key
pnpm dev
```

打开 http://localhost:3000 。也绑了 `[::]`，局域网 IP 一样进。

```
GROK_BASE_URL=http://127.0.0.1:3000/v1
GROK_API_KEY=sk-xxx
STUDIO_PASSWORD=          # 可选。设了先登录
DATA_DIR=./data
```

供应商、模型、能力不要堆环境变量，去设置页改。Grok 是基本盘；Ollama、Imagen、Qwen3TTS 在界面添加。TTS 地址形如 `https://qwen3tts-ai.<微服>.heiyu.space`。`0.6b-custom-*` 才有 vivian；`0.6b-base-clone-*` 只有 `dynamic`，要在设置里上传参考音频生成音色后再朗读。

Docker：`docker compose up -d --build`，数据在 volume `grok-data`。

## 怎么用

1. 左侧新建会话
2. Enter 聊天；「生成图片」文生图；选中图再「改图」
3. 图片在右侧（手机底栏切「图片」）
4. 设置：供应商 URL / Key → 拉取模型 → 勾选能力 → 绑定聊天/生图/改图

备份：拷整个 `data/`。

## 几个自己踩过的点

- 聊天和画图不要用同一个模型。
- 中转给的图 URL 会过期，所以立刻下到本地。
- xAI 改图要 JSON + data URI，不是 OpenAI SDK 的 multipart。
- Next 开发模式没有「全部放行 Origin」。黑域隧道把 `ALLOWED_DEV_ORIGINS` 删掉即可（默认含 `**.heiyu.space`）。HMR WebSocket 隧道经常不转，刷新照常用。
- `STUDIO_PASSWORD` 是访问门，不是按 IP 白名单。

## 目录（用到再看）

```
app/api/          路由
app/lib/          db、供应商、能力、生图/改图
app/components/   界面
data/             运行时数据库和图片（不入库）
gateway/          无 GPU 时的 Imagen 占位服务（pnpm gateway）
```

测试：`pnpm test`。
