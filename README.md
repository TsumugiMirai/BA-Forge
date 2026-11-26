# BA Forge

方便地自制《断箭》（Broken Arrow）单位与专精的网页工具。

网址：<https://tsumugimirai.github.io/BA-Forge/>

## 功能

- **卡面制作**：按游戏数据生成和游戏里一样的单位卡（默认、详细两种视图）。卡上每个数值都能改，也能导入立绘、导出 PNG。卡片可以保存到本机，也可以上传到在线卡库。
- **卡库**：在线卡库由登录的人共享，可以按专精或未分配筛选，按游戏顺序排列。另有本机保存的卡片。
- **中国专精**：设置专精的名称、徽章、介绍和各类别分数。自制卡和游戏单位按类别放进专精，可以拖动排序。

不登录也能做卡、保存到本机；在线卡库和中国专精需要账号，注册需要邀请码。

## 本地运行

```sh
npm install
npm run dev      # http://localhost:5173/BA-Forge/
npm run build    # 类型检查并打包到 dist/
npm run verify   # 检查全部单位、配装、本地化和图片路径
```

推送到 `main` 后，GitHub Actions 会自动部署到 GitHub Pages。

## 服务器

在线卡库、账号和专精数据保存在项目自己的服务器上：PostgreSQL + PostgREST，经 nginx 提供 `https://110.42.238.185/ba-recard/api`（地址见 `src/cloud/config.ts`）。安装、备份和重置密码见 [server/README.md](server/README.md)。服务器上的程序和路径沿用 `ba-recard` 这个名字。

## 目录

```
src/
  card/      卡面模型与渲染
  data/      游戏数据加载，单位到卡面的换算
  state/     页面状态（当前卡片、在线卡库、专精、账号）
  ui/        页头、单位列表、卡片面板、弹窗
  library/   卡库页
  china/     中国专精页
  auth/      登录、注册、账户设置
  cloud/     服务器接口
public/data/    游戏数据库（24 张表 + 本地化，数据版本 1.2.2.1）
public/assets/  从游戏导出的图标、图片和字体
server/         服务器端安装文件
docs/           数据表、卡面布局和素材说明
```

## 来源与许可

- 本项目由 [JohnJinHM/BA-ReCard](https://github.com/JohnJinHM/BA-ReCard)（作者 Starfall，MIT 许可证）发展而来，保留了原项目的全部提交历史。
- 游戏数据来自 [BA-Units](https://github.com/JohnJinHM/BA-Units)。
- 《断箭》的游戏数据、图片和字体归游戏开发商和发行商所有。本项目是玩家自制工具，与官方无关。
- 代码以 [MIT 许可证](LICENSE) 开源。
