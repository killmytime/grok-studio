# Grok Studio

自己用的本地工作室。聊天、生图、改图、朗读、看画廊。数据全在本机，不做平台、不登录云、不搞账号系统。

想接哪家模型就在设置里加，Grok 是基本盘，Ollama / Imagen / Qwen3TTS 按需插上。

## 能干啥

**聊天**
- 开多个会话，Enter 发送，Shift+Enter 换行
- 走 Grok 或 Ollama（OpenAI 兼容接口）
- 长对话大约 20 条以上会压成摘要，下次请求带上，方便命中缓存
- 编辑用户消息会截断后面再生成；助手消息可重试，不会再插一条用户消息
- 手机也能用

**生图 / 改图**
- 文生图：Grok，或 LazyCat Imagen / Z-Image-Turbo
- 改图：只走 Grok（Imagen 不能改图）
- 图立刻下到本机 `data/images/`，中转 URL 会过期
- 会话右侧是当前会话的图；选中后可以接着改

**画廊** `/gallery`
- 所有会话的作品摊在一起看
- 每张图能看出在哪个会话，点「去对话」跳回去
- 画廊里就能生图、改图、删除（单张或整理多选）
- 没截图。自己跑起来看比截图清楚，而且图里可能有不想公开的内容

**朗读**
- Qwen3TTS，`wav` 边收边播
- 播完存 `data/audio/`，同一条消息再点就重播缓存
- CustomVoice 有 vivian 等固定音色；clone 镜像只有 `dynamic`，要先在设置里传参考音频生成音色

**供应商**
- 设置里填 URL / Key，从 `/v1/models` 或 `/v1/audio/voices` 拉列表
- 按能力勾选：聊天 / 生图 / 改图 / 朗读，再绑定用哪家
- 聊天和画图不要绑同一个模型

**访问**
- 可选整站密码（`STUDIO_PASSWORD`）。IPv4 / IPv6 / localhost / 局域网同一道门
- 不设密码则谁能连上端口谁就能用。不是按 IP 白名单

备份：拷整个 `data/`。会话、图、音频、供应商配置都在里面。

## 跑起来

Node 22+。国内镜像：

```bash
pnpm config set registry https://registry.npmmirror.com
pnpm install
cp .env.example .env.local   # 填 Grok 地址和 Key
pnpm dev
```

打开 http://localhost:3000 。开发模式也绑了 `[::]`，局域网 IP 一样进。画廊在 http://localhost:3000/gallery 。

```
GROK_BASE_URL=http://127.0.0.1:3000/v1
GROK_API_KEY=sk-xxx
STUDIO_PASSWORD=          # 可选。设了先登录
DATA_DIR=./data
```

供应商、模型、能力不要堆环境变量，去设置页改。TTS 地址形如 `https://qwen3tts-ai.<微服>.heiyu.space`。`0.6b-custom-*` 才有 vivian；`0.6b-base-clone-*` 只有 `dynamic`。

测试：`pnpm test`。

## Docker

```bash
docker compose up -d --build
```

把本机 `./data` 挂进容器，本地聊过的会话和图片会接上。不要和 `pnpm dev` 同时开同一个库。

OrbStack / Docker Desktop 打开 http://localhost:3000 。

## GitHub Actions

仓库里有 `.github/workflows/ci.yml`。push 到 `main`（或给 `main` 开 PR）会：

1. 跑测试和生产构建
2. 打 Docker 镜像
3. 推到 `ghcr.io/killmytime/grok-studio:latest`

**你要做的只有一件一次性的事：** 仓库 Settings → Actions → General → Workflow permissions 选 **Read and write**，保存。否则测构建能过，镜像推不上 GHCR。

然后正常 `git push` 就行，去仓库的 **Actions** 页看跑没跑起来。第一次成功之后：

```bash
docker pull ghcr.io/killmytime/grok-studio:latest
```

私有仓库的包默认也是私有的，拉镜像要先 `docker login ghcr.io`。

## 怎么用

1. 左侧新建会话
2. Enter 聊天；「生图」文生图；选中图再「改图」
3. 顶栏「画廊」看全部作品；右侧栏是当前会话的图
4. 设置：供应商 URL / Key → 拉取模型 → 勾选能力 → 绑定聊天/生图/改图/朗读

## 几个自己踩过的点

- 聊天和画图不要用同一个模型
- 中转给的图 URL 会过期，所以立刻下到本地
- xAI 改图要 JSON + data URI，不是 OpenAI SDK 的 multipart
- Next 开发模式没有「全部放行 Origin」。黑域隧道把 `ALLOWED_DEV_ORIGINS` 删掉即可（默认含 `**.heiyu.space`）。HMR WebSocket 隧道经常不转，刷新照常用
- `STUDIO_PASSWORD` 是访问门，不是按 IP 白名单
- Docker 里 `better-sqlite3@13` 要 Node 22+；容器监听 `0.0.0.0`，别绑 `::`，OrbStack 才能把 localhost:3000 转进来

## 目录（用到再看）

```
app/api/          路由
app/lib/          db、供应商、能力、生图/改图
app/components/   界面（含画廊）
app/gallery/      画廊页
data/             运行时数据库和图片（不入库）
gateway/          无 GPU 时的 Imagen 占位服务（pnpm gateway）
.github/workflows  push 之后的测试 / 镜像构建
```
