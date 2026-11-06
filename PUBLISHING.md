# 上架 DSH 插件市场：现状与剩余步骤

市场的插件列表**不在** dshmarket 仓库里。dshmarket 每次打开都实时拉取
[awesome-dsh-plugin.com/plugins.json](https://awesome-dsh-plugin.com/plugins.json)，
数据源是精选列表仓库 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——
**一个插件一个 YAML 文件**。所以「上架」= 给自己的 GitHub 仓库提一个收录 PR，站点与市场通常一天内生效。

## 一、已经完成的（2026-11-06）

| 事项 | 状态 |
| --- | --- |
| 插件仓库 | ✅ https://github.com/qcy-good/turn-cost-footer （public，main 分支） |
| 提交历史 | ✅ 1 个 commit，15 个文件，工作区干净 |
| 仓库 topic | ✅ `dsh-plugin`、`deepseek-harness` |
| `package.json` 的 `dsh.bundle` | ✅ `dsh.bundle.patch` + `cordis.patch.yml`，另带 `dsh.client` 前端入口 |
| 收录条目 | ✅ `data/plugins/qcy-good__turn-cost-footer.yml`（category: `usage`） |
| 收录 PR | ✅ https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/12704 （只 +1 个文件） |
| 仓库满 1 天 | ⏳ 仓库创建于 2026-11-06T14:46:09Z，**2026-11-07 22:46（北京时间）之后**自动满足 |

## 二、接下来会发生什么（不需要操作）

1. PR 上的 `check` 先跑完（条目路径、YAML、README 生成、awesome-lint、站点构建）。
2. 然后是 `Submission gate`：它读仓库的 `dsh.bundle`、仓库年龄、仓库是否归档。
   现在唯一不满足的是「仓库年龄 ≥ 1 天」，所以 gate 会**红**一次——这是预期结果，不是插件有问题。
3. `regate.yml` 会在这类失败之后自动重跑 gate。满 24 小时后 gate 变绿，维护者复核代码后合并。
4. 合并后站点自动重建，市场下次打开即可搜到。

## 三、可选的两件事

### 1. 换一张新排版的截图

`assets/footer.png` 用的是旧排版（金额在时间之前）。现在的排版是：

```
用量 580K tok 22:17 · 本轮 ¥0.038 · 今日 ¥0.20
```

刷新页面后截一条页脚，覆盖同名文件即可，`screenshots.json` 不用改：

```powershell
cd turn-cost-footer
git add assets/footer.png
git commit -m "refresh footer screenshot"
git push
```

### 2. 发 npm（可选）

不发也能上架，只是市场不显示下载量。名称 `turn-cost-footer` 目前未被占用。

```powershell
npm login --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

包里的 `repository` 已指回本仓库（CI 会核对这一点）。

## 四、如果 CI 报错

失败信息会直接写在 PR 的检查里，在同一分支 push 修复即可，不必重开 PR。常见几类：

- **只声明了 `dsh.client`** → 必须有 `dsh.bundle`（本仓库已有）。
- **仓库年龄不够** → 时间问题，等 `regate` 自动重跑，不要重开 PR。
- **条目 YAML 不合法** → 多为编码问题（UTF-8 存成了 GBK，中文变乱码并吃掉引号）。
  本地自查：`node -e "require('js-yaml').load(require('fs').readFileSync('data/plugins/qcy-good__turn-cost-footer.yml','utf8'))"`。
- **动了别人的条目或生成的 README** → 只保留自己那一个文件。

## 五、相关文件

| 文件 | 作用 |
| --- | --- |
| `market/qcy-good__turn-cost-footer.yml` | 提交给精选列表的条目源文件（与 PR 里的内容一致） |
| `market/PR-body.md` | PR 正文草稿 |
| `screenshots.json` | 市场详情页截图声明（1–8 张，仓库内相对路径） |
| `icon.svg` | DSH 插件列表里的图标（市场 tile 另用 `icon:` 字段，需 GitHub 托管的位图） |
