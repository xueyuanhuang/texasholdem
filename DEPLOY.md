# 📱 部署到 iPhone

## 方法：使用 GitHub Pages（免费）

### 步骤 1：准备文件

```bash
# 重命名 app.html 为 index.html
mv app.html index.html
```

### 步骤 2：推送到 GitHub

```bash
# 初始化 git 仓库（如果还没有）
git init

# 添加文件
git add index.html

# 提交
git commit -m "Initial commit"

# 创建 GitHub 仓库后，推送
git remote add origin https://github.com/你的用户名/texasholdem.git
git branch -M main
git push -u origin main
```

### 步骤 3：启用 GitHub Pages

1. 打开你的 GitHub 仓库
2. 点击 **Settings** (设置)
3. 左侧菜单找到 **Pages**
4. **Source** 选择：
   - Branch: `main` 或 `master`
   - Folder: `/ (root)`
5. 点击 **Save**

### 步骤 4：等待部署

- 几分钟后，GitHub 会给你一个 URL：
- `https://你的用户名.github.io/texasholdem/`

### 步骤 5：添加到 iPhone 主屏幕

1. 在 iPhone Safari 中打开上面的 URL
2. 点击底部的 **分享** 按钮（方框加向上箭头）
3. 向下滚动，点击 **添加到主屏幕**
4. 点击 **添加**
5. 完成！🎉

现在你的 iPhone 上就有了 "策略博弈研习社" app，图标是 ♠️

---

## 更新 app

```bash
# 修改 index.html 后
git add index.html
git commit -m "Update app"
git push
```

GitHub Pages 会自动重新部署！
