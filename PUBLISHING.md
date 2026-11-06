# 上架 DSH 插件市场：现状与操作步骤

市场的插件列表**不在** dshmarket 仓库里。dshmarket 每次打开都实时拉取
[awesome-dsh-plugin.com/plugins.json](https://awesome-dsh-plugin.com/plugins.json)，
数据源是精选列表仓库 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——
**一个插件一个 YAML 文件**。所以「上架」= 给自己的 GitHub 仓库提一个收录 PR，站点与市场通常一天内生效。

## 一、资格对照（按 contributing.md 逐条）

| 要求 | 本插件 | 备注 |
| --- | --- | --- |
| 仓库 `package.json` 声明 `dsh.bundle` | ✅ | `dsh.bundle.patch` + `cordis.patch.yml` 都在，`dsh.client` 另带前端 |
| 仓库里有真实可用代码 | ✅ | Host 折叠会话日志 + Client 页脚注入，已在本机实际运行验证 |
| 仓库创建满 1 天 | ⏳ | 硬门槛，由 CI 检查；建仓后**第二天**才能提 PR |
| 仓库加 `dsh-plugin` topic | ⏳ | 建仓后加 |
| 描述属实、无营销词 | ✅ | 见 `market/ENTRY.template.yml`，只写功能与实现方式 |
| 分类贴合 | ✅ | `usage`（用量与计费），与市场里的「用量与计费」分类一致 |
| 不是纯聚合包 | ✅ | 自带 Host + Client 行为，不是依赖清单 |
| 依赖指向原作者 | ✅ | 零运行时依赖（只用 `node:fs`/`node:os`/`node:path`） |
| npm 包（可选） | 可发 | 名称 `turn-cost-footer` 在 npm 上未被占用（2026-11-06 查为 404） |
| 截图（可选） | ✅ | `screenshots.json` → `assets/footer.png`，GitHub 托管的仓库内位图 |
| 收录 ≠ 已被覆盖 | 见下 | 市场里 `dsh-cost-meter` 做的是侧边栏看板/预算图表，本插件是**页脚内联的单轮金额与今日累计**，粒度与位置都不同；描述里已写明这点，评审会核代码 |

结论：**具备条件**，唯一缺的是「GitHub 仓库」这份载体，以及建仓后满 1 天。

## 二、本机目前的限制（为什么剩下的步骤要你来做）

这台机器上：

- 没有 `gh` CLI，也没有任何 GitHub 凭据（无 token、无 SSH key、无 credential helper）；
- 直连 `github.com` 的连接被重置（`git ls-remote` 直接 `Connection was reset`）；
- `npm` 未登录，且 registry 指向 `registry.npmmirror.com`。

所以「建仓库 / 推送 / 开 PR / 发 npm」这四步必须在你自己的浏览器或已登录的机器上完成。
下面所有**能本地做的**都已经做好了。

## 三、步骤

### 0. 先把占位符换掉

`package.json`、`LICENSE`、`market/ENTRY.template.yml` 里有 `__GITHUB_OWNER__`。换成你的 GitHub 账号：

```powershell
cd turn-cost-footer
$owner = '你的GitHub账号'
foreach ($f in 'package.json','LICENSE','market\ENTRY.template.yml') {
  (Get-Content $f -Raw).Replace('__GITHUB_OWNER__', $owner) | Set-Content $f -Encoding utf8NoBOM
}
```

### 1. 建仓库并推送

先在 GitHub 网页上新建 public 仓库 `turn-cost-footer`（**不要**勾选初始化 README），然后：

```powershell
cd turn-cost-footer
git init -b main
git add -A
git commit -m "turn-cost-footer 0.1.0"
git remote add origin https://github.com/<你的账号>/turn-cost-footer.git
git push -u origin main
```

> 本仓库已经 `git init` + 首次提交过了；若你换机器，直接 `git clone` 自己的仓库即可。

### 2. 加 topic

仓库页 → About 右侧齿轮 → Topics 填 `dsh-plugin` → 保存。
（有 `gh` 的话等价于 `gh repo edit --add-topic dsh-plugin`。）

### 3. 截图（可选但推荐）

`assets/footer.png` 目前用的是你提供的那张页脚截图（旧排版：金额在时间之前）。
刷新页面看到新排版后，重新截一张覆盖同名文件即可，路径不用改。

### 4. 发 npm（可选）

不发也能上架，只是市场不显示下载量。

```powershell
npm publish --access public --registry=https://registry.npmjs.org/
```

前提：先 `npm login --registry=https://registry.npmjs.org/`；包里的 `repository` 必须指回被收录的仓库（已配好）。

### 5. 提收录 PR（建仓满 1 天后）

在 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库里**新增一个文件**：

```
data/plugins/<你的账号>__turn-cost-footer.yml
```

内容照抄 `market/ENTRY.template.yml`（记得把 `__GITHUB_OWNER__` 换掉）。
用网页操作最省事：先 Fork → 在自己 fork 里 Add file → Create new file → 粘内容 →
然后在 fork 的首页点 Contribute → Open pull request，标题和正文抄 `market/PR-body.md`。

只加这一条、不改生成的 README，是 CI 明确支持的形态。

### 6. 等 CI 与人工评审

CI 依次检查：条目数 ≤ 3 → 仓库 `dsh.bundle` → 仓库年龄 ≥ 1 天 → `awesome-lint` 与站点构建。
通过之后维护者会读代码核对描述，然后合并；合并后站点自动重建，市场下次打开就能搜到。

失败会通过 PR 评论指出要改什么，在同一分支 push 修复即可，不必重开 PR。
被打上 `held: author` 不是拒绝，只是等修改后重新评审。
