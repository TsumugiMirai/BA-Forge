# [BA-ReCard](https://johnjinhm.github.io/BA-ReCard/)

**数据库版本：1.2.2.1** — 545 个单位、24 张表、16,805 条记录，包含 DLC3 俄罗斯近卫军。

更新数据后运行 `npm run verify` 与 `npm run build`，检查全部单位、配装选项、
默认装备和图片路径。生产预览启动后，可运行
`node scripts/e2e-refresh.mjs <预览地址>` 验证 DLC3 卡片及 PNG 导出。

复刻《断箭》(Broken Arrow) 的**单位信息卡**——
根据单位数据还原卡面，支持手动编辑与导入图片，并导出为 PNG。

数据来源：**[BA-Units](https://github.com/JohnJinHM/BA-Units)**

技术栈：**React + TypeScript + Vite**，已部署到 GitHub Pages。

> 🇺🇸 [English](README.md)

## 目录结构

```
src/
  data/        表结构、加载器/索引 (GameDb)、单位→卡片解析器
  card/        CardModel（可编辑的视图模型）+ 卡片渲染器
  state/       zustand 状态（选中项、变体、编辑内容、紧凑模式）
  ui/          单位选择器、变体面板、头像裁剪对话框
  export/      DOM → PNG 光栅化（html-to-image，2× 像素比）
public/
  data/        游戏数据库导出（24 张表 + 本地化，来自 BA-Units）
  assets/      提取的游戏素材（图标/边框/武器/弹药/旗帜/
               头像/缩略图/字体）——由 scripts/extract-assets.mjs 生成
docs/
  DATA_SCHEMA.md       24 张表及其关联图
  INFOCARD_SCHEMA.md   游戏内卡片控制器/预制体 → 数据的映射
  extracted/
    PREFAB_LAYOUT.md   提取的卡片几何、配色、字体（408×710 规格）
    ASSETS.md          提取的素材目录 + InfocardConfig 映射
```

## 开发

```sh
npm install
npm run dev        # http://localhost:5173/BA-ReCard/
npm run build      # 类型检查 + 生产构建到 dist/
npm run deploy     # 构建并把 dist/ 发布到 gh-pages 分支
```

更新材质：先对游戏重新运行 AssetRipper，然后执行：

```sh
node scripts/extract-assets.mjs <ExportedProject 路径>
```

刷新数据库：运行 [BA-Units](https://github.com/JohnJinHM/BA-Units) 并替换 `public/data/`。

## 在线卡库（可选）

右侧“在线卡库”让打开网页的人共用一份卡片库：上传、打开、修改后保存、另存、删除，无需登录。
它存在一个 Supabase 免费项目里：在项目的 SQL Editor 运行 `docs/cloud-setup.sql`，
再把 Project URL 和 anon（publishable）key 填进 `src/cloud/config.ts`（两者本来就是给网页公开用的，
不要填 service_role / secret key）。不填则不显示在线卡库。两人同时修改同一张卡时，后保存的一方会收到提示，不会互相覆盖；
导入的大图片上传前会转成 WebP 以减小体积。

在线功能需要先登录（`src/auth/auth.ts` 里一个共用账号，只比对账号密码的哈希）。这只是挡住随手点进来的人：
数据库钥匙就在网页里，懂行的人能绕过。

“中国专精”页（网址末尾加 `#china`）是开发用的设置页：六个预设专精，在线修改名称、图标、介绍，
并把在线卡库的自制单位或游戏单位分配进去，每个专精单独保存，同样防止互相覆盖。
它用 Supabase 的 `specs` 表，建表 SQL 在 `docs/specs-setup.sql`。

## 工作原理

1. `loadGameDb()` 拉取全部 24 张表 + 本地化，并建立 id/外键索引。
2. `resolveCard(db, unitId, selection)` 关联单位的装甲/机动/传感器/技能/炮塔/武器/弹药，
   套用所选的改装 **Options**（装甲/机动/炮塔/造价/名称覆盖——即游戏内的变体系统），
   最终输出一个所有可见字段都为字符串的 `CardModel`。
3. `UnitCard` 按游戏内prefab渲染 `CardModel`：408×710，顶部头像栏
   （名称、点数、技能、装甲、属性图标），下方为两栏武器区；
   紧凑模式则替换为逐行信息。当前样式还会加入归队计时（return to battlegroup）、
   武器的消音/近战图标以及弹药制导图标；**旧版（Legacy）** 开关可切回此前的卡片样式。
4. **编辑模式**把卡上每个数值变成 contentEditable 区块——编辑会修改 `CardModel` 副本，
   因此任何字段都可覆盖（或设为 `-`）。
5. **导入图片…**通过裁剪对话框上传图片，尺寸固定为游戏内的 816×550 
6. **导出 PNG** 以 2× 光栅化卡片 DOM，并隐藏编辑描边。

## 文档

- [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) —— 从游戏 `DataBaseCompiled.asset`
  提取的 24 张 JSON 表及其关联方式。
- [docs/INFOCARD_SCHEMA.md](docs/INFOCARD_SCHEMA.md) —— 游戏内 `UnitInfoCard`
  控制器及其数据库如何映射到Prefab。
- [docs/extracted/PREFAB_LAYOUT.md](docs/extracted/PREFAB_LAYOUT.md) —— 从Prefab
  YAML 提取的卡片结构、配色与字体（408×710 规格）。
- [docs/extracted/ASSETS.md](docs/extracted/ASSETS.md) —— 提取的素材目录与
  `InfocardConfig` Sprite映射。

## 路线图

- [x] 基于 `public/data/tables/` 的数据加载 + 关联层
- [x] 单位 → 卡片视图
- [x] 完整版卡片渲染
- [x] 紧凑版卡片渲染
- [x] 手动编辑支持
- [x] 图片导入与裁剪（816×550）
- [x] PNG 导出
- [x] 从游戏导出Sprite/字体素材
- [x] 本地化（英/中）
- [x] 编辑模式下替换武器图标（上传自定义武器 logo）
- [x] 自定义卡片数据库（把编辑后的卡片以 JSON 存取到 localStorage）
- [x] 新版卡片样式：归队计时 + 武器消音/近战图标 + 弹药制导图标
- [x] 旧版样式开关

