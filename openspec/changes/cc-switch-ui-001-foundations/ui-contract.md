# 公共 UI 呈现契约

日期：2026-11-26。参考固定为 CC Switch `f29d0804b05ce374ee650c64706399cd0da01805`。本契约覆盖 001 的全部公共 UI 规范；002～006 引用本文件后迁移各自领域页面。此处的类均只提供呈现，不注册提交、确认、关闭、页签切换或业务快捷键。

## 字体与尺度

字体栈与参考 tailwind.config.cjs 一致：SF Pro Text／PingFang SC／Hiragino Sans GB／Segoe UI Variable Text／Segoe UI／Microsoft YaHei UI 等系统字体；代码使用 SFMono-Regular／SF Mono／Consolas 等等宽字体。

| 角色 | 字号／行高 px | 默认字重 | Tailwind 入口 |
|---|---|---|---|
| 徽标 | 11 / 16 | 500 | text-badge |
| 辅助 | 12 / 18 | 400 | text-caption |
| 正文 | 13 / 20 | 400 | text-body；text-sm 兼容 |
| 强调 | 14 / 20 | 500 | text-strong |
| 分节 | 15 / 22 | 600 | text-section；ui-section-title |
| 弹窗／局部标题 | 16 / 24 | 600 | text-title |
| 页面标题 | 18 / 26 | 600 | text-page；ui-page-title |
| 指标 | 24 / 32 | 600 | text-metric |

基础间距单位 4px；页面左右24、设置分节之间28、面板内距16、分节标题与内容12、操作组间距8、按钮内部图文6。长内容允许换行或滚动，不以固定行高裁切内容。

控件／面板／对话框圆角分别6／10／14；徽标和开关为胶囊。所有新调用应使用 rounded-control／panel／dialog，不能自行用 rounded-xl 等旧尺寸猜测角色。兼容别名与参考配置相同：sm／md／lg／xl 为6／8／12／14px，2xl／3xl 沿用 Tailwind 的16／24px；这些别名不代替语义角色。

## 色彩与主题

所有明暗中性色、三级文字、边框、操作、语义状态色见 implementation.md 的 Token 表。固定橙色操作强调与链接色、焦点色分离；成功、警告、危险独立。主题仅 system／light／dark；语言仅中文／英文，账号遮罩功能保持。图表的公共参考色为 chart-1 #0891B2 / #38BDF8、chart-2 #DB2777 / #F472B6、chart-grid #ECECF0 / #2C2C31；原有领域图表含义不得被主题操作色覆盖。

## 控件与公共布局

