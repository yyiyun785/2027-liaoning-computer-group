# 辽宁专升本备考助手（计算机组）

一个面向**辽宁省专升本（计算机组）**考生的跨平台备考工具，包含 **PC 桌面版（Electron）** 和 **安卓版（WebView）**，一套前端代码双端复用。

> 💡 专为计算机组考纲设计：公共课 340 分 + 专业综合课 300 分 + 技能考核 100 分，总分 740。

---

## ✨ 功能特性

### 📚 学习内容
- **知识精讲**：8 个科目、**77 条知识点**，严格按辽宁省官方考纲组织
  - 公共课：高等数学（120分）、外语/英语（120分）、计算机应用基础（100分）
  - 专业综合课：C语言程序设计、计算机网络、数据库（各 100 分）
  - 技能考核：网页设计与制作、应用文档编辑与数据处理
- **刷题练习**：**316 道练习题**（按考点编写，非历年真题），每题带答案解析
- **考试倒计时**：自动计算距考试天数
- **录取分数线查询**：42 条院校×专业数据，支持按专业筛选、最低分过滤

### 📥 智能题目导入（核心亮点）
- **多来源导入**：剪贴板 / 文件（**Word .docx、PDF、TXT**）
- **格式自动识别**（"自动挡"）：题号、选项符号、答案标记格式再乱也能识别
  - 支持 `1.` `1、` `第1题`（题号）
  - 支持 `A.` `A、` `A)` `①②③④`（选项）
  - 支持 `答案：A` `【答案】A` `正确答案A`（答案）
  - 支持 `解析：` `【解析】`（解析）
  - **自动处理判断题**（无选项 → 生成"正确/错误"）
  - 全角字母数字（ＡＢ１２）自动转半角
- **导入前预览**：显示识别题数与第 1 题预览，防止识别出错

### 📕 学习工具
- **错题本**：做错自动收录，答对自动移出（已掌握），支持重做
- **收藏**：标记重点题目，随时回看
- **学习统计**：做题数、正确率、掌握进度环形图、数据本地持久化

---

## 🛠️ 技术栈

| 端 | 技术 |
|----|------|
| **PC 桌面版** | Electron 33（`contextIsolation: true` + 禁用 `nodeIntegration` 安全配置）|
| **安卓版** | Android WebView + 原生 `onShowFileChooser` 文件选择 |
| **前端** | 原生 HTML/CSS/JavaScript（单文件 SPA，无框架依赖）|
| **PDF 解析** | pdf.js 3.11（本地内置，离线可用，支持中文 CID 字体）|
| **Word 解析** | 自研最小 ZIP 解析器 + `DecompressionStream` 解压 OOXML |
| **数据存储** | localStorage 本地持久化 |

---

## 🚀 特色实现

### 1. 自研 Word（.docx）解析
不依赖任何第三方库——`.docx` 本质是 ZIP，用原生 `DataView` 解析中央目录定位 `word/document.xml`，
再用浏览器原生 `DecompressionStream('deflate-raw')` 解压，最后剥离 XML 标签提取纯文本。

### 2. PDF 中文解析
中文 PDF 常用 **CID 字体**（文字存的是字形编号而非 Unicode），简易解析无法还原。
因此集成 **pdf.js** 本地引擎，实测可从招生计划 PDF 中提取 8000+ 字干净中文。

### 3. "自动挡"题目格式识别
通过多轮正则归一化（全角转半角、圈号转字母、标记统一、题号清理），
把各种来源的题目文本统一成标准结构，用户**不需要手工整理格式**。

### 4. 跨平台代码复用
同一份 `index.html` 同时用于 Electron（PC）和 Android WebView，仅外壳不同。

---

## 📁 项目结构

```
.
├── liaoning-zsb-app/          # PC 端（Electron）源码
│   ├── main.js                # Electron 主进程
│   ├── index.html             # 应用主体（单文件 SPA）
│   ├── icon.ico               # 应用图标
│   ├── pdf.min.js             # pdf.js 引擎
│   └── pdf.worker.min.js      # pdf.js worker
├── android-app/               # 安卓端源码
│   ├── AndroidManifest.xml
│   ├── src/com/zsb/study/MainActivity.java
│   └── assets/                # 前端资源（含 index.html、pdf.js）
├── 辽宁专升本备考助手.apk      # 安卓安装包（已签名）
└── README.md
```

---

## 🔧 构建方法

### PC 端（Electron）
```bash
cd liaoning-zsb-app
npm install
npm start          # 开发运行
npm run package    # 打包（electron-packager）
```

> 国内打包提示：若下载 Electron 失败，设置镜像后再打包
> ```bash
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> ```

### 安卓端
用 Android Studio 打开 `android-app`，或使用命令行工具链：
```bash
# 编译 Java
javac -source 8 -target 8 -bootclasspath <android.jar> -d build/classes src/com/zsb/study/MainActivity.java
# 转 dex
d8 --lib <android.jar> --min-api 21 --output build/dex build/classes/**/*.class
# 对齐 + 签名
zipalign -f 4 app-unsigned.apk app-aligned.apk
apksigner sign --ks zsb.keystore --out app-signed.apk app-aligned.apk
```

---

## ⚖️ 说明与声明

- 题库中的题目为**按考点编写的练习题**，**不是历年真题**；历年真题请通过官方渠道获取
- 分数线数据来源于公开信息，仅供参考，**以辽宁省招考办官方通知为准**
- 真题版权归考试院所有，本项目仅提供官方/公开渠道的**链接**，不存储、不传播真题内容
- 本项目为个人学习作品，仅供学习交流使用

---

## 📄 License

MIT
