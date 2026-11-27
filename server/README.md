# BA Forge 服务器端（在线卡库、账号、自制专精）

网页（GitHub Pages，<https://tsumugimirai.github.io/BA-Forge/>）的在线功能都存在项目自己的腾讯云服务器上。
本文件夹是装到服务器上的全部文件，里面没有任何密码或密钥：密钥在安装时于服务器上生成，只存在服务器里。
服务器上的服务名、路径和数据库仍叫 `ba-recard`（项目改名前起的名字），不影响使用。

## 组成

| 部分 | 位置 |
| --- | --- |
| 服务器 | 腾讯云轻量（上海），`110.42.238.185`；本机 `~/.ssh/config` 里的别名 `personal-server` |
| 网址 | `https://110.42.238.185/ba-recard/api/`，用服务器上已有的 nginx 和 Let's Encrypt IP 证书（由 `particlexx-cert-renew.timer` 自动续期，与本项目无关） |
| API | PostgREST v16.6：`/opt/ba-recard/bin/postgrest`，服务 `ba-recard-api.service`，只监听 `127.0.0.1:3020` |
| 配置（含两个密钥） | `/etc/ba-recard/postgrest.conf`（由 `postgrest.conf.template` 生成） |
| 数据库 | 本机 PostgreSQL 16 的 `ba_recard` 库：`api.cards`、`api.specs`；`private.accounts`（账号：bcrypt 哈希、昵称、角色）、`private.invite_codes`（邀请码）、`private.settings`（令牌密钥）。见 `schema.sql` |
| nginx | `/etc/nginx/conf.d/ba-recard.conf`（限速）、`/etc/nginx/snippets/ba-recard.conf`（路径），外加站点 `/etc/nginx/sites-available/particlexx` 的 HTTPS server 块里一行 `include /etc/nginx/snippets/ba-recard.conf;` |
| 备份 | `ba-recard-backup.timer` 每天 04:30 → `/var/backups/ba-recard/`，保留最近 30 份 |

## 账号和登录怎么工作

- 每人一个账号。在网页上「注册」：填账号、密码（至少 6 位）、可选的昵称，和**邀请码**（`POST /rpc/register`）。
  只有当前有效的邀请码能注册（最初是 `tsumugi`，不分大小写）；管理员可以在网页「账户设置 → 管理」里换码，旧码随即作废。
- 登录：网页把账号密码发到 `POST /rpc/login`（账号不分大小写），服务器用 bcrypt 比对，对了就发一个 30 天有效的令牌（JWT）。
  之后每个请求都带着它（`Authorization: Bearer …`），浏览器会记住它直到过期。
- 没有令牌或令牌无效 → 401，网页回到登录框；账号或密码错 → 403；同一 IP 一分钟内登录/注册太多次 → 429。
- 不登录也能看原版单位、做卡并导出；在线卡库和自制专精页要登录。
- 专精：登录的人都能新建；删除只允许创建者和管理员（最早的 6 个中国专精只有管理员能删）。
- 卡片的作者（`author`/`created_by`）和最后修改人（`editor`/`updated_by`）由服务器按登录的账号自动填写，网页改不了。
  谁都能打开和保存在线卡片；**删除只允许作者本人和管理员**（账号功能上线前的老卡只有管理员能删）。删卡时它也会自动从各专精里移除。
- 角色：`admin`（管理员）和 `member`（成员）。原来的共用账号 `admin` 保留为管理员。管理员在「账户设置 → 管理」里能换邀请码、
  看所有账号、把别人设为管理员/成员、给忘了密码的人重置密码。至少要留一个管理员。
- 只有 `https://tsumugimirai.github.io` 和本机开发用的 `http://localhost:5173` 的网页能跨域调用（CORS）。

## 常用操作（在本机 PowerShell 里运行）

平时改自己的密码在网页「账户设置」里改就行。管理员全都登不进去时，用服务器上的工具设密码（会让所有人重新登录）；
默认账号是 `admin`，后面加名字则是另一个账号：

```powershell
ssh -t personal-server sudo ba-recard-set-password
```

看服务状态和最近的日志：

```powershell
ssh personal-server "systemctl status ba-recard-api --no-pager; sudo journalctl -u ba-recard-api -n 30 --no-pager"
```

马上备份一次：

```powershell
ssh personal-server sudo ba-recard-backup
```

## 更新或重新安装

把这个文件夹（首次安装时再加上 PostgREST 的 `postgrest-v16.6-linux-static-x86-64.tar.xz`）复制到服务器，
再运行 `install.sh`。重复运行会保留数据和现有密钥；nginx 改动先经 `nginx -t` 检查，不通过就自动还原，
现有网站不受影响。要是以后站点配置被重写、丢了那行 `include`，再运行一次也会加回来。

```powershell
scp -r server personal-server:/tmp/ba-recard-setup
```

```powershell
ssh personal-server "cd /tmp/ba-recard-setup && sudo ./install.sh"
```

## 从备份恢复

备份文件自带建库语句。在服务器上（`ssh personal-server`）：

```sh
sudo systemctl stop ba-recard-api
sudo -u postgres dropdb ba_recard
gunzip -c /var/backups/ba-recard/ba_recard-<时间>.sql.gz | sudo -u postgres psql -d postgres
sudo systemctl start ba-recard-api
```

## 迁移记录

2026-11-26 从原来的 Supabase 项目（`qcfpkkwvzqzvmemzmhzs`，悉尼）复制了 30 张卡和 6 个专精，
id、版本号和时间都原样保留。网页不再使用 Supabase；确认新服务器没问题后，可以在 Supabase 后台暂停或删除那个项目。
