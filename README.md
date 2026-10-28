# 光影集 · LUMIÈRE

一个部署在 **GitHub Pages** 上的公共摄影画廊：

- 访客无需账号，只读浏览
- 注册用户（邮箱 + 密码）可以上传作品
- 每位用户只能编辑、删除自己的作品
- 管理员可以管理全部作品
- 账号、数据库、图片存储由 **Supabase** 提供

前端是纯静态页面，没有构建步骤，也不需要服务器。

## 在线地址

<https://mjg070120.github.io/GYJ/>

## 部署 / 初始化

代码推到仓库后，还需要在 Supabase 完成三步。

### 1. 建表、权限和存储桶

打开 Supabase Dashboard → **SQL Editor** → New query，把
[`supabase/schema.sql`](supabase/schema.sql) 整段粘贴进去并执行。

脚本会创建：

- `profiles`：昵称、管理员标记
- `photos`：作品信息、作者、EXIF、文件路径
- `photos` Storage 桶：公开读取，登录用户只能写自己的目录
- RLS 策略：公开可读、登录可上传、仅作者和管理员可改/删

### 2. 配置登录回跳地址

Supabase Dashboard → **Authentication → URL Configuration**：

- **Site URL**：`https://mjg070120.github.io/GYJ/`
- **Redirect URLs**：添加
  - `https://mjg070120.github.io/GYJ/**`
  - 本地调试时再加 `http://127.0.0.1:4180/**`

否则注册确认邮件里的链接会跳回 `localhost:3000`。

### 3. 设置管理员

1. 在网站注册一个账号，并完成邮箱验证。
2. 在 Supabase **Table Editor → profiles** 里找到这一行，把 `is_admin` 改成 `true`。
   （或者执行 `schema.sql` 末尾注释里的 SQL，把邮箱换成你的。）
3. 刷新网站并重新登录，右上角菜单会出现「管理员」。

## 本地预览

在项目目录跑一个静态服务器即可（Supabase 不依赖 localhost）：

```bash
python -m http.server 4180
```

然后打开 <http://127.0.0.1:4180/>。

## 目录

```
index.html              页面
config.js               Supabase URL + publishable key（公开，安全）
assets/css/style.css    样式
assets/js/app.js        画廊 / 登录 / 上传 / 权限
assets/js/exif.js       EXIF 读取
assets/vendor/          Supabase JS SDK（本地托管）
supabase/schema.sql     数据库与 Storage 初始化脚本
```

## 安全说明

- 提交到仓库的是 Supabase **publishable / anon key**，它本来就是给浏览器公开使用的。
- **绝对不要**把 `service_role` / secret key、数据库密码写进这个仓库或 `config.js`。
- 真正的权限由数据库 RLS 和 Storage 策略保证：即使有人绕过前端直接调 API，也只能读写自己的数据。
- 访客可以读取全部作品元数据和公开图片 URL，这是公共画廊的预期行为。
- 删除作品时，前端会先删数据库记录，再删除 Storage 文件；两者都受 RLS 约束。

## 数据归属

- 每条 `photos` 记录都有 `owner_id`，等于上传者的 `auth.uid()`。
- Storage 路径是 `<user-id>/<photo-id>.jpg`，策略会校验路径第一段必须等于当前用户。
- 管理员通过 `profiles.is_admin` 判断；该字段只能由数据库管理员（或 SQL）修改，前端无法自助提升权限。
