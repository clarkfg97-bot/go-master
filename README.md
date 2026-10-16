# 围棋大师（本地 3D 版）
- 规则：中国规则（数子法、贴 7.5 子、禁止自杀、全局同形禁手）。9 / 13 / 19 路，支持让 2–9 子
- 引擎：GNU Go 3.8（GPL-3.0，见 engine/GNUGO-COPYING.txt）。难度 1–5 对应引擎 level 0/2/5/8/10，属业余中级水平，适合入门到进阶
- 启动：双击 `start.command`，或 `node server.js` 后打开 http://localhost:5174
- 学习功能：气数显示（红=打吃）、落子讲解（提子/打吃/打劫/自断气警告）、提示（3 个候选点 + 文字原因）、形势判断（势力范围）、终局点击标记死子再数子、「学围棋」规则速览、SGF 导出
- 悔棋：玩家每局 5 次；电脑不可悔棋
- 引擎查找顺序：`GNUGO_BIN` → `engine/gnugo-macos`（Apple 芯片，-O0 编译；GNU Go 3.8 用 -O2 在 arm64 上会崩）→ `/usr/games/gnugo`（Docker 里 apt 安装）
- 部署：Render 免费 Docker 服务（见 `render.yaml` / `Dockerfile`），首次访问冷启动约 1 分钟
- 注意：GNU Go 只在落子时使用 `--chinese-rules --positional-superko --forbid-suicide`；形势估算是引擎的领地估计，中盘误差较大
