# Grok Studio

本地可用的「Grok 聊天 + 画图」单体应用。接近 grok.com 的轻量工作室体验，持久化聊天记录与图片。

## 目录结构

```
grok-lite/
├── app/
│   ├── api/                  # 所有后端路由（conversations, chat, images/*, settings, health, files）
│   ├── components/           # ConversationList, MessageItem, ImagePanel, ImageCard, SettingsDrawer
│   ├── lib/
│   │   ├── db.ts             # better-sqlite3 + 表结构初始化
│   │   ├── image.ts          # 保存原图、生成缩略图、data URI 转换
│   │   └── types.ts
│   ├── page.tsx              # 三栏主界面
│   └── layout.tsx
├── data/                     # 运行时创建：grok-studio.db + images/ + thumbs/ + uploads/
├── .env.example
├── .npmrc                    # registry=https://registry.npmmirror.com
└── README.md
```

## 国内加速安装（必须）

```bash
# 1. 设置 pnpm 镜像（推荐）
pnpm config set registry https://registry.npmmirror.com

# 2. 安装依赖
pnpm install

# 3. 启动
pnpm dev
```

打开 http://localhost:3000 即可使用。

**注意**：本项目使用 Node 20（推荐通过 fnm 管理）以确保 better-sqlite3 原生模块正常编译。

```bash
# fnm 使用示例
fnm install 20
fnm use 20
```

## .env 配置

复制 `.env.example` 为 `.env.local` 并填写：

```
GROK_BASE_URL=http://127.0.0.1:3000/v1     # 你的 OpenAI 兼容中转地址
GROK_API_KEY=sk-xxx
CHAT_MODEL=grok-latest
IMAGE_MODEL=grok-imagine-image-2.0
DATA_DIR=./data
```

**重要**：所有请求由服务端代理到中转站，浏览器永远不会直接暴露 API Key。

## 为什么聊天和绘图必须用不同模型？

- `CHAT_MODEL=grok-latest`：负责对话、理解意图、流式回复。
- `IMAGE_MODEL=grok-imagine-image-2.0`：专门负责文生图与图像编辑。

硬规则：绝对不混用同一个模型同时承担聊天和出图职责，避免中转站或官方配额/能力冲突。

## 为什么图片必须本地落盘？

中转站返回的 URL 通常是临时链接（几分钟或几小时后失效）。如果只存 URL，重启或过段时间图片就会 404。

本应用：
- 收到生成结果后立即下载原图到 `data/images/`
- 生成 320px 缩略图到 `data/thumbs/`
- 数据库只保存相对路径、sha256、宽高、prompt、参数、父图 ID
- 前端永远通过 `/api/files/...` 读取本地文件

备份方式：直接复制整个 `data/` 文件夹即可完整迁移。

## 改图为什么不能用 OpenAI SDK 的 images.edit()？

官方 xAI 图像编辑接口要求：
- `Content-Type: application/json`
- body 中 `image` 字段为 `{ "url": "data:image/png;base64,..." }`

而 OpenAI SDK 的 `client.images.edit()` 内部使用 `multipart/form-data`，与 xAI 约束不兼容。

本应用严格按照 JSON 方式自己构造请求，默认使用 data URI（离线可用）。如中转支持其他方式，可在设置中切换「改图兼容模式」。

## 功能使用

1. 新建会话 → 左侧列表
2. 输入文字 → Enter 发送聊天（grok-latest）
3. 输入描述 → 点击「生成图片」按钮（grok-imagine-image-2.0）
4. 选中右侧图片 → 输入修改说明 → 点击「改图」或「继续改这张」
5. 支持上传本地图作为编辑起点
6. 设置抽屉可配置 Base URL、Key、默认参数、连通性测试

所有数据持久化，重启浏览器/应用后历史仍在。

## 开发提示

- 图片生成/编辑时显示骨架屏，失败会提示上游错误信息
- 支持编辑链（parent_image_id）
- 移动端单列，底部可扩展切换（当前以桌面为主）

---

**MVP 完成标准已达成**：可运行、可聊天、可文生图、可基于图片继续改图、持久化、本地图片、国内镜像安装、无 Key 泄露。