| UI 类型 | 尺度／间距／状态约定 | 入口与参考依据 |
|---|---|---|
| 按钮 | 常规32高／左右14，紧凑28／左右12，lg与旧cta36；图标16，图标按钮32方；600主操作、500其余；secondary／ghost透明且无边框 | Button；参考 button.tsx、design-system.html「按钮」 |
| 输入与选择 | 单行32、左右10、圆角6、正文13；输入／选择器焦点3px；多行和领域编辑器可扩展 | Input／Select 与原生字段；参考 input.tsx |
| 标签／校验 | 保留 htmlFor／原生状态，错误使用危险文字与说明，不只变色 | Label／Alert 与 aria-invalid |
| 开关 | 标准30×18、圆点14、位移12；紧凑26×16、圆点12、位移10；禁用0.45 | Switch（default／sm）／Toggle（md／sm）；参考 switch.tsx |
| 勾选／单选 | 16方，1.5强边框，checkbox圆角4，radio圆形；保持原生键盘和 change | 原生 input；参考 index.css |
| 卡片 | 面板圆角10，默认内距16；实色／弱描边；交互卡仅低强度阴影反馈 | Card 与兼容 glass-* 类 |
| 徽标 | 高20、左右7、字号11/16、500、胶囊；成功／危险文字和底色分离 | Badge；参考 design-system.html「徽章 / chip」 |
| 进度 | 保留 value／max、原阈值和 indicatorClassName；数值／文字不因减少动效消失 | Progress；领域含义由调用方决定 |
| 导航行 | 最低28高、左右8、图文8、正文13；选中为中性selected底／主文字，禁止操作色实心块 | ui-nav-row，aria-current=page；参考 design-system.html「侧栏」 |
| 页头 | 常规52高，左24右16，左右区间距20；图标／标题区间距10，页面标题18/26 | ui-page-header／title；参考 shell/AppPageHeader.tsx；窗口拖动与按钮接线由002负责 |
| 工具栏 | 间距8，空间不足时允许换行；图标按钮有可识别名称 | ui-toolbar；不改变选择集合或批量动作 |
| 分节／设置行 | 分节内部12；设置行最低52高（内层最小28＋上下各12），左右16，控件与标签之间16 | ui-section／title、ui-setting-row；参考 SettingsLayout.tsx |
| 分段控件 | 常规36高、内衬3、外圆角10／内7；紧凑28、外8／内5、左右10、字号12/18；原生按钮图文居中，图标16／14 | ui-segmented、ui-segmented-sm；aria-pressed按钮组，参考 segmented-control.tsx；不误用tablist |
| 页签 | 行高36、间距20；默认500、选中主文字600和2px中性下划线 | ui-tabs；角色与事件由调用方连接，参考 design-system.html「下划线页签」 |
| 菜单 | 容器内衬4／圆角10；菜单行最低30、左右8、图文8、圆角6；分隔线上下4 | ui-menu／item／separator；参考 design-system.html「菜单」 |
| 弹窗 | 圆角14；标题16/24；头部20/24/12、正文左右24、底部12/24/20；操作间距8；默认宽512且不超视口减32，最高90vh且不超视口减32，标题说明间距4 | ui-dialog-overlay／panel／header／body／footer；参考 dialog.tsx；正文独立滚动，头尾不缩；不强制迁移手写弹窗 |
| 列表行 | 最低58高、内距10/12/10/8、图文12、圆角10；名称14/20/500，说明12/18 | ui-list-row／title／description；参考 design-system.html「供应商卡片」；虚拟滚动与选择保留 |
| 表格 | 辅助字号12；表头上下8左右10、单元格上下9左右10；细分隔线、中性hover；数值右对齐等宽 | ui-table-scroll／table／number；参考 design-system.html「日志表」；大表虚拟滚动策略不改变 |
| 提示 | 胶囊、左右12上下6、字号12/18、500、inverse底；焦点用户同样可读 | ui-tooltip；参考 HoverTip；显示时机由调用方负责 |
| 通知条 | 圆角10，内距10/14/10/19、图文10、正文13 | ui-notice／Alert；参考 design-system.html「通知条」；状态文案与关闭条件保留 |
| Toast | 默认340宽且小于视口减32，内距10/14/10/12、间距10、圆角10、正文13/500 | ui-toast；参考 design-system.html「Toast」；不新增通知系统或自动业务 |

## 兼容与迁移

语义Token必须同步注册到`lib/utils.ts`的extendTailwindMerge（text／radius／spacing），与CC Switch一致；否则字号可能被颜色类移除，尺寸与圆角覆盖也可能失效。002审查已补齐此公共依赖；真实组件合并后的验证见002 verification/review.mjs。

旧 Button／Card 变体不删；gradient 与 glass 只作为兼容名称，不再产生对应装饰。组件 className／style／ref 和值、回调、disabled仍透传。调用方处理中的按钮沿原有 disabled和 spinner表达状态；不新增 loading业务状态。

所有图标操作由调用方提供 aria-label、title 或可见文字；Select 的触发器使用当前选项文字，也支持显式 aria-label／labelledby。新增菜单键只用于该原生选择控件的方向键浏览、Enter选择、Escape取消，不建立任何业务快捷键。

领域页面残余样式、最小窗口的既有拥挤和后续归属见 implementation.md。001 的通过不表示 002～006 领域页面已完成视觉迁移。
