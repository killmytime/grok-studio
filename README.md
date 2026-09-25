# Grok Studio

本地 AI 工作室：聊天、文生图、改图、朗读、画廊。数据只存在你磁盘上的 `data/`，没有账号、没有云同步。

Grok 是基本盘。Ollama、Imagen（Z-Image-Turbo）、Qwen3TTS 在设置里按需添加，走 OpenAI 兼容接口。

**想先看怎么用：** [用户手册](docs/user-guide.md)  
**改代码 / Docker / CI：** [开发者说明](docs/develop.md)

截图是独立样例数据（风景和静物），不是真实聊天记录。

![工作室](docs/screenshots/studio-chat.png)

![画廊](docs/screenshots/gallery.png)

## 用户

### 能做什么

- **聊天**：多会话；长对话会压摘要；编辑用户消息会截断后面再生成。绑 Grok 时可以边聊边画，图进当前会话和画廊
- **生图 / 改图**：输入框上的按钮走单独绑的生图 / 改图后端。Grok 能生也能改；Imagen 只能生图。成品立刻存本地
- **画廊**：`/gallery` 看全部作品，能跳回原来的会话，也能当场生图、改图、删除。删了会话，图还在，归到「未归类」
- **朗读**：Qwen3TTS，边收边播，缓存到 `data/audio/`
- **可选整站密码**：IPv4 / IPv6 / 局域网同一道门

备份：拷整个 `data/`。

### 跑起来

Node 22+。

```bash
pnpm install
cp .env.example .env.local   # 填 Grok 地址和 Key
pnpm dev
```

打开 http://localhost:3000 。画廊：http://localhost:3000/gallery 。

```
GROK_BASE_URL=http://127.0.0.1:3000/v1
GROK_API_KEY=sk-xxx
STUDIO_PASSWORD=          # 可选。设了先登录
DATA_DIR=./data
```

供应商、模型和能力去设置页绑定，不必堆环境变量。

Docker：

```bash
docker compose up -d --build
```

会把本机 `./data` 挂进容器。不要和 `pnpm dev` 同时开同一个库。

更细的操作逐步看 [用户手册](docs/user-guide.md)。

---

## 开发者

栈：Next.js 16 + React 19 + SQLite。Node 22+（`better-sqlite3@13` 不支持 20）。

```bash
pnpm test
pnpm build
```

push 到 `main` 会跑 CI，并把镜像推到 `ghcr.io/killmytime/grok-studio`。仓库 Actions 权限需 **Read and write**。

手册截图用独立目录 `docs/demo-data`（不入库）。重拍：`pnpm docs:demo`。脚本会拒绝写 `./data`。

细节、目录和踩过的坑：[开发者说明](docs/develop.md)。
