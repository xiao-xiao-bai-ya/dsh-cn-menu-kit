# dsh-cn-menu-kit

[简体中文](./README.md) · [English](./README.en.md)

<p align="center">
  <img src="./docs/images/popup-cn-list.png" alt="技能中文列表" width="720" />
</p>

<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/df1b68ec-fcaa-42f9-8010-4fedcc6c61d2" />
<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/86cd5d04-424d-4ece-9a68-ed64d9ae13ce" />
<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/8e6a4c37-99ec-4810-a494-8ec549f67f42" />



**DeepSeek Harness（DSH）技能与命令的中文增强插件**——让 `/` 菜单与「+」面板里的技能带上中文标题、支持中文搜索与悬浮详情，命令与技能的顺序都可以**自由拖拽**，常用的永远在最上面。

纯客户端插件，零侵入：不改任何官方文件，卸载即完全还原。

## ✨ 功能

- **技能中文列表**：技能标题显示为「中文标题（英文名）」，顶部搜索框支持中文即时过滤（如输入「面试」找到面试类技能）
- **悬浮详情**：悬停任意技能行，弹出完整简介面板（自动适配深/浅色主题，永不遮挡菜单内容）
- **菜单内直接拖拽**：悬停命令/技能行浮现 ⋮⋮ 把手，按住即可在菜单里直接换位
- **排序面板**：「+」面板新增「技能排序」「命令排序」两个入口，镜像菜单两区（添加/指令）结构，分区内拖拽
- **顺序持久化**：保存在本机，重启保留；「+」菜单与 `/` 菜单共用同一份顺序
- **中文技能标题从哪来**：把 SKILL.md 的 `description` 写成 `中文标题——描述` 的形式即可（见下文约定），无此前缀的技能自动回退显示英文名，完全不影响使用

<p align="center">
  <img src="./docs/images/menu-entry.png" alt="命令菜单中的入口" width="620" />
</p>

## 📦 安装

要求：DSH `>= 0.2.2-rc.1`。

### 方式一：DSH Market（推荐）

打开 DSH Market 搜索 `dsh-cn-menu-kit` 安装。

### 方式二：插件页添加

侧边栏 **插件 → 安装插件**，输入包名 `dsh-cn-menu-kit`，重启 DSH。

### 方式三：命令行

```powershell
dsh plugin --profile web add dsh-cn-menu-kit
```

> 桌面端请在应用内插件页安装（桌面 profile 由应用托管）。

## 🚀 使用

| 入口 | 操作 |
| --- | --- |
| 「+」→「技能」 | 中文技能弹层：搜索、悬停看详情、点选插入引用 |
| 「+」→「技能排序」 / 「命令排序」 | 打开拖拽排序面板（分区内拖拽，即时保存） |
| `/` 菜单「技能（中文）」分组 | 同款中文列表，选中插入 `/英文名` 引用 |
| `/` 菜单内悬停命令行 | 左侧浮现 ⋮⋮ 把手，直接拖动换位 |

选中技能后，输入框会出现 `/英文名` 引用（蓝色 = 已被系统识别），发送即加载技能。

## ✍️ 让技能显示中文标题

在技能的 `SKILL.md` 里把 `description` 的开头写成 **`中文标题——`** 的形式：

```markdown
---
name: agent-dev
description: Agent 开发方法论——构建 agent 系统的完整方法论：任务-模型匹配判定、五段式 pipeline 架构……
---
```

插件会把 `——` 之前的段落作为中文标题展示在菜单中。没有此前缀的技能显示英文名，不影响功能。

## 🛠 调试

浏览器 DevTools Console 执行：

```js
localStorage.setItem('dsh-cn-skill-picker:debug', '1')
```

重启后可见菜单检测、目录加载、拖拽事件等诊断日志。

## ⚠️ 已知限制

- 菜单行由官方 React 组件渲染，拖拽后的顺序靠插件在渲染后恢复——官方大版本更新若改动菜单 DOM 结构，可能需要适配
- 添加/指令两个分区的归属由官方固定名单决定，跨分区拖拽不生效（这是官方语义，不是 bug）

## 🙏 鸣谢

- [dsh-reference-anything](https://github.com/Chael-Chael/dsh-reference-anything) 与 [dsh-skill-explorer](https://www.npmjs.com/package/@linxin666/dsh-client-ui-skill-explorer) 的插件结构提供了宝贵参考
- 中文标题约定来自 [Agent Skills](https://code.claude.com/docs/en/skills) 生态的实践

## 📄 许可

[MIT](./LICENSE)
