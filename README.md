# 周限与重置卡

独立 RS 网关插件，插件 ID 为 `personal.quota-manager`，公开版本以 Releases 为准

基于上游 `v3.54.0` 的公开 SDK，固定提交 `a770419818117098c43919a5c6553cc7023ecf71`。使用清单 v2、进程 RPC v7、管理能力 v2、维护能力 v1 和页面宿主桥 v2。

## 安装与兼容

- 下载：[安装包与校验文件](https://github.com/Lemon-57/rs-quota-manager/releases)
- 源码声明兼容 RS `>=3.54.0, <3.55.0`。按对应 Release 的兼容范围选包。
- Linux x86_64 安装包要求 glibc 2.28 及以上。
- 插件 ID：`personal.quota-manager`。为保留既有安装配置和私有状态，继续沿用该身份。
- 许可证：Apache-2.0，第三方来源见 [LICENSES/NOTICE.md](LICENSES/NOTICE.md)。

在 RS 的“插件管理 → 安装插件 → GitHub”中填写 `Lemon-57/rs-quota-manager`，选择指定版本下匹配架构的 `.tar.gz` 附件。
也可下载同一 Release 中的 `.tar.gz` 和 `.tar.gz.sha256`，核对 SHA-256 后，通过“上传”安装。
首次安装时确认来源和信任，宿主会创建并启用默认配置。已有安装可通过宿主版本切换更新，保留实例与私有状态。随后从侧栏打开“周限与重置卡”。

## 安全边界

插件直接显示和修改宿主的逐账号自动使用设置。开启后由宿主按原生规则使用额度点数或重置卡，手动确认用卡也会通过宿主调用上游接口。
插件的手动卡片操作限于 OpenAI OAuth 非 Free 账号。手动操作结果不确定时，保留原请求标识并阻止该账号发起新的手动消费。
公开验证覆盖规则、协议、页面及安装流程，未执行真实卡片消费；不同上游套餐与卡片格式仍可能存在兼容性差异。
CSV 包含账号 ID、完整名称和邮箱，若原名称含敏感内容，请勿将导出内容公开。

## 使用

在网关的插件管理中上传安装 `dist/personal.quota-manager-<版本>-x86_64-unknown-linux-gnu.tar.gz`，核对旁边的 SHA-256 文件，接受来源并确认配置处于启用状态，再打开“周限与重置卡”页面

- 读取 RS 当前账号套餐和启用状态，排除套餐为 Free 的账号，账号列显示完整邮箱，无邮箱时回退到名称。列表显示订阅开始与结束、周限、刷新时间、重置卡及到期时间和额度点数，内部 ID 与账号名称仍参与搜索和导出
- 按宿主真实 `planType` 判断套餐，名称带 `team+` 的 Free 同样排除，列表、汇总、后台查询和新消费共用该规则
- 打开页面或点击“读取最新快照”时分页读取网关账号、开关和已有额度观测，以及插件最近保存的卡片和订阅缓存。订阅未查到时显示“—”，额度点数区分零、不限量和未知余额
- 行内刷新和“更新筛选账号”通过宿主主动查询额度、卡片及订阅。订阅查询使用账号的有效代理配置。批量更新逐个执行，可以停止后续查询
- 从行内的重置卡图标打开“额度重置”，单独查询该账号的卡片库存。选择一张卡后进入确认步骤
- “自动使用额度点数”和“自动使用重置卡”固定在列表右侧，分别对应 RS 账号管理中的同名设置。升级后直接读取宿主已有状态，旧插件的自动使用设置不会迁移到宿主
- 工具栏可对当前筛选结果中的适用账号批量开启或关闭用点、用卡，范围覆盖所有匹配页。重置卡列标题的帮助图标显示“系统设置 → 主动重置卡”的规则，弹窗显示该账号的计划用卡时间和执行状态
- 日期按浏览器本地时区显示，支持搜索、筛选、排序和 CSV 导出；隔离页面不支持下载导航，导出改为官方弹窗中的只读 CSV 和复制、全选操作，不扩展宿主权限。分页复用 RS 使用统计的 ZPagination，默认每页 10 条，可选 10、20、50、100 条及页码跳转
- 页面复用公开的指标卡、会员标签、开关、表格、分页和弹窗，随宿主主题同步，可按会员标识和状态筛选

## 巡检与手动用卡

巡检默认每 30 秒检查一批账号，每批最多检查 20 个账号，其中最多查询一个账号的卡片和订阅。两种缓存默认每小时到期，首次查询按账号轮转填充。
巡检仅为过期的缓存查询上游，额度只在检查卡片适用性或等待手动消费后的额度恢复时读取，账号状态变化时才保存。自动用点和自动用卡由宿主调度。

手动消费前将 UUID 保存到宿主的插件私有状态，结果不确定时保留原卡和原 UUID
“确认原操作”只复用原请求标识，不选择另一张卡，进程重启仍保留未决操作，账号降为 Free 时移出业务列表，其原有未决操作单独保留确认入口
确认成功后回读额度与卡片；额度尚未恢复时保持等待状态，直到收到消费后的低于 100% 的新周限观测

每号保留最近 20 条已确认业务结果，宿主原生消费接口同时保留其自身的审计语义

## 构建

全部构建与验证在本机运行，生产服务器只接收完成的安装包
Rust 使用 1.99.1，前端使用 Node 24 和 pnpm，SDK 与前端依赖由锁文件固定

```powershell
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
cargo +1.99.1 fmt --manifest-path backend/Cargo.toml -- --check
cargo +1.99.1 clippy --manifest-path backend/Cargo.toml --all-targets --locked -- -D warnings
cargo +1.99.1 test --manifest-path backend/Cargo.toml --locked
cargo +1.99.1 build --manifest-path backend/Cargo.toml --locked
node verification/protocol-test.mjs
node verification/frontend-test.mjs
```

交叉构建 Linux 制品需要安装 Zig、cargo-zigbuild 和 Rust Linux target，把 Zig 与 cargo-zigbuild 加入 PATH

```powershell
rustup target add x86_64-unknown-linux-gnu --toolchain 1.99.1
cargo +1.99.1 zigbuild --manifest-path backend/Cargo.toml --release --locked --target x86_64-unknown-linux-gnu.2.28
cpr-plugin package --manifest plugin.json --binary backend/target/x86_64-unknown-linux-gnu/release/quota-manager --target x86_64-unknown-linux-gnu --resource-map web=frontend/dist --resource-map legal=LICENSES --output-dir dist
```

`cpr-plugin` 应从上面的宿主固定提交构建，安装包支持 Linux x86_64、glibc 2.28 及以上
Linux 原生开发可直接使用 `cargo build --release --target x86_64-unknown-linux-gnu` 后用同一 CLI 打包

## 上游复用

按 Issue #278、官方 UI 安装文档和 plugins/workbench 示例核对，详见 `verification/UPSTREAM-COMPLIANCE.md`。
UI 通过官方 v0.4.1 编译发行包安装，SHA-256 与官方校验文件一致，并写入 pnpm 锁文件 integrity；业务代码只导入公开组件、样式、主题与 Vite 入口。
插件示例仓库不是运行时依赖，复用其公开宿主桥、请求层与运行时解码组织方式，不导入其内部业务代码，也不降级当前宿主 SDK。
来源与许可见 `LICENSES/NOTICE.md`，随插件包一并提供。

## 验证边界

`verification/protocol-test.mjs` 启动真实插件进程，以模拟宿主验证握手、分页、订阅缓存、原生开关独立读写、升级兼容、不确定结果、重启恢复及幂等键复用
测试不访问真实网关或真实上游，不消费真实卡片

`pnpm --dir frontend dev --port 5176` 提供带明确标识的本地模拟预览，发行页面只使用 `window.codexProxyPlugin` 宿主桥，不请求管理员密码或读取管理 Cookie

## 页面加载排查

宿主会校验页面资源的 sandbox CSP 和 `X-Content-Type-Options: nosniff`
Nginx 同时透传上游同名头并追加 `nosniff` 会产生 `nosniff, nosniff`，从而触发“服务返回了不受支持的响应”
在已有 Nginx `add_header X-Content-Type-Options nosniff always;` 的站点中，使用 `proxy_hide_header X-Content-Type-Options;` 保留单个安全头
修改需要备份并通过配置检查，平滑重载须保留在途连接；浏览器缓存旧响应头时需强制刷新页面
